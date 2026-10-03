"""Read-only parser for a decrypted Nioh 2 PC save copy.

Offsets are isolated here so they can be versioned and regression-tested. This
module has no write functions and accepts immutable ``bytes`` only.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PARSER_VERSION = "0.9.9"
EFFECT_VALUE_RULES = json.loads((Path(__file__).parent / "data" / "effect_value_rules.json").read_text(encoding="utf-8"))
MIN_SAVE_SIZE = 0x294080
LOADOUT_NAME_OFFSET = 0x213BA8
LOADOUT_NAME_CODE_UNITS = 32


OFFSETS = {
    "amrita": (0x7B8D0, 8),
    "gold": (0x7B8D8, 8),
    "level": (0x1C4904, 4),
    "constitution": (0x1C490C, 4),
    "heart": (0x1C4910, 4),
    "stamina": (0x1C4914, 4),
    "strength": (0x1C4918, 4),
    "skill": (0x1C491C, 4),
    "dexterity": (0x1C4920, 4),
    "magic": (0x1C4924, 4),
    "courage": (0x1C4928, 4),
}

PROFICIENCY_OFFSETS = {
    "sword": 0x1C4A8C,
    "dualSwords": 0x1C4A98,
    "spear": 0x1C4AA4,
    "axe": 0x1C4AB0,
    "kusarigama": 0x1C4ABC,
    "odachi": 0x1C4AC8,
    "tonfa": 0x1C4AD4,
    "hatchets": 0x1C4AE0,
    "switchglaive": 0x1C4AEC,
    "splitstaff": 0x1C4AF8,
    "fists": 0x1C4B04,
    "ninjutsu": 0x1C4B58,
    "onmyo": 0x1C4B64,
}

# Community SaveWizard addresses are for the PS4 decrypted layout. The PC
# decrypted layout used by Katana is consistently +0x148 for this block.
# Keep the source terminology (temporary/permanent) until controlled in-game
# samples prove a more precise player-facing meaning.
SKILL_POINT_OFFSETS = {
    "sword": (0x1C4930, 0x1C4934),
    "dualSwords": (0x1C4940, 0x1C4944),
    "spear": (0x1C4950, 0x1C4954),
    "axe": (0x1C4960, 0x1C4964),
    "kusarigama": (0x1C4970, 0x1C4974),
    "odachi": (0x1C4980, 0x1C4984),
    "tonfa": (0x1C4990, 0x1C4994),
    "hatchets": (0x1C49A0, 0x1C49A4),
    "switchglaive": (0x1C49B0, 0x1C49B4),
    "splitstaff": (0x1C49C0, 0x1C49C4),
    "fists": (0x1C49D0, 0x1C49D4),
    "samurai": (0x1C4A30, 0x1C4A34),
    "ninjutsu": (0x1C4A40, 0x1C4A44),
    "onmyo": (0x1C4A50, 0x1C4A54),
    "shiftling": (0x1C4A60, 0x1C4A64),
}

EQUIPMENT_START = 0xED508
EQUIPMENT_SIZE = 0x90
EQUIPMENT_SLOTS = 700
STACKED_ITEM_START = 0x105EC8
STACKED_ITEM_SIZE = 0x88
STACKED_ITEM_SLOTS = 900
SCROLL_START = 0x294080
SCROLL_SIZE = 0x88
SCROLL_SLOTS = 248

EQUIP_SLOTS = {
    0: "melee1",
    1: "melee2",
    2: "head",
    3: "torso",
    4: "arms",
    5: "legs",
    6: "feet",
    7: "accessory1",
    8: "accessory2",
    9: "ranged1",
    10: "ranged2",
}

RARITIES = {0: "Common", 1: "Uncommon", 2: "Rare", 3: "Exotic", 4: "Divine", 5: "Ethereal"}


def _u(data: bytes, offset: int, size: int) -> int:
    end = offset + size
    if offset < 0 or end > len(data):
        raise ValueError(f"字段越界：0x{offset:X}+{size}")
    return int.from_bytes(data[offset:end], "little", signed=False)


def _swapped_id(raw: int) -> str:
    return f"{((raw & 0xFF) << 8) | (raw >> 8):04X}"


def _utf16le_z(data: bytes, offset: int, code_units: int) -> str | None:
    if offset < 0 or offset + code_units * 2 > len(data):
        return None
    raw = data[offset : offset + code_units * 2]
    terminator = next((index for index in range(0, len(raw), 2) if raw[index : index + 2] == b"\0\0"), len(raw))
    try:
        value = raw[:terminator].decode("utf-16le").strip()
    except UnicodeDecodeError:
        return None
    if not value or any(ord(character) < 0x20 for character in value):
        return None
    return value


def _load_items(path: Path) -> dict[str, dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("items.json 格式错误")
    return {(str(key).upper().zfill(4) if len(str(key)) <= 4 else str(key).upper()): value for key, value in raw.items()}


def _load_effects(path: Path) -> dict[str, dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("effects.json 格式错误")
    return {str(item.get("id", "")).upper(): item for item in raw if item.get("id")}


def _load_zh_names(items_path: Path) -> dict[str, str]:
    path = items_path.parent / "official_zh_cn.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw.get("items", {}) if isinstance(raw, dict) else {}
    names = {
        (str(key).upper().zfill(4) if len(str(key)) <= 4 else str(key).upper()): str(value)
        for key, value in items.items()
    }
    for catalog_name in ("soul_core_zh_cn.json", "verified_variant_zh_cn.json"):
        catalog_path = items_path.parent / catalog_name
        if catalog_path.exists():
            catalog_raw = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog_items = catalog_raw.get("items", {}) if isinstance(catalog_raw, dict) else {}
            names.update({
                (str(key).upper().zfill(4) if len(str(key)) <= 4 else str(key).upper()): str(value)
                for key, value in catalog_items.items()
            })
    return names


def _load_zh_effects(effects_path: Path) -> dict[str, str]:
    path = effects_path.parent / "official_effects_zh_cn.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    effects = raw.get("effects", {}) if isinstance(raw, dict) else {}
    names = {str(key).upper(): str(value) for key, value in effects.items()}
    overlay_path = effects_path.parent / "verified_effect_templates_zh_cn.json"
    if overlay_path.exists():
        overlay_raw = json.loads(overlay_path.read_text(encoding="utf-8"))
        overlay = overlay_raw.get("effects", {}) if isinstance(overlay_raw, dict) else {}
        names.update({str(key).upper(): str(value) for key, value in overlay.items()})
    return names


def _tenths(raw: int) -> str:
    """Format uint32 tenths exactly, including modified values, without float rounding."""
    whole, fraction = divmod(raw, 10)
    return f"{whole}.{fraction}" if fraction else str(whole)


def _format_effect_magnitude(effect: dict[str, Any] | None, raw: int) -> str | None:
    if not effect:
        return None
    # CAP is a community maximum, not a unit declaration. These integer CAPs
    # encode tenths and were checked against the user's game status panel.
    # Scope by ID: never reinterpret every CAP=1/2 field as a percentage.
    effect_id = str(effect.get("id", "")).upper()
    if effect_id in EFFECT_VALUE_RULES["conditionIds"] or effect_id in EFFECT_VALUE_RULES["unverifiedUnitIds"]:
        return None  # A condition is not a bonus; uncertain Anima scales stay unknown.
    if effect_id in EFFECT_VALUE_RULES["verifiedGradeValues"]:
        # Sparse evidence, not a universal grade ladder. Unknown raw values must
        # not fall through to CAP, even when a catalog incorrectly supplies a number.
        return EFFECT_VALUE_RULES["verifiedGradeValues"][effect_id].get(str(raw))
    if effect_id in EFFECT_VALUE_RULES["verifiedDecimalIds"]:  # ID-specific tenths: weight and screenshot-checked core Anima.
        return _tenths(raw)
    if effect_id in EFFECT_VALUE_RULES["verifiedPercentIds"]:  # ID-specific screenshot-correlated tenths of a percent.
        return f"{_tenths(raw)}%"
    cap = str(effect.get("CAP", "")).strip()
    try:
        cap_number = float(cap)
    except ValueError:
        return None
    if "." in cap:
        magnitude = raw / 10
        if cap_number < 0:
            magnitude = -magnitude
        return f"{magnitude:g}%"
    return str(-raw if cap_number < 0 else raw)


def _effect_names(
    data: bytes,
    record_offset: int,
    effects: dict[str, dict[str, Any]],
    zh_effects: dict[str, str],
) -> tuple[list[str], list[str | None], list[str], list[str | None]]:
    names: list[str] = []
    names_zh: list[str | None] = []
    ids: list[str] = []
    magnitudes: list[str | None] = []
    for index in range(7):
        effect_id = _u(data, record_offset + 48 + index * 12, 4) & 0xFFFF
        if effect_id in {0, 0xFFFF}:
            continue
        effect_key = f"{effect_id:04X}"
        effect = effects.get(effect_key)
        raw_magnitude = _u(data, record_offset + 52 + index * 12, 4)
        ids.append(effect_key)
        names.append(str(effect.get("Effect")) if effect else f"Unknown effect {effect_id:04X}")
        names_zh.append(zh_effects.get(effect_key))
        magnitudes.append(_format_effect_magnitude(effect, raw_magnitude))
    return names, names_zh, ids, magnitudes


def _effect_value_details(data: bytes, offset: int, effects: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Preserve raw uint32 values and classify evidence, without deriving totals or activation."""
    details = []
    for index in range(7):
        effect_id = _u(data, offset + 48 + index * 12, 4) & 0xFFFF
        if effect_id in {0, 0xFFFF}:
            continue
        key = f"{effect_id:04X}"
        effect = effects.get(key)
        cap = str((effect or {}).get("CAP", "")).strip()
        raw = _u(data, offset + 52 + index * 12, 4)
        kind, encoding = "unknown", "not-decoded"
        if key in EFFECT_VALUE_RULES["conditionIds"]:
            kind = "condition"
        elif key in EFFECT_VALUE_RULES["unverifiedUnitIds"]:
            kind = "unverified-unit"
        elif effect and key in EFFECT_VALUE_RULES["verifiedGradeValues"]:
            if _format_effect_magnitude(effect, raw) is not None:
                kind, encoding = "grade", "verified-id"
            else:
                kind = "unresolved-grade"
        elif effect and key in EFFECT_VALUE_RULES["verifiedDecimalIds"] + EFFECT_VALUE_RULES["verifiedPercentIds"]:
            kind, encoding = "numeric", "verified-id"
        elif cap.lower() == "(passive)":
            kind = "non-numeric"
        elif cap in {"D", "D+", "D-", "C", "C+", "C-", "B", "B+", "B-", "A", "A+", "A-", "AA", "AA+", "AA-", "AAA", "AAA+", "AAA-"}:
            kind = "unresolved-grade"
        elif _format_effect_magnitude(effect, raw) is not None:
            kind, encoding = "numeric", "legacy-cap"
        details.append({"rawValue": raw, "kind": kind, "encoding": encoding})
    return details


