"""Find PTRBUNDLE files containing requested text without modifying sources."""

from __future__ import annotations

import argparse
from pathlib import Path

from agent.tools.extract_official_localization import _ordered_strings


def main() -> None:
    parser = argparse.ArgumentParser(description="只读搜索 PTRBUNDLE 文本")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("terms", nargs="+")
    args = parser.parse_args()
    terms = tuple(term.casefold() for term in args.terms)
    for path in sorted(args.root.rglob("*.ptrbundle")):
        try:
            values = _ordered_strings(path.read_bytes())
        except (OSError, ValueError):
            continue
        matches = [value for value in values if any(term in value.casefold() for term in terms)]
        if matches:
            print(path)
            for value in matches[:8]:
                print("  " + ascii(value))


if __name__ == "__main__":
    main()
