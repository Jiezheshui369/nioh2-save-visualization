"""Audit EVERY screenshot row against a decrypted COPY; never infer final totals.

This is a research tool, not a status calculator. Matches locate candidates, not
proven offsets. All equipment/scroll contributions remain explicitly incomplete.
"""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import struct

from agent.parser import (EQUIPMENT_START, EQUIPMENT_SIZE, SCROLL_START, SCROLL_SIZE, parse_bytes,
                          _equipment_record, _load_items, _load_effects, _load_zh_names, _load_zh_effects)

DIRECT = {
    '等级': 'level', '精华': 'amrita', '持有金钱': 'gold',
    '体': 'constitution', '心': 'heart', '勇': 'courage', '刚': 'stamina',
    '武': 'strength', '技': 'skill', '忍': 'dexterity', '咒': 'magic',
}


def normalized_label(label: str) -> str:
    return re.sub(r'[\s·・]', '', label).translate(str.maketrans({'（': '(', '）': ')', '−': '-', '－': '-'}))


def number(value):
    if value is None:
        return None
    value = str(value).replace(',', '').replace('−', '-').replace('－', '-').strip()
    try:
        return Decimal(value.removesuffix('%')), '%' if value.endswith('%') else 'number'
    except InvalidOperation:
        return None


def panel_search_value(label: str, value: str | None) -> str | None:
    """Search the requested maxima; retain the full screenshot row as evidence."""
    if label in {'体力', '精力', '妖力'} and value is not None:
        pair = re.fullmatch(r'\s*\d+(?:\.\d+)?\s*/\s*(\d+(?:\.\d+)?)\s*', value)
        if pair:
            return pair.group(1)
    return value


def byte_candidates(data: bytes, value: str | None, extended: bool = False) -> list[dict]:
    """Bounded examples + complete counts; zero/small matches are not useful proof."""
    if value is None:
        return []
    tokens = re.findall(r'(?<![\w])\d+(?:\.\d+)?', value.replace(',', ''))
    results = []
    for token in dict.fromkeys(tokens):
        v = Decimal(token)
        if v == 0:
            continue
        encodings = [('float32-le', '<f', float(v), 4), ('float64-le', '<d', float(v), 8)]
        if v == v.to_integral() and 0 <= v <= 0xFFFFFFFF:
            encodings.append(('uint32-le', '<I', int(v), 4))
        if v != v.to_integral() and 0 <= v * 10 <= 0xFFFFFFFF and v * 10 == (v * 10).to_integral():
            encodings.append(('tenths-uint32-le', '<I', int(v * 10), 4))
        if extended:
            encodings.extend([('float32-be', '>f', float(v), 4), ('float64-be', '>d', float(v), 8)])
            if v == v.to_integral() and 0 <= v <= 0xFFFF:
                encodings.extend([('uint16-le', '<H', int(v), 2), ('uint16-be', '>H', int(v), 2)])
            if v == v.to_integral() and 0 <= v <= 0xFFFFFFFF:
                encodings.append(('uint32-be', '>I', int(v), 4))
            if v == v.to_integral() and 0 <= v <= 0xFFFFFFFFFFFFFFFF:
                encodings.extend([('uint64-le', '<Q', int(v), 8), ('uint64-be', '>Q', int(v), 8)])
            for scale in (10, 100, 1000):
                scaled = v * scale
                if scaled == scaled.to_integral() and 0 <= scaled <= 0xFFFFFFFF:
                    # Integer fixed-point possibilities, not an asserted save encoding.
                    for order, marker in [('le', '<'), ('be', '>')]:
                        name = f'scaled-{scale}-uint32-{order}'
                        encodings.append((name, marker + 'I', int(scaled), 4))
        for encoding, fmt, raw, alignment in encodings:
            try:
                pattern = struct.pack(fmt, raw)
            except (OverflowError, struct.error):
                continue
            matches, aligned, examples = 0, 0, []
            offset = data.find(pattern)
            while offset >= 0:
                matches += 1
                aligned += offset % alignment == 0
                if len(examples) < 8:
                    examples.append(f'0x{offset:X}')
                offset = data.find(pattern, offset + 1)
            results.append(dict(value=token, encoding=encoding, matchCount=matches,
                                alignedCount=aligned, candidateOffsets=examples,
                                verified=False))
    return results