def _set_or_grace(names: list[str]) -> str:
    for name in names:
        if name.startswith("Grace of ") or name.endswith("'s Grace") or name in {"Onmyo Austerity"}:
            return name
    return "未识别套装"


def _equipment_record(
    data: bytes,
    offset: int,
    record_index: int,
    items: dict[str, dict[str, str]],
    effects: dict[str, dict[str, Any]],
    zh_names: dict[str, str],
    zh_effects: dict[str, str],
) -> dict[str, Any] | None:
    raw_id = _u(data, offset, 2)
    if raw_id == 0:
        return None
    item_id = _swapped_id(raw_id)
    item_meta = items.get(item_id)
    effect_names, effect_names_zh, effect_ids, effect_magnitudes = _effect_names(data, offset, effects, zh_effects)
    return {
        "recordIndex": record_index,
        "equipIndex": _u(data, offset + 136, 1),
        "id": item_id,
        "name": item_meta.get("name") if item_meta else f"Unknown item {item_id}",
        "nameZh": zh_names.get(item_id),
        "type": item_meta.get("type") if item_meta else "Unknown",
        "level": _u(data, offset + 6, 2),
        "plus": _u(data, offset + 10, 2),
        "rarity": RARITIES.get(_u(data, offset + 20, 1), "Unknown"),
        "setOrGrace": _set_or_grace(effect_names),
        "effects": effect_names,
        "effectsZh": effect_names_zh,
        "effectIds": effect_ids,
        "effectMagnitudes": effect_magnitudes,
        "effectValueDetails": _effect_value_details(data, offset, effects),
    }


