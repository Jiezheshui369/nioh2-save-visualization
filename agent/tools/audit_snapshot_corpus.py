"""Audit structured snapshots without opening the original game save.

The corpus is made only of JSON produced from independent decrypted copies.  The
tool recalculates localization coverage, validates stable structural invariants,
and can enforce minimum coverage gates for release builds.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _is_translated(value: object, unknown_prefix: str) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not value.startswith(unknown_prefix)


def audit_snapshot(snapshot: dict[str, Any], path: Path) -> dict[str, Any]:
    errors: list[str] = []
    safety = snapshot.get("safety") or {}
    for key in ("sourceOpenedReadOnly", "parsedFromCopy", "originalHashUnchangedAfterProcessing"):
        if safety.get(key) is not True:
            errors.append(f"safety.{key} 不是 true")

    backup = snapshot.get("backupComparison")
    if backup and "copyHashesUnchangedAfterParsing" in backup and backup.get("copyHashesUnchangedAfterParsing") is not True:
        errors.append("backupComparison.copyHashesUnchangedAfterParsing 不是 true")

    loadout = snapshot.get("currentLoadout") or []
    indexes = [item.get("equipIndex") for item in loadout]
    if len(indexes) != len(set(indexes)):
        errors.append("当前装备槽编号重复")
    if any(not isinstance(index, int) or not 0 <= index <= 10 for index in indexes):
        errors.append("当前装备槽编号超出 0–10")

    equipment = snapshot.get("equipmentInventory") or []
    inventory = snapshot.get("inventoryItems") or []
    scrolls = snapshot.get("scrolls") or []
    effect_total = 0
    effect_translated = 0
    magnitude_decoded = 0
    for group_name, records in (("equipmentInventory", equipment), ("scrolls", scrolls)):
        for record in records:
            effects = record.get("effects") or []
            effects_zh = record.get("effectsZh") or []
            effect_ids = record.get("effectIds") or []
            effect_magnitudes = record.get("effectMagnitudes") or []
            if effects_zh and len(effects_zh) != len(effects):
                errors.append(f"{group_name}[{record.get('recordIndex', '?')}] 中英文词条数量不一致")
            if effect_ids and len(effect_ids) != len(effects):
                errors.append(f"{group_name}[{record.get('recordIndex', '?')}] 词条编号数量不一致")
            if effect_magnitudes and len(effect_magnitudes) != len(effects):
                errors.append(f"{group_name}[{record.get('recordIndex', '?')}] 词条数值数量不一致")
            effect_total += len(effects)
            effect_translated += sum(_is_translated(value, "未识别词条") for value in effects_zh)
            magnitude_decoded += sum(value is not None and bool(str(value).strip()) for value in effect_magnitudes)

    coverage = {
        "equipmentNames": {
            "translated": sum(_is_translated(item.get("nameZh"), "未知") for item in equipment),
            "total": len(equipment),
        },
        "inventoryNames": {
            "translated": sum(_is_translated(item.get("nameZh"), "未知") for item in inventory),
            "total": len(inventory),
        },
        "effects": {"translated": effect_translated, "total": effect_total},
        "effectMagnitudes": {"translated": magnitude_decoded, "total": effect_total},
    }
    return {
        "path": path.name,
        "snapshotId": snapshot.get("snapshotId"),
        "parserVersion": snapshot.get("parserVersion"),
        "coverage": coverage,
        "errors": errors,
    }


def audit_corpus(store: Path) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    for path in sorted(store.glob("*.json")):
        try:
            snapshot = json.loads(path.read_text(encoding="utf-8"))
            reports.append(audit_snapshot(snapshot, path))
        except (OSError, json.JSONDecodeError) as exc:
            reports.append({"path": path.name, "coverage": {}, "errors": [f"无法读取 JSON：{exc}"]})
    newest = reports[-1] if reports else None
    return {
        "schemaVersion": "1.0.0",
        "source": "structured-copy-snapshots-only",
        "snapshotCount": len(reports),
        "passed": bool(reports) and all(not report["errors"] for report in reports),
        "newest": newest,
        "reports": reports,
    }


def _percentage(bucket: dict[str, int]) -> float:
    return 100.0 if bucket["total"] == 0 else bucket["translated"] * 100.0 / bucket["total"]


def main() -> int:
    parser = argparse.ArgumentParser(description="审计只读副本生成的结构化快照语料")
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-equipment", type=float, default=0.0)
    parser.add_argument("--min-inventory", type=float, default=0.0)
    parser.add_argument("--min-effects", type=float, default=0.0)
    args = parser.parse_args()

    report = audit_corpus(args.store.resolve())
    newest = report["newest"]
    if newest:
        coverage = newest["coverage"]
        gates = {
            "equipmentNames": args.min_equipment,
            "inventoryNames": args.min_inventory,
            "effects": args.min_effects,
        }
        for key, minimum in gates.items():
            actual = _percentage(coverage[key])
            if actual + 1e-9 < minimum:
                newest["errors"].append(f"{key} 覆盖率 {actual:.1f}% 低于门槛 {minimum:.1f}%")
        report["passed"] = all(not item["errors"] for item in report["reports"])

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
