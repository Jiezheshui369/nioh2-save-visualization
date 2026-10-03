"""Merge generated localization catalogs into one deterministic JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser(description="合并只读提取出的本地化目录")
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    merged_items: dict[str, str] = {}
    merged_effects: dict[str, str] = {}
    sources: list[str] = []
    for path in args.input:
        payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        sources.append(str(payload.get("source", path.name)))
        for item_id, name in payload.get("items", {}).items():
            merged_items.setdefault(str(item_id).upper(), str(name))
        for effect_id, name in payload.get("effects", {}).items():
            merged_effects.setdefault(str(effect_id).upper(), str(name))
    output = {
        "schemaVersion": "1.1.0",
        "source": sources,
        "items": dict(sorted(merged_items.items())),
        "effects": dict(sorted(merged_effects.items())),
        "stats": {"items": len(merged_items), "effects": len(merged_effects)},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(output["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