def _count_records(data: bytes, start: int, size: int, count: int) -> int:
    present = 0
    for index in range(count):
        offset = start + index * size
        if offset + 2 > len(data):
            break
        if _u(data, offset, 2) != 0:
            present += 1
    return present


def _stacked_item_records(
    data: bytes,
    items: dict[str, dict[str, str]],
    zh_names: dict[str, str],
) -> list[dict[str, Any]]:
    """Return occupied consumable/material slots without mutating save data."""
    records: list[dict[str, Any]] = []
    for index in range(STACKED_ITEM_SLOTS):
        offset = STACKED_ITEM_START + index * STACKED_ITEM_SIZE
        if offset + STACKED_ITEM_SIZE > len(data):
            break
        raw_id = _u(data, offset, 2)
        if raw_id == 0:
            continue
        item_id = _swapped_id(raw_id)
        item_meta = items.get(item_id)
        records.append({
            "recordIndex": index,
            "id": item_id,
            "name": item_meta.get("name") if item_meta else f"Unknown item {item_id}",
            "nameZh": zh_names.get(item_id),
            "type": item_meta.get("type") if item_meta else "Unknown",
            "quantity": _u(data, offset + 4, 2),
        })
    return records


def _scroll_records(
    data: bytes,
    items: dict[str, dict[str, str]],
    effects: dict[str, dict[str, Any]],
    zh_names: dict[str, str],
    zh_effects: dict[str, str],
) -> list[dict[str, Any]]:
    """Return occupied Picture Scroll records using read-only community offsets."""
    records: list[dict[str, Any]] = []
    for index in range(SCROLL_SLOTS):
        offset = SCROLL_START + index * SCROLL_SIZE
        if offset + SCROLL_SIZE > len(data):
            break
        raw_id = _u(data, offset, 2)
        if raw_id == 0:
            continue
        item_id = _swapped_id(raw_id)
        item_meta = items.get(item_id)
        effect_names, effect_names_zh, effect_ids, effect_magnitudes = _effect_names(data, offset, effects, zh_effects)
        records.append({
            "recordIndex": index,
            "id": item_id,
            "name": item_meta.get("name") if item_meta else f"Unknown item {item_id}",
            "nameZh": zh_names.get(item_id),
            "level": _u(data, offset + 6, 2),
            "rarity": RARITIES.get(_u(data, offset + 20, 1), "Unknown"),
            "attemptsRemaining": _u(data, offset + 31, 1),
            "effects": effect_names,
            "effectsZh": effect_names_zh,
            "effectIds": effect_ids,
            "effectMagnitudes": effect_magnitudes,
            "effectValueDetails": _effect_value_details(data, offset, effects),
        })
    return records


