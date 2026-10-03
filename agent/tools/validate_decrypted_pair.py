"""Read-only regression check for two decrypted Nioh 2 save copies.

This tool never writes either input.  It is intended for controlled before/after
samples kept outside release artifacts and reports only structured differences.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from agent.binary_diff import change_summary
from agent.parser import PARSER_VERSION, parse_bytes


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def loadout_map(parsed: dict[str, Any]) -> dict[int, str]:
    return {int(item["equipIndex"]): str(item["id"]) for item in parsed["currentLoadout"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="只读比较两个已解密的仁王2存档副本")
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--items", type=Path, default=Path("agent/data/items.json"))
    parser.add_argument("--effects", type=Path, default=Path("agent/data/effects.json"))
    parser.add_argument("--expect-loadout-same", action="store_true")
    args = parser.parse_args()

    before_path = args.before.resolve()
    after_path = args.after.resolve()
    initial_hashes = {"before": sha256(before_path), "after": sha256(after_path)}
    before_bytes = before_path.read_bytes()
    after_bytes = after_path.read_bytes()
    before = parse_bytes(before_bytes, args.items, args.effects)
    after = parse_bytes(after_bytes, args.items, args.effects)
    before_loadout = loadout_map(before)
    after_loadout = loadout_map(after)

    report = {
        "parserVersion": PARSER_VERSION,
        "inputsOpenedReadOnly": True,
        "inputHashesUnchanged": initial_hashes == {"before": sha256(before_path), "after": sha256(after_path)},
        "changedByteRanges": change_summary(before_bytes, after_bytes)['changedRanges'],
        "before": {"level": before["character"]["level"], "loadout": before_loadout},
        "after": {"level": after["character"]["level"], "loadout": after_loadout},
        "loadoutChanged": before_loadout != after_loadout,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if not report["inputHashesUnchanged"]:
        raise RuntimeError("回归检查期间输入副本发生变化。")
    if args.expect_loadout_same and report["loadoutChanged"]:
        raise AssertionError("装备槽结构与预期不符：前后样本发生了变化。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