def sources_for(snapshot: dict, data: bytes) -> list[dict]:
    sources = []
    for group, start, stride in [('currentLoadout', EQUIPMENT_START, EQUIPMENT_SIZE),
                                 ('scrolls', SCROLL_START, SCROLL_SIZE),
                                 ('candidateCoreRecords', 0, 0)]:
        for item in snapshot.get(group, []):
            base = item['_candidateByteOffset'] if group == 'candidateCoreRecords' else start + item['recordIndex'] * stride
            # Keep raw fields even when a display codec is unknown. Empty slots
            # are skipped exactly as in the parser, preserving array alignment.
            raw_effects = []
            for slot in range(7):
                offset = base + 48 + slot * 12
                if offset + 12 > len(data):
                    break
                eid, raw = struct.unpack_from('<II', data, offset)
                if eid & 0xFFFF not in (0, 0xFFFF):
                    raw_effects.append((f'{eid & 0xFFFF:04X}', raw, offset + 4))
            for i, (eid, raw, offset) in enumerate(raw_effects):
                labels = item.get('effectsZh', [])
                values = item.get('effectMagnitudes', [])
                details = item.get('effectValueDetails', [])
                ids = item.get('effectIds', [])
                detail = details[i] if i < len(details) and i < len(ids) and ids[i] == eid else {}
                evidence_matches = detail.get('rawValue') == raw
                sources.append(dict(group=group, item=item.get('nameZh') or item['name'],
                    recordIndex=item['recordIndex'], slot=item.get('slot'), effectId=eid,
                    label=labels[i] if i < len(labels) else None,
                    displayedValue=values[i] if i < len(values) else None,
                    rawValue=raw, rawOffset=f'0x{offset:X}',
                    valueKind=detail.get('kind', 'unknown') if evidence_matches else 'unknown',
                    valueEncoding=detail.get('encoding', 'not-decoded') if evidence_matches else 'not-decoded',
                    activeState='unverified-detached-core' if group == 'candidateCoreRecords' else
                                'unknown-scroll-selection' if group == 'scrolls' else
                                'unknown-weapon-selection' if item.get('slot', '').startswith(('melee', 'ranged')) else
                                'equipped-record-only'))
    return sources


def core_candidates(data: bytes, offsets: list[int], catalog: Path) -> list[dict]:
    """Explicit research addresses only. Never install them as active core slots."""
    if len(offsets) > 64 or len(set(offsets)) != len(offsets):
        raise ValueError('At most 64 distinct candidate addresses are allowed')
    items, effects = _load_items(catalog / 'items.json'), _load_effects(catalog / 'effects.json')
    zh_items, zh_effects = _load_zh_names(catalog / 'items.json'), _load_zh_effects(catalog / 'effects.json')
    result = []
    for offset in offsets:
        if offset < 0 or offset + EQUIPMENT_SIZE > len(data):
            raise ValueError('Candidate address is outside the copy')
        record = _equipment_record(data, offset, -1, items, effects, zh_items, zh_effects)
        if not record or record['type'] != 'Soul Core':
            raise ValueError('Candidate address does not point to a recognized soul core')
        record['_candidateByteOffset'] = offset
        record['nameZh'] = '未确认魂核副本 · ' + (record['nameZh'] or record['name'])
        result.append(record)
    return result


def analyze(observed: dict, snapshot: dict, data: bytes, extended: bool = False) -> dict:
    if observed.get('source') != 'game-screenshots':
        raise ValueError('Expected explicitly labelled screenshot observations')
    sources = sources_for(snapshot, data)
    index = {}
    for source in sources:
        if source['label']:
            index.setdefault(normalized_label(source['label']), []).append(source)
    rows = []
    for section in ('groups', 'effects'):
        for group in observed[section]:
            for entry in group['entries']:
                row = dict(section='panel' if section == 'groups' else 'special-effect',
                           group=group['title'], label=entry['label'], observed=entry['value'],
                           pages=entry['pages'], status='unverified-final-value', finalValue=None)
                key = DIRECT.get(entry['label']) if section == 'groups' else None
                if key:
                    c = snapshot['character']
                    actual = c[key] if key in c else c['attributes'][key]
                    row.update(status='direct-match' if number(entry['value']) == (Decimal(actual), 'number') else 'direct-mismatch',
                               finalValue=actual, field=key)
                elif section == 'groups':
                    row['searchTarget'] = panel_search_value(entry['label'], entry['value'])
                    row['byteCandidates'] = byte_candidates(data, row['searchTarget'], extended)
                    row['blocker'] = '优先定位存档直接字段及其编码；字节匹配不是已验证偏移，不通过词条合成填补。'
                else:
                    hits = index.get(normalized_label(entry['label']), [])
                    row['sourceCandidates'] = hits
                    row['status'] = 'source-candidates-only' if hits else 'no-exact-labelled-source'
                    row['blocker'] = '角色总效果未计算；未确认的主副武器、绘卷、守护灵魂核、技能、称号和武家贡献不能当作零。'
                rows.append(row)
    return dict(version=1, parserVersion=snapshot.get('parserVersion'), rowCount=len(rows),
                coverage=dict(Counter(row['status'] for row in rows)), rows=rows,
                sourceValueKinds=dict(Counter(source['valueKind'] for source in sources)),
                sourceValueEncodings=dict(Counter(source['valueEncoding'] for source in sources)),
                complete=False,
                limitations=['名称匹配是线索，不会将多个同名来源自动相加。',
                             '当前武器与备用武器不能无条件叠加；库存绘卷不等于佩戴绘卷。',
                             '数值完全相同也不证明来源完整，字节扫描零匹配也不证明字段不存在。',
                             'CAP 历史单位推测不是已验证编码；来源编码已验证也不代表角色最终值已解析。',
                             '本工具不生成可导入的游戏档案，不修改存档或截图观察。'])