def parse_bytes(data: bytes, items_path: Path, effects_path: Path) -> dict[str, Any]:
    if len(data) < MIN_SAVE_SIZE:
        raise ValueError(f"文件过小，不像已解密的 PC SAVEDATA.BIN：{len(data)} bytes")

    items = _load_items(items_path)
    effects = _load_effects(effects_path)
    zh_names = _load_zh_names(items_path)
    zh_effects = _load_zh_effects(effects_path)
    values = {name: _u(data, offset, size) for name, (offset, size) in OFFSETS.items()}
    proficiencies = {name: _u(data, offset, 4) for name, offset in PROFICIENCY_OFFSETS.items()}
    skill_point_counters = {
        name: {"temporary": _u(data, temporary, 4), "permanent": _u(data, permanent, 4)}
        for name, (temporary, permanent) in SKILL_POINT_OFFSETS.items()
    }

    records: list[dict[str, Any]] = []
    for index in range(EQUIPMENT_SLOTS):
        record = _equipment_record(data, EQUIPMENT_START + index * EQUIPMENT_SIZE, index, items, effects, zh_names, zh_effects)
        if record:
            records.append(record)

    equipped: list[dict[str, Any]] = []
    for record in records:
        equip_index = record["equipIndex"]
        if equip_index in EQUIP_SLOTS:
            equipped.append({**record, "slot": EQUIP_SLOTS[equip_index]})
    equipped.sort(key=lambda item: item["equipIndex"])
    occupied_loadout_slots = {item["equipIndex"] for item in equipped}
    empty_loadout_slots = [index for index in EQUIP_SLOTS if index not in occupied_loadout_slots]
    stacked_items = _stacked_item_records(data, items, zh_names)
    scroll_records = _scroll_records(data, items, effects, zh_names, zh_effects)

    type_counts: dict[str, int] = {}
    unknown_ids = 0
    for record in records:
        key = str(record["type"])
        type_counts[key] = type_counts.get(key, 0) + 1
        if key == "Unknown":
            unknown_ids += 1

    return {
        "character": {
            "level": values["level"],
            "amrita": values["amrita"],
            "gold": values["gold"],
            "attributes": {name: values[name] for name in ("constitution", "heart", "courage", "stamina", "strength", "skill", "dexterity", "magic")},
            "proficiency": proficiencies,
            "skillPointCounters": skill_point_counters,
        },
        "currentLoadout": equipped,
        "currentLoadoutName": "存档记录的当前装备",
        "savedEquipmentPresetName": _utf16le_z(data, LOADOUT_NAME_OFFSET, LOADOUT_NAME_CODE_UNITS),
        "emptyLoadoutSlots": empty_loadout_slots,
        "loadoutSource": "inventory-equipped-marker",
        "equipmentInventory": records,
        "inventoryItems": stacked_items,
        "scrolls": scroll_records,
        "inventorySummary": {
            "equipmentRecords": len(records),
            "equipmentUnknownIds": unknown_ids,
            "equipmentByType": type_counts,
            "stackedItemRecords": len(stacked_items),
            "scrollRecordsDetected": len(scroll_records),
        },
    }


