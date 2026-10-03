"""Prioritize unknown fields using structured COPY snapshots, never original saves.

This is an evidence inventory, not a decoder. A non-numeric CAP is not proof of
a boolean effect, and a catalogue grade is not the grade stored in a save.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def analyze(snapshot: dict, catalogue: list[dict]) -> dict:
    catalog = {str(row.get('id', '')).upper(): row for row in catalogue}
    buckets: Counter = Counter()
    missing_names: Counter = Counter()
    missing_values: Counter = Counter()
    unknown_items: Counter = Counter()
    types: Counter = Counter()
    total = 0
    for group in ('equipmentInventory', 'scrolls'):
        for record in snapshot.get(group, []):
            types[record.get('type', 'Scroll' if group == 'scrolls' else 'Unknown')] += 1
            if not record.get('nameZh') or str(record.get('nameZh')).startswith('未识别'):
                unknown_items[(group, record.get('id', '?'))] += 1
            for i, name in enumerate(record.get('effects', [])):
                total += 1
                ids, zh, values = (record.get(k, []) for k in ('effectIds', 'effectsZh', 'effectMagnitudes'))
                eid = str(ids[i]).upper() if i < len(ids) else '?'
                if i >= len(zh) or not zh[i] or str(zh[i]).startswith('未识别'):
                    missing_names[(eid, name)] += 1
                if i < len(values) and values[i] is not None and str(values[i]).strip():
                    buckets['decodedNumeric'] += 1
                    continue
                entry = catalog.get(eid)
                if entry is None:
                    reason = 'noCatalogueEntry'
                else:
                    cap = str(entry.get('CAP', '')).strip()
                    try:
                        float(cap)
                        reason = 'numericCatalogueButMissingValue'
                    except ValueError:
                        reason = 'nonNumericCatalogue' if cap else 'emptyCatalogueCap'
                buckets[reason] += 1
                missing_values[(eid, name, reason)] += 1
    for record in snapshot.get('inventoryItems', []):
        if not record.get('nameZh') or str(record.get('nameZh')).startswith('未识别'):
            unknown_items[('inventoryItems', record.get('id', '?'))] += 1
    return {
        'schemaVersion': 1,
        'source': 'structured-copy-snapshot-only',
        'parserVersion': snapshot.get('parserVersion'),
        'effectOccurrences': total,
        'valueCoverage': dict(buckets),
        'recordTypes': dict(types),
        'missingEffectNames': [dict(id=k[0], name=k[1], occurrences=v) for k, v in missing_names.most_common()],
        'missingEffectValues': [dict(id=k[0], name=k[1], reason=k[2], occurrences=v) for k, v in missing_values.most_common()],
        'missingItemNames': [dict(group=k[0], id=k[1], occurrences=v) for k, v in unknown_items.most_common()],
        'limitations': [
            'Counts describe this snapshot, not every Nioh 2 save.',
            'Missing numeric text may be a grade, flag, set bonus, or undecoded value; these are not interchangeable.',
            'Equipped scroll, guardian spirits, final combat statistics, skill trees, mission flags, collections and clan remain unverified.',
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser(description='Inventory parser gaps without opening original save files')
    p.add_argument('--snapshot', type=Path, required=True)
    p.add_argument('--catalogue', type=Path, default=Path(__file__).resolve().parents[1] / 'data/effects.json')
    args = p.parse_args()
    if args.snapshot.suffix.lower() != '.json':
        p.error('Only structured JSON snapshots are supported; no SAVEDATA input.')
    before = args.snapshot.read_bytes()
    result = analyze(json.loads(before), json.loads(args.catalogue.read_text(encoding='utf-8')))
    result['inputUnchanged'] = hashlib.sha256(before).digest() == hashlib.sha256(args.snapshot.read_bytes()).digest()
    if not result['inputUnchanged']:
        raise RuntimeError('Snapshot changed during analysis')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
