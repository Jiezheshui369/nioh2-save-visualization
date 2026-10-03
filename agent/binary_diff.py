"""Read-only binary diff helpers for controlled save-file research."""

from __future__ import annotations

import argparse
import hashlib
from itertools import zip_longest
import json
from pathlib import Path
import stat

MAX_COPY_BYTES = 8 * 1024 * 1024


def iter_changed_spans(before: bytes, after: bytes, merge_gap: int = 8):
    """Yield (start, exclusive end, changed count) using constant working memory."""
    if type(merge_gap) is not int or not 0 <= merge_gap <= 65536:
        raise ValueError('merge_gap must be an integer from 0 to 65536')
    start = previous = None
    count = 0
    for index, (left, right) in enumerate(zip_longest(before, after)):
        if left == right:
            continue
        if previous is not None and index - previous > merge_gap + 1:
            yield start, previous + 1, count
            start, count = None, 0
        if start is None:
            start = index
        previous = index
        count += 1
    if start is not None:
        yield start, previous + 1, count


def change_summary(before: bytes, after: bytes, merge_gap: int = 8) -> dict[str, int]:
    """Counts only: used by the app without allocating private hex payloads."""
    ranges = changed = 0
    for _, _, count in iter_changed_spans(before, after, merge_gap):
        ranges += 1
        changed += count
    return {'changedBytes': changed, 'changedRanges': ranges}


def changed_ranges(before: bytes, after: bytes, merge_gap: int = 8) -> list[dict[str, object]]:
    """Return compact changed byte ranges without mutating either input."""
    return [
        {
            "offset": start,
            "offsetHex": f"0x{start:08X}",
            "length": end - start,
            "beforeHex": before[start:end].hex(" ").upper(),
            "afterHex": after[start:end].hex(" ").upper(),
        }
        for start, end, _ in iter_changed_spans(before, after, merge_gap)
    ]


def read_copy(path: Path) -> bytes:
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError('Input must be a regular copy file')
    with path.open('rb') as stream:
        data = stream.read(MAX_COPY_BYTES + 1)
    if not 0 < len(data) <= MAX_COPY_BYTES:
        raise ValueError('Copy must contain 1 byte to 8 MiB')
    return data


def build_report(before_path: Path, after_path: Path, merge_gap: int = 8,
                 *, max_ranges: int = 4096, preview_bytes: int = 64) -> dict[str, object]:
    if type(max_ranges) is not int or not 1 <= max_ranges <= 16384:
        raise ValueError('max_ranges must be from 1 to 16384')
    if type(preview_bytes) is not int or not 1 <= preview_bytes <= 256:
        raise ValueError('preview_bytes must be from 1 to 256')
    before, after = read_copy(before_path), read_copy(after_path)
    ranges = []
    range_count = changed = 0
    for start, end, count in iter_changed_spans(before, after, merge_gap):
        range_count += 1
        changed += count
        if len(ranges) < max_ranges:
            preview_end = min(end, start + preview_bytes)
            ranges.append({'offset': start, 'offsetHex': f'0x{start:08X}', 'length': end - start,
                           'changedBytes': count, 'beforeHex': before[start:preview_end].hex(' ').upper(),
                           'afterHex': after[start:preview_end].hex(' ').upper(),
                           'previewTruncated': end > preview_end})
    if read_copy(before_path) != before or read_copy(after_path) != after:
        raise RuntimeError('Copy changed during comparison; report discarded')
    return {
        "formatVersion": 2,
        "privateResearchOnly": True,
        "before": before_path.name,
        "after": after_path.name,
        "beforeSha256": hashlib.sha256(before).hexdigest(),
        "afterSha256": hashlib.sha256(after).hexdigest(),
        "beforeSize": len(before),
        "afterSize": len(after),
        "mergeGap": merge_gap,
        "changedBytes": changed,
        "changedRanges": range_count,
        "rangesTruncated": range_count > len(ranges),
        "previewBytes": preview_bytes,
        "inputHashesUnchanged": True,
        "ranges": ranges,
    }


def validate_paths(copy_root: Path, before: Path, after: Path, output: Path | None):
    root = copy_root.resolve(strict=True)
    inputs = [path.resolve(strict=True) for path in (before, after)]
    if not root.is_dir() or any(root not in path.parents for path in inputs):
        raise ValueError('Both inputs must be inside the explicit COPY root')
    destination = output.resolve() if output is not None else None
    if destination is not None:
        if destination == root or root in destination.parents or destination in root.parents:
            raise ValueError('Output must be separate from the COPY root')
        if destination.exists() or output.is_symlink():
            raise FileExistsError('Output already exists; choose a new report path')
    return inputs[0], inputs[1], destination


def write_new_report(output: Path, report: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation rejects aliases/hard links/symlinks and concurrent writers.
    with output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def main() -> None:
    parser = argparse.ArgumentParser(description="比较两个解密后的存档副本，只生成只读差分报告。")
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument('--copy-root', type=Path, required=True)
    parser.add_argument("--merge-gap", type=int, default=8)
    parser.add_argument("--output", type=Path)
    parser.add_argument('--max-ranges', type=int, default=4096)
    parser.add_argument('--preview-bytes', type=int, default=64)
    args = parser.parse_args()

    try:
        before, after, output = validate_paths(args.copy_root, args.before, args.after, args.output)
        report = build_report(before, after, args.merge_gap, max_ranges=args.max_ranges, preview_bytes=args.preview_bytes)
        if output is not None:
            write_new_report(output, report)
    except (ValueError, OSError, RuntimeError) as exc:
        parser.error(str(exc))
    if output is not None:
        print(json.dumps({key: report[key] for key in ('changedBytes', 'changedRanges', 'rangesTruncated', 'inputHashesUnchanged')}))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