def parse_decrypted_file(
    input_path: Path,
    snapshot_root: Path,
    items_path: Path,
    effects_path: Path,
    original_sha256: str | None = None,
) -> dict[str, Any]:
    input_path = input_path.resolve()
    snapshot_root = snapshot_root.resolve()
    if snapshot_root != input_path.parent and snapshot_root not in input_path.parents:
        raise ValueError("解析输入必须位于明确指定的快照根目录内。")
    with input_path.open("rb") as stream:
        data = stream.read()
    parsed = parse_bytes(data, items_path, effects_path)
    copy_hash = hashlib.sha256(data).hexdigest().upper()
    modified = datetime.fromtimestamp(input_path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {
        "schemaVersion": "0.9.6-research",
        "parserVersion": PARSER_VERSION,
        "game": "Nioh 2 - The Complete Edition",
        "platform": "Steam/Windows",
        "snapshotId": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"),
        "sourceLastWriteLocal": modified,
        "safety": {
            "sourceOpenedReadOnly": True,
            "parsedFromCopy": True,
            "originalMainSaveSha256": original_sha256 or copy_hash,
            "snapshotCopySha256": copy_hash,
            "originalHashUnchangedAfterProcessing": True,
        },
        **parsed,
        "limitations": [
            "Character name, guardian spirits, skill trees, mission progress, collectibles and clan/faction have not yet been mapped.",
            "Item identifiers come from a community Apache-2.0 table; matched display names come from the local game language packs.",
            "Effect values retain raw evidence. Conditions and non-numeric effects are not bonuses; unresolved grades and units are omitted. Legacy CAP-based units require verification. Equipment values are not final character totals.",
            "Fixed offsets are research findings and require validation against more save versions.",
            "Skill point counter labels preserve community terminology and are not yet confirmed as spendable balances.",
            "Equipped slots rely on inventory equipment markers and only change after the game persists those markers to disk.",
        ],
    }
