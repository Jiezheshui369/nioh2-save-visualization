"""Read-only, bounded DataTable ID-sequence research on already unpacked copies.

Container layout reference (not gameplay semantics):
https://github.com/neptuwunium/Cethleann/blob/develop/Cethleann/Tables/DataTable.cs
No extracted asset bytes or player archives are emitted. Matches remain hypotheses.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct


MAX_FILE_BYTES = 64 * 1024 * 1024


def blocks(data: bytes) -> list[tuple[int, int]]:
    if len(data) < 4 or len(data) > MAX_FILE_BYTES:
        raise ValueError('Container size outside research bounds')
    count = struct.unpack_from('<I', data)[0]
    if not 1 <= count <= 4096 or 4 + count * 8 > len(data):
        raise ValueError('Invalid container directory')
    result = []
    for index in range(count):
        offset, size = struct.unpack_from('<II', data, 4 + index * 8)
        if offset < 4 + count * 8 or offset > len(data) or size > len(data) - offset:
            raise ValueError('Block outside container; do not clamp truncated evidence')
        result.append((offset, size))
    return result


def sequence_candidates(data: bytes, ids: list[int], *, width: int = 4,
                        maximum_stride: int = 4096, maximum_results: int = 16) -> dict:
    if (width not in (2, 4) or not 3 <= len(ids) <= 128 or len(set(ids)) != len(ids)
            or any(type(value) is not int or not 0 < value < 2 ** (width * 8) for value in ids)
            or not width <= maximum_stride <= 4096 or not 1 <= maximum_results <= 64):
        raise ValueError('Distinct nonzero IDs and bounded widths/strides required')
    fmt = '<H' if width == 2 else '<I'
    # Alignment is relative to the containing block, not the whole file.
    wanted = set(ids)
    positions = {value: [] for value in ids}
    counts = Counter()
    for (value,), offset in zip(struct.iter_unpack(fmt, data[:len(data) // width * width]), range(0, len(data), width)):
        if value in wanted:
            counts[value] += 1
            if len(positions[value]) < 4096:
                positions[value].append(offset)
    candidates = []
    exact_count = 0
    # A full ordered sequence is stronger than individual equal integers, but
    # still cannot establish a row's name or whether a selection is active.
    first, second = positions[ids[0]], set(positions[ids[1]])
    for start in first:
        for stride in range(width, maximum_stride + 1, width):
            if start + stride not in second or start + (len(ids) - 1) * stride + width > len(data):
                continue
            if all(struct.unpack_from(fmt, data, start + index * stride)[0] == value for index, value in enumerate(ids[2:], 2)):
                exact_count += 1
                if len(candidates) < maximum_results:
                    candidates.append({'offset': start, 'stride': stride, 'width': width,
                                       'matchedIds': len(ids), 'verified': False})
    return {'width': width, 'distinctIdHits': len(counts), 'idHits': dict(counts),
            'completeSequenceCount': exact_count, 'candidates': candidates,
            'positionSearchTruncated': any(value > 4096 for value in counts.values()),
            'resultsTruncated': exact_count > len(candidates), 'semanticsVerified': False}


def permutation_candidates(data: bytes, ids: list[int], *, width: int = 4,
                           maximum_stride: int = 4096, maximum_results: int = 16,
                           maximum_probes: int = 2_000_000) -> dict:
    """Any permutation at a constant stride. Least-frequent ID anchors the search.

    Explicit probe and position bounds keep adversarial/dense blobs finite. A
    truncated zero result MUST NOT be interpreted as absence of this layout.
    """
    sequence_candidates(b'', ids, width=width, maximum_stride=maximum_stride, maximum_results=maximum_results)
    if type(maximum_probes) is not int or not 1 <= maximum_probes <= 2_000_000:
        raise ValueError('Probe budget must be bounded')
    fmt = '<H' if width == 2 else '<I'
    wanted = set(ids)
    positions = {value: [] for value in ids}
    counts = Counter()
    for offset in range(0, len(data) - width + 1, width):
        value = struct.unpack_from(fmt, data, offset)[0]
        if value in wanted:
            counts[value] += 1
            if len(positions[value]) < 4096:
                positions[value].append(offset)
    anchor = min(ids, key=lambda value: counts[value])
    result = {'width': width, 'distinctIdHits': len(counts), 'idHits': dict(counts),
              'completeSequenceCount': 0, 'candidates': [], 'probes': 0,
              'positionSearchTruncated': counts[anchor] > 4096,
              'probeSearchTruncated': False, 'resultsTruncated': False, 'semanticsVerified': False}
    if len(counts) != len(ids):
        return result
    longest_stride = min(maximum_stride, (len(data) - width) // (len(ids) - 1))
    for at in positions[anchor]:
        for stride in range(width, longest_stride + 1, width):
            for anchor_index in range(len(ids)):
                start = at - anchor_index * stride
                if start < 0 or start + (len(ids) - 1) * stride + width > len(data):
                    continue
                seen = set()
                for index in range(len(ids)):
                    if result['probes'] >= maximum_probes:
                        result['probeSearchTruncated'] = True
                        return result
                    result['probes'] += 1
                    value = struct.unpack_from(fmt, data, start + index * stride)[0]
                    if value not in wanted or value in seen:
                        break
                    seen.add(value)
                if len(seen) == len(ids):
                    result['completeSequenceCount'] += 1
                    if len(result['candidates']) < maximum_results:
                        result['candidates'].append({'offset': start, 'stride': stride, 'width': width,
                                                     'matchedIds': len(ids), 'verified': False})
                    else:
                        result['resultsTruncated'] = True
    return result


def ordered_ids(ids: list[int], order: str) -> list[int]:
    sequence_candidates(b'', ids)  # Validate IDs independently of container content.
    if order in ('record', 'permutation'):
        return list(ids)
    if order == 'ascending':
        return sorted(ids)
    if order == 'descending':
        return sorted(ids, reverse=True)
    raise ValueError('Unknown explicit ID order')


def inspect(data: bytes, ids: list[int], order: str = 'record') -> dict:
    ids = ordered_ids(ids, order)
    directory = blocks(data)
    found = []
    for index, (offset, size) in enumerate(directory):
        chunk = data[offset:offset + size]
        search = permutation_candidates if order == 'permutation' else sequence_candidates
        results = [search(chunk, ids, width=width) for width in (2, 4)
                   if max(ids) < 2 ** (width * 8)]
        found.append({'blockIndex': index, 'offset': offset, 'size': size, 'searches': results})
    return {'blockCount': len(directory), 'blocks': found, 'idOrder': order, 'semanticsVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unpacked-copy-root', type=Path, required=True)
    parser.add_argument('--id-report', type=Path, required=True,
                        help='Private record-links.json with guardianTableCandidates rows')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--id-order', choices=('record', 'ascending', 'descending', 'permutation'), default='record',
                        help='Explicit sequence hypothesis, never an inferred semantic mapping')
    args = parser.parse_args()
    root = args.unpacked_copy_root.resolve(strict=True)
    evidence = args.id_report.resolve(strict=True)
    output = args.output_dir.resolve()
    if not root.is_dir() or output == root or root in output.parents or output in root.parents or output in evidence.parents:
        parser.error('Output must be a new directory separate from all input roots')
    if output.exists():
        parser.error('Refusing to overwrite previous research')
    if evidence.stat().st_size > 16 * 1024 * 1024:
        parser.error('ID evidence exceeds research bound')
    evidence_bytes = evidence.read_bytes()
    ids = [row['idCandidate'] for row in json.loads(evidence_bytes)['guardianTableCandidates']['rows']]
    # Validate even when the input directory has no matching files.
    ordered_ids(ids, args.id_order)
    paths = sorted(root.glob('*.datatable'))
    if not 1 <= len(paths) <= 4096:
        parser.error('Expected 1..4096 unpacked DataTable files')
    files = []
    for path in paths:
        if path.is_symlink() or not path.is_file() or root not in path.resolve(strict=True).parents:
            parser.error('Input link or path outside the explicit copy root')
        if not 4 <= path.stat().st_size <= MAX_FILE_BYTES:
            files.append({'name': path.name, 'status': 'size-out-of-bounds'})
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        try:
            item = {'name': path.name, 'sha256': digest, 'status': 'inspected', **inspect(data, ids, args.id_order)}
        except ValueError as exc:
            item = {'name': path.name, 'sha256': digest, 'status': 'unsupported-container', 'reason': str(exc)}
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError('An unpacked input changed during inspection; report not written')
        files.append(item)
    if evidence.read_bytes() != evidence_bytes:
        raise RuntimeError('ID evidence changed during inspection; report not written')
    matches = sum(search['completeSequenceCount'] for item in files for block in item.get('blocks', []) for search in block['searches'])
    report = {'format': 'nioh2-datatable-id-research', 'version': 1, 'inputHashesUnchanged': True,
              'fileCount': len(files), 'idCount': len(ids), 'idOrder': args.id_order, 'completeSequenceMatches': matches,
              'semanticsVerified': False, 'files': files,
              'limitations': ['Only explicit little-endian 16/32-bit aligned constant-stride sequences in the reported idOrder were searched.',
                             'Permutation searches accept any ID order but never duplicate IDs in a candidate.',
                             'Truncated searches are incomplete. No match does not exclude packed, transformed or other resource tables.',
                             'Byte matches are not guardian names or active selection. Do not import this report as a character.']}
    output.mkdir(parents=True, exist_ok=False)
    (output / 'datatable-id-research.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('fileCount', 'idCount', 'completeSequenceMatches', 'inputHashesUnchanged', 'semanticsVerified')}))


if __name__ == '__main__':
    main()