def markdown(report: dict) -> str:
    lines = ['# 截图状态逐项解析核对', '', '**这是研究报告，不是已完成的全量解析。**', '',
             f"覆盖 {report['rowCount']} 项；状态：{json.dumps(report['coverage'], ensure_ascii=False)}", '',
             '直接匹配只用于已有明确字段。来源候选不是角色总效果，未验证项不填零。', '',
             '| 分类 | 字段 | 游戏截图 | 存档直接值 | 状态／来源线索 |', '|---|---|---|---|---|']
    labels = {'direct-match': '直接读取，与截图一致', 'direct-mismatch': '直接读取，与截图不一致',
              'unverified-final-value': '最终面板直接字段待验证', 'source-candidates-only': '发现来源，最终效果未解析',
              'no-exact-labelled-source': '尚无同名装备/绘卷线索'}
    for row in report['rows']:
        hints = []
        for src in row.get('sourceCandidates', [])[:4]:
            evidence = {'verified-id': '来源编码已验证', 'legacy-cap': '单位待复核',
                        'not-decoded': '编码未验证'}.get(src.get('valueEncoding'), '编码未验证')
            hints.append(f"{src['item']}[{src['effectId']}]：{src['displayedValue'] or '数值未解码'}（{evidence}）")
        detail = labels[row['status']] + ('；' + '；'.join(hints) if hints else '')
        cells = [row['group'], row['label'], row['observed'] if row['observed'] is not None else '无数值效果',
                 str(row['finalValue']) if row['finalValue'] is not None else '—', detail]
        lines.append('| ' + ' | '.join(cell.replace('|', '\\|').replace('\n', ' ') for cell in cells) + ' |')
    lines += ['', '## 边界', ''] + ['- ' + note for note in report['limitations']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observations', type=Path, required=True)
    parser.add_argument('--copy-root', type=Path, required=True)
    parser.add_argument('--decrypted-copy', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--candidate-core-offset', type=lambda s: int(s, 0), action='append', default=[])
    parser.add_argument('--extended-encodings', action='store_true', help='Also inspect 16/64-bit, big-endian and fixed-point candidates; never promote matches')
    args = parser.parse_args()
    save = args.decrypted_copy.resolve()
    root = args.copy_root.resolve()
    output = args.output_dir.resolve()
    if root not in save.parents:
        parser.error('Input must be under the explicitly declared COPY root')
    if output == root or output in save.parents or root in output.parents:
        parser.error('Research output must be separate from the copy directory')
    paths = [args.observations.resolve(), save]
    if not 0 < paths[0].stat().st_size <= 8 * 1024 * 1024 or not 0 < save.stat().st_size <= 8 * 1024 * 1024:
        parser.error('Unexpected input size')
    inputs = [path.read_bytes() for path in paths]
    archive = json.loads(inputs[0])
    observed = archive['character']['characterStatus']
    catalog = Path(__file__).resolve().parents[1] / 'data'
    snapshot = parse_bytes(inputs[1], catalog / 'items.json', catalog / 'effects.json')
    snapshot['candidateCoreRecords'] = core_candidates(inputs[1], args.candidate_core_offset, catalog)
    from agent.parser import PARSER_VERSION
    snapshot['parserVersion'] = PARSER_VERSION
    report = analyze(observed, snapshot, inputs[1], args.extended_encodings)
    report['extendedEncodings'] = args.extended_encodings
    report['inputsUnchanged'] = all(hashlib.sha256(blob).digest() == hashlib.sha256(path.read_bytes()).digest()
                                    for blob, path in zip(inputs, paths))
    if not report['inputsUnchanged']:
        raise RuntimeError('An input changed during research')
    # Write new reports only; never overwrite an existing report or input.
    output.mkdir(parents=True, exist_ok=False)
    (output / 'status-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / '状态解析核对.md').write_text(markdown(report), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('rowCount', 'coverage', 'complete', 'inputsUnchanged')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
