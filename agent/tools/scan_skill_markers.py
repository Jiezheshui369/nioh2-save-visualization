"""Research-only search for explicit screenshot marker sequences in a COPY.

UI order, flag layout and current skill ranks are NOT known. Every result is a
hypothesis, never a production skill field. No screenshot constants live here.
"""
from __future__ import annotations

import argparse
import hashlib
from itertools import permutations
import json
from pathlib import Path

from agent.binary_diff import MAX_COPY_BYTES, read_copy

MARKERS = ('none', 'upward', 'circle')
REVERSE_BITS = bytes(int(f'{value:08b}'[::-1], 2) for value in range(256))


def sequences(document: dict) -> list[dict]:
    rows = document.get('sequences') if isinstance(document, dict) else None
    if not isinstance(rows, list) or not 1 <= len(rows) <= 12:
        raise ValueError('Expected 1..12 explicitly observed sequences')
    result, ids = [], set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not 1 <= len(row['id']) <= 80 or row['id'] in ids:
            raise ValueError('Each sequence requires a distinct short ID')
        entries = row.get('entries')
        if not isinstance(entries, list) or not 16 <= len(entries) <= 256:
            raise ValueError('Sequences require 16..256 complete visible entries')
        markers = []
        for entry in entries:
            if not isinstance(entry, dict) or entry.get('marker') not in MARKERS:
                raise ValueError('Use circle, upward or none; cropped/unknown entries cannot be guessed')
            # Preserve text in the input, but do not infer integer ranks from it.
            if not isinstance(entry.get('label'), str) or not 1 <= len(entry['label']) <= 160:
                raise ValueError('Each observed entry requires a label')
            markers.append(entry['marker'])
        if len(set(markers)) < 2:
            raise ValueError('Uniform sequences are too ambiguous for this tool')
        ids.add(row['id'])
        result.append(dict(id=row['id'], markers=markers, entries=entries))
    return result


def rank_hypotheses(entries: list[dict]) -> list[tuple[str, list[int]]]:
    """Try both readings of upgrade text, without deciding which one is true.

    A circled entry with no displayed suffix is hypothetically a one-rank node;
    this is explicitly NOT a proven maximum-rank table. Unknown suffixes skip
    these hypotheses instead of becoming zero.
    """
    known = {'壹': 1, '贰': 2, '参': 3, '1': 1, '2': 2, '3': 3}
    result = []
    for mode, adjustment in [('shown-rank-is-current', 0), ('upward-shows-next-rank', 1)]:
        values = []
        for entry in entries:
            marker = entry['marker']
            if marker == 'none':
                values.append(0)
                continue
            suffix = entry.get('rankText')
            if suffix is None and marker == 'circle':
                values.append(1)
                continue
            if not isinstance(suffix, str) or suffix not in known:
                break
            values.append(known[suffix] - (adjustment if marker == 'upward' else 0))
        else:
            if len(set(values)) > 1:
                result.append((mode, values))
    return result


