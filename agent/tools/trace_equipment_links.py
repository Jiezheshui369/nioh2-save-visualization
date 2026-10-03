"""Trace inventory records across an explicitly supplied decrypted COPY.

Byte identity and plausible references are research evidence only, never proof of
current equipment selection. No game files or production snapshots are written.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct

from agent.parser import (EQUIPMENT_START, EQUIPMENT_SIZE, EQUIPMENT_SLOTS,
                          SCROLL_START, SCROLL_SIZE, SCROLL_SLOTS, parse_bytes, PARSER_VERSION)


def occurrences(data: bytes, pattern: bytes, maximum: int = 64) -> dict:
    """Count every occurrence, but bound retained offsets (including overlaps)."""
    if not pattern or not any(pattern) or maximum < 1 or maximum > 1024:
        raise ValueError('Nonzero pattern and bounded maximum required')
    count, offsets = 0, []
    position = data.find(pattern)
    while position >= 0:
        count += 1
        if len(offsets) < maximum:
            offsets.append(position)
        position = data.find(pattern, position + 1)
    return {'count': count, 'offsets': offsets, 'truncated': count > len(offsets)}


def region(offset: int) -> str:
    if EQUIPMENT_START <= offset < EQUIPMENT_START + EQUIPMENT_SIZE * EQUIPMENT_SLOTS:
        return 'equipment-inventory-region'
    if SCROLL_START <= offset < SCROLL_START + SCROLL_SIZE * SCROLL_SLOTS:
        return 'scroll-inventory-region'
    return 'unmapped-region'


def trace_record(data: bytes, base: int, stride: int) -> dict:
    if stride not in (EQUIPMENT_SIZE, SCROLL_SIZE) or base < 0 or base + stride > len(data):
        raise ValueError('Record must be fully inside the copy')
    record = data[base:base + stride]
    if record[:2] == b'\0\0':
        raise ValueError('Cannot trace an empty record')
    traces = []
    for name, start, end in [('identity-candidate', 36, 44), ('effects-block', 48, 132)]:
        pattern = record[start:end]
        if not any(pattern):
            traces.append({'pattern': name, 'status': 'empty-pattern', 'matches': [], 'count': 0})
            continue
        found = occurrences(data, pattern)
        matches = []
        for at in found['offsets']:
            candidate = at - start
            complete = 0 <= candidate and candidate + 132 <= len(data)
            same_id = complete and data[candidate:candidate + 2] == record[:2]
            item = {'offset': at, 'offsetHex': hex(at), 'region': region(at),
                    'candidateRecordOffset': candidate if complete else None,
                    'sameItemId': same_id, 'sameBody': False, 'verified': False}
            if same_id:
                other = data[candidate:candidate + 132]
                item['sameBody'] = other == record[:132]
                item['differentBodyBytes'] = [i for i, (a, b) in enumerate(zip(other, record[:132])) if a != b]
            matches.append(item)
        traces.append({'pattern': name, 'status': 'candidates-only',
                       'count': found['count'], 'truncated': found['truncated'], 'matches': matches})
    return {'sourceOffset': hex(base), 'recordSize': stride, 'traces': traces,
            'selectionVerified': False}


def trace_index(data: bytes, index: int, slots: int) -> dict:
    """Both zero/one-based possibilities. Tiny integer hits are weak evidence."""
    if not 0 <= index < slots:
        raise ValueError('Record index outside declared table')
    searches = []
    for basis, value in [('zero-based', index), ('one-based', index + 1)]:
        if value == 0:
            searches.append({'basis': basis, 'value': value, 'status': 'zero-too-ambiguous', 'verified': False})
            continue
        for size, fmt in [(2, '<H'), (4, '<I')]:
            found = occurrences(data, struct.pack(fmt, value))
            searches.append({'basis': basis, 'width': size, 'value': value, 'matchCount': found['count'],
                             'candidateOffsets': [hex(offset) for offset in found['offsets']],
                             'truncated': found['truncated'], 'verified': False})
    return {'recordIndex': index, 'selectionVerified': False, 'searches': searches}


def analyze(data: bytes, parsed: dict) -> dict:
    records = []
    for group, start, stride, slots in [('equipmentInventory', EQUIPMENT_START, EQUIPMENT_SIZE, EQUIPMENT_SLOTS),
                                       ('scrolls', SCROLL_START, SCROLL_SIZE, SCROLL_SLOTS)]:
        for item in parsed.get(group, []):
            # Trace every scroll and soul core plus actual marked equipment.
            if group == 'equipmentInventory' and item.get('type') != 'Soul Core' and item.get('equipIndex', 255) > 10:
                continue
            index = item['recordIndex']
            if not isinstance(index, int) or not 0 <= index < slots:
                raise ValueError('Invalid source record index')
            trace = trace_record(data, start + index * stride, stride)
            trace.update(group=group, recordIndex=index, itemId=item['id'],
                         itemName=item.get('nameZh') or item['name'], type=item.get('type', 'Scroll'))
            records.append(trace)
    return {'version': 1, 'parserVersion': PARSER_VERSION, 'complete': False,
            'recordCount': len(records), 'groups': dict(Counter(r['group'] for r in records)), 'records': records,
            'limitations': ['Identity-candidate bytes have not been proven to be a unique game object ID.',
                           'Identical bodies and detached copies do not identify currently active guardian spirits or scrolls.',
                           'This report must not be imported as a character archive or copied to public assets.']}


def guardian_table_candidates(data: bytes, table_offset: int, row_count: int,
                              selector_offsets: list[int], *,
                              inventory_offset: int = EQUIPMENT_START,
                              inventory_slots: int = EQUIPMENT_SLOTS) -> dict:
    """Check a hypothesized table layout, never infer guardian names or active roles.

    Candidate row: two u32 headers, three 0x90 record copies, eight padding
    bytes, three u32 inventory indices, four padding bytes. The first 132 bytes
    of each copied record are comparable; the inventory tail has other fields.
    Callers supply every research address explicitly; production does not use it.
    """
    stride = 0x1D0
    if not 1 <= row_count <= 128 or table_offset < 0 or table_offset + row_count * stride > len(data):
        raise ValueError('Candidate table must fit inside the copy (1..128 rows)')
    if (not 1 <= inventory_slots <= 4096 or inventory_offset < 0 or
            inventory_offset + inventory_slots * EQUIPMENT_SIZE > len(data)):
        raise ValueError('Inventory must fit inside the copy')
    if (len(selector_offsets) > 8 or len(set(selector_offsets)) != len(selector_offsets) or
            any(at < 0 or at + 4 > len(data) for at in selector_offsets)):
        raise ValueError('At most eight distinct in-bounds selector addresses allowed')
    rows = []
    for index in range(row_count):
        at = table_offset + index * stride
        row_id, flag = struct.unpack_from('<II', data, at)
        links = []
        for slot in range(3):
            copy_at = at + 8 + slot * EQUIPMENT_SIZE
            body = data[copy_at:copy_at + 132]
            reference = struct.unpack_from('<I', data, at + 448 + slot * 4)[0]
            # Unoccupied records retain defaults (including FF effect IDs).
            # Match the inventory parser's empty-item marker, not all-zero bytes.
            empty = body[:2] == b'\0\0'
            inventory_at = inventory_offset + reference * EQUIPMENT_SIZE if reference < inventory_slots else None
            if reference == inventory_slots:
                status = 'empty-sentinel' if empty else 'sentinel-with-nonempty-copy'
            elif inventory_at is None:
                status = 'out-of-range-reference'
            elif empty:
                status = 'empty-copy-with-reference'
            elif data[inventory_at:inventory_at + 2] == b'\0\0':
                status = 'reference-to-empty-inventory'
            else:
                status = 'matching-body' if body == data[inventory_at:inventory_at + 132] else 'different-body'
            links.append({'slotCandidate': slot, 'copyOffset': hex(copy_at), 'inventoryIndex': reference,
                          'inventoryOffset': hex(inventory_at) if inventory_at is not None else None,
                          'status': status, 'verified': False})
        rows.append({'rowIndex': index, 'offset': hex(at), 'idCandidate': row_id,
                     'flagCandidate': flag, 'paddingZero': not any(data[at + 440:at + 448] + data[at + 460:at + 464]),
                     'links': links, 'selectionVerified': False})
    selectors = []
    for at in selector_offsets:
        value = struct.unpack_from('<I', data, at)[0]
        # Zero is not enough to associate empty/uninitialized rows.
        matching_rows = [r['rowIndex'] for r in rows if value != 0 and r['idCandidate'] == value]
        selectors.append({'offset': hex(at), 'value': value, 'matchingRowIndices': matching_rows,
                          'uniqueRowMatch': len(matching_rows) == 1, 'role': 'unverified', 'verified': False})
    ids = Counter(r['idCandidate'] for r in rows if r['idCandidate'] != 0)
    return {'tableOffset': hex(table_offset), 'rowStride': stride, 'rowCount': row_count,
            'nonzeroIdsUnique': all(count == 1 for count in ids.values()),
            'linkCounts': dict(Counter(link['status'] for row in rows for link in row['links'])),
            'rows': rows, 'selectors': selectors, 'selectionVerified': False,
            'limitations': ['Record/index agreement is not proof of guardian name, primary/secondary order, or active selection.',
                            'The empty sentinel and row layout are hypotheses for explicitly supplied addresses.']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--copy-root', type=Path, required=True)
    p.add_argument('--decrypted-copy', type=Path, required=True)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--guardian-table-offset', type=lambda value: int(value, 0))
    p.add_argument('--guardian-row-count', type=int)
    p.add_argument('--guardian-selector-offset', type=lambda value: int(value, 0), action='append', default=[])
    args = p.parse_args()
    root = args.copy_root.resolve(strict=True)
    source = args.decrypted_copy.resolve(strict=True)
    output = args.output_dir.resolve()
    if not root.is_dir() or root not in source.parents:
        p.error('Input must be inside the explicit COPY root')
    if output == root or root in output.parents or output in source.parents:
        p.error('Output must be separate from the copy root')
    if not 0 < source.stat().st_size <= 8 * 1024 * 1024:
        p.error('Unexpected copy size')
    data = source.read_bytes()
    catalog = Path(__file__).resolve().parents[1] / 'data'
    report = analyze(data, parse_bytes(data, catalog / 'items.json', catalog / 'effects.json'))
    if args.guardian_table_offset is not None or args.guardian_row_count is not None or args.guardian_selector_offset:
        if args.guardian_table_offset is None or args.guardian_row_count is None:
            p.error('Guardian research requires both explicit table offset and row count')
        report['guardianTableCandidates'] = guardian_table_candidates(
            data, args.guardian_table_offset, args.guardian_row_count, args.guardian_selector_offset)
    report['inputHashUnchanged'] = hashlib.sha256(data).digest() == hashlib.sha256(source.read_bytes()).digest()
    if not report['inputHashUnchanged']:
        raise RuntimeError('Input changed during research')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'record-links.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('recordCount', 'groups', 'complete', 'inputHashUnchanged')}))


if __name__ == '__main__':
    main()
