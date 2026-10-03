"""Research only: locate floats compatible with displayed precision in a COPY.

Unlike exact-byte searching, this checks conservative nearest-rounding and
truncation intervals. A match does not establish a saved character field. No
production parser imports this module; no screenshot constants are embedded.
"""
from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re
import struct

from agent.binary_diff import MAX_COPY_BYTES, read_copy
from agent.tools.analyze_character_status import panel_search_value


def targets_from_audit(audit: dict) -> list[dict]:
    rows = audit.get('rows')
    if not isinstance(rows, list) or len(rows) > 512:
        raise ValueError('Expected bounded status-audit rows')
    targets = []
    for index, row in enumerate(rows):
        if row.get('section') != 'panel' or row.get('status') != 'unverified-final-value':
            continue
        label, observed = row.get('label'), row.get('observed')
        if not isinstance(label, str) or not isinstance(observed, str) or len(observed) > 128:
            raise ValueError('Expected short labelled panel observations')
        value = panel_search_value(label, observed)
        # Retain each component of weight pairs; maxima selection happens above.
        tokens = re.findall(r'(?<![\w.])[+-]?\d+(?:\.\d+)?', value.replace(',', '').replace('−', '-'))
        for component, token in enumerate(tokens):
            number = Decimal(token)
            if not number or abs(number) > Decimal('1e15'):
                continue  # Zero/subnormal matches are not useful evidence.
            quantum = Decimal(1).scaleb(number.as_tuple().exponent)
            nearest = (number - quantum / 2, number + quantum / 2)
            truncated = (number, number + quantum) if number > 0 else (number - quantum, number)
            targets.append(dict(rowIndex=index, component=component, label=label, display=token,
                                nearest=[float(x) for x in nearest],
                                truncated=[float(x) for x in truncated]))
    if len(targets) > 128:
        raise ValueError('Too many numeric targets')
    return targets


def scan(data: bytes, audit: dict, *, examples: int = 12) -> dict:
    if not isinstance(data, bytes) or len(data) > MAX_COPY_BYTES:
        raise ValueError('Expected immutable copy bytes, at most 8 MiB')
    if type(examples) is not int or not 1 <= examples <= 64:
        raise ValueError('examples must be an integer from 1 to 64')
    targets = targets_from_audit(audit)
    intervals = sorted((min(t['nearest'][0], t['truncated'][0]),
                        max(t['nearest'][1], t['truncated'][1]), i) for i, t in enumerate(targets))
    lower = [lo for lo, _, _ in intervals]
    max_width = max((hi - lo for lo, hi, _ in intervals), default=0)
    max_hi = max((hi for _, hi, _ in intervals), default=0)
    results = []
    for fmt, name, width in [('<f', 'float32-le', 4), ('>f', 'float32-be', 4),
                             ('<d', 'float64-le', 8), ('>d', 'float64-be', 8)]:
        counts = [dict(matchCount=0, alignedCount=0, nearestCount=0, truncationCount=0,
                       candidates=[]) for _ in targets]
        unpack = struct.Struct(fmt).unpack_from
        # Every byte start: report natural alignment separately, do not assume it.
        if intervals:
            for offset in range(max(0, len(data) - width + 1)):
                value = unpack(data, offset)[0]
                if not math.isfinite(value) or value < lower[0] or value > max_hi:
                    continue
                start = bisect_left(lower, math.nextafter(value - max_width, -math.inf))
                end = bisect_right(lower, value)
                for lo, hi, index in intervals[start:end]:
                    if value > hi:
                        continue
                    t, count = targets[index], counts[index]
                    nearest = t['nearest'][0] <= value <= t['nearest'][1]
                    truncated = t['truncated'][0] <= value <= t['truncated'][1]
                    if not nearest and not truncated:
                        continue
                    count['matchCount'] += 1
                    count['alignedCount'] += offset % width == 0
                    count['nearestCount'] += nearest
                    count['truncationCount'] += truncated
                    if len(count['candidates']) < examples:
                        count['candidates'].append(dict(offset=f'0x{offset:X}', stored=value,
                                                       nearest=nearest, truncated=truncated))
        for target, count in zip(targets, counts):
            results.append(dict(**target, encoding=name, **count,
                                examplesTruncated=count['matchCount'] > examples, verified=False))
    return dict(version=1, complete=False, newVerifiedFields=0, targetCount=len(targets),
                searchedEveryByteStart=True, results=results, limitations=[
                    'Closed interval endpoints deliberately include uncertain rounding ties.',
                    'Stored units are assumed to equal displayed units for this search only.',
                    'Zero and letter-only fields are excluded; ratio/fixed-point/packed encodings are not covered.',
                    'Coincident float interpretations do not prove field identity or active state.',
                    'No matches does not prove a value is absent or runtime-computed.',
                ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True, type=Path)
    parser.add_argument('--copy-root', required=True, type=Path)
    parser.add_argument('--decrypted-copy', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    root, save, audit_path, output = [p.resolve() for p in
                                    (args.copy_root, args.decrypted_copy, args.audit, args.output_dir)]
    if root not in save.parents or root == output or root in output.parents or output in save.parents:
        parser.error('Use an explicit COPY root and a separate output directory')
    if output.exists():
        parser.error('Refusing to overwrite research output')
    evidence, data = read_copy(audit_path), read_copy(save)
    report = scan(data, json.loads(evidence))
    report['inputsUnchanged'] = all(hashlib.sha256(before).digest() == hashlib.sha256(read_copy(path)).digest()
                                   for before, path in [(evidence, audit_path), (data, save)])
    if not report['inputsUnchanged']:
        raise RuntimeError('Input changed during read-only research')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'precision-candidates.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(dict(targetCount=report['targetCount'],
                          targetsWithMatches=len({r['rowIndex'] for r in report['results'] if r['matchCount']}),
                          newVerifiedFields=0, inputsUnchanged=True)))


if __name__ == '__main__':
    main()