def packed_matches(data: bytes, bits: str, examples: int, budget: list[int]) -> dict:
    """Masked byte search for all bit phases without expanding the whole copy.

    budget is shared across hypotheses. Counts are complete only when
    searchTruncated is false; retained examples are independently bounded.
    """
    count, matches, truncated = 0, [], False
    for phase in range(8):
        tail = -(phase + len(bits)) % 8
        pattern = '0' * phase + bits + '0' * tail
        mask_bits = '0' * phase + '1' * len(bits) + '0' * tail
        target = int(pattern, 2).to_bytes(len(pattern) // 8, 'big')
        mask = int(mask_bits, 2).to_bytes(len(pattern) // 8, 'big')
        first = 1 if phase else 0
        end = len(mask) - (1 if tail else 0)
        anchor = target[first:end]
        at = data.find(anchor)
        while at >= 0:
            if budget[0] <= 0:
                truncated = True
                break
            budget[0] -= 1
            start = at - first
            if 0 <= start and start + len(mask) <= len(data) and all(
                    (data[start + i] & m) == t for i, (m, t) in enumerate(zip(mask, target))):
                count += 1
                if len(matches) < examples:
                    matches.append(dict(byteOffset=start, bitPhase=phase))
            at = data.find(anchor, at + 1)
        if truncated:
            break
    return dict(matchCount=count, examples=matches, examplesTruncated=count > len(matches), searchTruncated=truncated)


def scan(data: bytes, document: dict, *, examples: int = 16, max_checks: int = 1_000_000) -> dict:
    if not isinstance(data, bytes) or len(data) > MAX_COPY_BYTES:
        raise ValueError('Expected immutable copy bytes, at most 8 MiB')
    if type(examples) is not int or not 1 <= examples <= 64:
        raise ValueError('examples must be 1..64')
    if type(max_checks) is not int or not 1 <= max_checks <= 2_000_000:
        raise ValueError('max_checks must be 1..2000000')
    observed = sequences(document)
    budget, results = [max_checks], []
    reversed_data = data.translate(REVERSE_BITS)
    for sequence in observed:
        hypotheses = [('learned-flag', {'none': 0, 'upward': 1, 'circle': 1}, 1),
                      ('maxed-flag', {'none': 0, 'upward': 0, 'circle': 1}, 1)]
        hypotheses += [(f'marker-codes-{a}{b}{c}', dict(zip(MARKERS, (a, b, c))), 2)
                       for a, b, c in permutations(range(3))]
        encoded = [(label, mapping, width, [mapping[m] for m in sequence['markers']])
                   for label, mapping, width in hypotheses]
        encoded += [(label, None, 2, values) for label, values in rank_hypotheses(sequence['entries'])]
        for label, mapping, width, values in encoded:
            if len(set(values)) < 2:
                continue
            bits = ''.join(f'{value:0{width}b}' for value in values)
            for order, blob in [('msb-first', data), ('lsb-first', reversed_data)]:
                found = packed_matches(blob, bits, examples, budget)
                results.append(dict(sequence=sequence['id'], hypothesis=label, markerCodes=mapping,
                                    encoding=f'packed-{width}bit-{order}', verified=False, **found))
            for size in (1, 2, 4):
                for endian in (('little',) if size == 1 else ('little', 'big')):
                    pattern = b''.join(value.to_bytes(size, endian) for value in values)
                    count, matches = 0, []
                    at = data.find(pattern)
                    truncated = False
                    while at >= 0:
                        if budget[0] <= 0:
                            truncated = True
                            break
                        budget[0] -= 1
                        count += 1
                        if len(matches) < examples:
                            matches.append(dict(byteOffset=at, naturallyAligned=at % size == 0))
                        at = data.find(pattern, at + 1)
                    results.append(dict(sequence=sequence['id'], hypothesis=label, markerCodes=mapping,
                                        encoding=f'uint{size * 8}-{endian}', verified=False, matchCount=count,
                                        examples=matches, examplesTruncated=count > len(matches), searchTruncated=truncated))
    return dict(version=1, researchOnly=True, complete=False, newVerifiedFields=0,
                sequenceCount=len(observed), checksUsed=max_checks - budget[0],
                searchTruncated=any(row['searchTruncated'] for row in results), results=results,
                limitations=['UI list order is not a verified save array order.',
                             'The two flags and six marker-code permutations are finite hypotheses, not known encodings.',
                             'Two rank hypotheses try current/next upgrade text and unsuffixed circled nodes as rank 1; neither is established.',
                             'No current rank is promoted from these hypotheses; missing skills are not zero.',
                             'Matches do not establish skill IDs, learned ranks, active mysteries or final character bonuses.',
                             'Zero matches cannot exclude indirect, reordered, sparse or other skill storage.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--copy-root', type=Path, required=True)
    parser.add_argument('--decrypted-copy', type=Path, required=True)
    parser.add_argument('--observations', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    root, source, observations = (p.resolve(strict=True) for p in (args.copy_root, args.decrypted_copy, args.observations))
    output = args.output_dir.resolve()
    if not root.is_dir() or root not in source.parents:
        parser.error('Input must be inside the explicit COPY root')
    if output == root or root in output.parents or output in source.parents or output in observations.parents:
        parser.error('Output must be separate from inputs and copy root')
    data, raw_observations = read_copy(source), read_copy(observations)
    report = scan(data, json.loads(raw_observations))
    if read_copy(source) != data or read_copy(observations) != raw_observations:
        raise RuntimeError('An input changed during research; report discarded')
    report.update(inputsUnchanged=True, copySha256=hashlib.sha256(data).hexdigest(),
                  observationSha256=hashlib.sha256(raw_observations).hexdigest())
    output.mkdir(parents=True, exist_ok=False)
    with (output / 'skill-marker-candidates.json').open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps(dict(sequenceCount=report['sequenceCount'], hypotheses=len(report['results']),
                          hypothesesWithMatches=sum(r['matchCount'] > 0 for r in report['results']),
                          searchTruncated=report['searchTruncated'], inputsUnchanged=True, newVerifiedFields=0)))


if __name__ == '__main__':
    main()
