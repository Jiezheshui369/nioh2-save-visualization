"""Print plausible UTF-16LE strings and offsets from a read-only save copy."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


PRINTABLE = re.compile(r"^[\u0020-\u007e\u3000-\u30ff\u3400-\u9fff]+$")


def scan(path: Path, minimum: int) -> list[tuple[int, str]]:
    data = path.read_bytes()
    results: list[tuple[int, str]] = []
    for alignment in (0, 1):
        start: int | None = None
        offset = alignment
        while offset + 1 < len(data):
            codepoint = int.from_bytes(data[offset : offset + 2], "little")
            character = chr(codepoint)
            if PRINTABLE.fullmatch(character):
                if start is None:
                    start = offset
            else:
                if codepoint == 0 and start is not None:
                    value = data[start:offset].decode("utf-16le", errors="replace").strip()
                    if len(value) >= minimum:
                        results.append((start, value))
                start = None
            offset += 2
    return sorted(results)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="只读扫描解密副本中的 UTF-16LE 文本")
    parser.add_argument("input", type=Path)
    parser.add_argument("--minimum", type=int, default=3)
    args = parser.parse_args()
    for offset, value in scan(args.input, args.minimum):
        print(f"0x{offset:08X}\t{value}")


if __name__ == "__main__":
    main()
