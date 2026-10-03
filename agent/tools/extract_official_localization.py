"""Extract short official zh-CN names by aligning Nioh 2 PTRBUNDLE relocations.

The tool is intentionally read-only for source bundles. It only writes the
explicit JSON output path and never touches the game installation.
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import struct
from pathlib import Path
from typing import Any


# Official Simplified Chinese weapon category names. These are used only as
# arguments for an official ``%ls`` template when the effect pack does not
# repeat the standalone category label in the same PTRBUNDLE.
OFFICIAL_TEMPLATE_ARGUMENTS = {
    "Sword": "太刀",
    "Dual Swords": "双刀",
    "Spear": "长枪",
    "Axe": "斧",
    "Kusarigama": "锁镰",
    "Odachi": "大太刀",
    "Tonfa": "旋棍",
    "Hatchets": "手斧",
    "Switchglaive": "薙刀镰",
    "Splitstaff": "机关棍",
    "Fists": "手甲",
}


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _relocation_table(data: bytes) -> tuple[tuple[int, ...], int]:
    section_count = _u32(data, 0)
    descriptor_offsets = struct.unpack_from(f"<{section_count}I", data, 4)
    candidates: list[tuple[int, tuple[int, ...]]] = []
    for descriptor in descriptor_offsets:
        if descriptor + 4 > len(data):
            continue
        count = _u32(data, descriptor)
        end = descriptor + 4 + count * 4
        if count < 100 or end > len(data):
            continue
        locations = struct.unpack_from(f"<{count}I", data, descriptor + 4)
        valid = sum(1 for value in locations if value + 4 <= len(data))
        if valid == count:
            candidates.append((count, locations))
    if not candidates:
        raise ValueError("未找到 PTRBUNDLE 重定位表")
    locations = max(candidates, key=lambda item: item[0])[1]
    for descriptor in descriptor_offsets:
        if descriptor + 4 > len(data) or _u32(data, descriptor) != len(locations):
            continue
        content_start = (descriptor + 4 + len(locations) * 4 + 15) & ~15
        return locations, content_start
    raise ValueError("无法确定 PTRBUNDLE 文本起点")


def _utf16z(data: bytes, offset: int) -> str:
    if offset <= 0 or offset >= len(data) or offset % 2:
        return ""
    end = offset
    while end + 1 < len(data) and data[end : end + 2] != b"\0\0":
        end += 2
    try:
        value = data[offset:end].decode("utf-16le")
    except UnicodeDecodeError:
        return ""
    if any(ord(character) < 0x20 and character not in "\r\n\t" for character in value):
        return ""
    return value.strip()


def _ordered_strings(data: bytes) -> list[str]:
    _, offset = _relocation_table(data)
    values: list[str] = []
    while offset + 2 <= len(data):
        value = _utf16z(data, offset)
        if value:
            values.append(value)
        end = offset
        while end + 1 < len(data) and data[end : end + 2] != b"\0\0":
            end += 2
        next_offset = (end + 2 + 15) & ~15
        if next_offset <= offset:
            break
        offset = next_offset
    return values

def aligned_strings(english_path: Path, chinese_path: Path) -> list[tuple[str, str]]:
    english_values = _ordered_strings(english_path.read_bytes())
    chinese_values = _ordered_strings(chinese_path.read_bytes())
    return _align_sequences(english_values, chinese_values)


def _match_cost(english: str, chinese: str) -> float:
    if english == chinese:
        return -20.0
    english_sentence = len(english) > 90 or ". " in english or english.endswith(".")
    chinese_sentence = len(chinese) > 45 or "。" in chinese
    cost = 12.0 if english_sentence != chinese_sentence else 0.0
    ratio = (len(english) + 1) / (max(len(chinese), 1) * 2.1)
    cost += min(9.0, abs(math.log(max(ratio, 0.05))) * 3.0)
    cost += abs(english.count("\n") - chinese.count("\n")) * 2.0
    cost += abs(english.count("%") - chinese.count("%")) * 5.0
    if english.startswith("IE_") != chinese.startswith("IE_"):
        cost += 16.0
    return cost


def _align_sequences(english: list[str], chinese: list[str], band: int = 32) -> list[tuple[str, str]]:
    """Banded alignment; language packs differ by a few locale-only strings."""
    gap_cost = 10.0
    previous: dict[int, tuple[float, list[tuple[int, int]]]] = {0: (0.0, [])}
    for i in range(len(english) + 1):
        current = previous if i == 0 else {}
        minimum_j = max(0, i - band)
        maximum_j = min(len(chinese), i + band)
        if i > 0:
            for j in range(minimum_j, maximum_j + 1):
                candidates: list[tuple[float, list[tuple[int, int]]]] = []
                if j in previous:
                    score, path = previous[j]
                    candidates.append((score + gap_cost, path))
                if j > 0 and j - 1 in previous:
                    score, path = previous[j - 1]
                    candidates.append((score + _match_cost(english[i - 1], chinese[j - 1]), path + [(i - 1, j - 1)]))
                if candidates:
                    current[j] = min(candidates, key=lambda item: item[0])
        for j in range(max(1, minimum_j), maximum_j + 1):
            if j - 1 in current:
                score, path = current[j - 1]
                insertion = (score + gap_cost, path)
                if j not in current or insertion[0] < current[j][0]:
                    current[j] = insertion
        previous = current
    if len(chinese) not in previous:
        raise ValueError("中英文文本序列无法在安全带宽内对齐")
    return [(english[i], chinese[j]) for i, j in previous[len(chinese)][1]]


def _load_catalogs(items_path: Path, effects_path: Path) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    items = json.loads(items_path.read_text(encoding="utf-8"))
    effects = json.loads(effects_path.read_text(encoding="utf-8"))
    item_names: dict[str, list[str]] = {}
    effect_names: dict[str, list[str]] = {}
    for item_id, item in items.items():
        item_names.setdefault(str(item.get("name", "")), []).append(str(item_id).upper())
    for effect in effects:
        effect_names.setdefault(str(effect.get("Effect", "")), []).append(str(effect.get("id", "")).upper())
    return item_names, effect_names


def _normalized_english(value: str) -> str:
    value = value.casefold().replace("’", "'").replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", value)


def _unique_normalized_translations(translations: dict[str, str]) -> dict[str, str]:
    """Index only unambiguous normalized names to absorb catalog punctuation/case drift."""
    candidates: dict[str, set[str]] = {}
    for english, chinese in translations.items():
        normalized = _normalized_english(english)
        if normalized:
            candidates.setdefault(normalized, set()).add(chinese)
    return {key: next(iter(values)) for key, values in candidates.items() if len(values) == 1}


def _close_translation(value: str, translations: dict[str, str]) -> str | None:
    """Resolve a likely catalog typo only when one normalized match is dominant."""
    normalized = _normalized_english(value)
    matches = difflib.get_close_matches(normalized, translations.keys(), n=2, cutoff=0.9)
    if not matches:
        return None
    best = difflib.SequenceMatcher(None, normalized, matches[0]).ratio()
    second = difflib.SequenceMatcher(None, normalized, matches[1]).ratio() if len(matches) > 1 else 0.0
    if best < 0.9 or best - second < 0.04:
        return None
    return translations[matches[0]]


def _template_translation(value: str, translations: dict[str, str]) -> str | None:
    """Expand an official ``%ls`` localization template conservatively.

    Nioh 2 stores many effect families as one localized template plus localized
    arguments (for example ``Mystic Dyad (%ls)`` + ``Sword``). Community
    tables flatten those values into complete names. Only a unique template
    match whose every argument also has an exact official translation is used.
    """
    candidates: set[str] = set()
    for english_template, chinese_template in translations.items():
        plain_english_template = re.sub(r"\^[0-9]+~(?:DEBUFF|BUFF)~|\^[0-9]+~~", "", english_template)
        placeholder_count = plain_english_template.count("%ls")
        if placeholder_count == 0 or chinese_template.count("%ls") != placeholder_count:
            continue
        pattern = "^" + "(.+?)".join(re.escape(part) for part in plain_english_template.split("%ls")) + "$"
        match = re.fullmatch(pattern, value)
        if not match:
            continue
        translated_arguments: list[str] = []
        for argument in match.groups():
            translated = translations.get(argument) or OFFICIAL_TEMPLATE_ARGUMENTS.get(argument)
            if translated is None:
                break
            translated_arguments.append(translated)
        else:
            result = chinese_template
            for translated in translated_arguments:
                result = result.replace("%ls", translated, 1)
            result = re.sub(r"\^[0-9]+~(?:DEBUFF|BUFF)~|\^[0-9]+~~", "", result)
            candidates.add(result)
    return next(iter(candidates)) if len(candidates) == 1 else None


def build_mapping(
    english_path: Path,
    chinese_path: Path,
    items_path: Path,
    effects_path: Path,
) -> dict[str, Any]:
    item_names, effect_names = _load_catalogs(items_path, effects_path)
    items: dict[str, str] = {}
    effects: dict[str, str] = {}
    matched_pairs = 0
    translations = dict(aligned_strings(english_path, chinese_path))
    normalized_translations = _unique_normalized_translations(translations)
    for english, chinese in translations.items():
        if len(chinese) > 120:
            continue
        if english in item_names:
            for item_id in item_names[english]:
                items.setdefault(item_id, chinese)
            matched_pairs += 1
        if english in effect_names:
            for effect_id in effect_names[english]:
                effects.setdefault(effect_id, chinese)
            matched_pairs += 1
    for english_name, item_ids in item_names.items():
        chinese = normalized_translations.get(_normalized_english(english_name)) or _close_translation(english_name, normalized_translations)
        if not chinese:
            continue
        for item_id in item_ids:
            items.setdefault(item_id, chinese)
    for english_name, effect_ids in effect_names.items():
        chinese = (
            normalized_translations.get(_normalized_english(english_name))
            or _template_translation(english_name, translations)
            or _close_translation(english_name, normalized_translations)
        )
        if not chinese:
            continue
        for effect_id in effect_ids:
            effects.setdefault(effect_id, chinese)
    suffixes = {
        "Set Bonus Requirements -1": "套装组合效果需求数－1",
        "Green/White": "绿／白",
        "Black": "黑",
        "Black/Brown": "黑／棕",
        "Black/Gray": "黑／灰",
        "Blue": "蓝",
        "Brown": "棕",
        "Brown/Red": "棕／红",
        "Brown/White": "棕／白",
        "Gold/Brown": "金／棕",
        "Green": "绿",
        "Light Blue": "浅蓝",
        "Light Blue/White": "浅蓝／白",
        "Orange/Red": "橙／红",
        "Red": "红",
        "Red/Brown": "红／棕",
        "Red/Green": "红／绿",
        "Red/Orange": "红／橙",
        "Red/Pink": "红／粉",
        "White": "白",
        "White/Red": "白／红",
        "Yellow/White": "黄／白",
    }
    for english_name, item_ids in item_names.items():
        match = re.fullmatch(r"(.+?) \[([^]]+)]", english_name)
        if not match:
            continue
        translated_base = (
            translations.get(match.group(1))
            or normalized_translations.get(_normalized_english(match.group(1)))
            or _close_translation(match.group(1), normalized_translations)
        )
        translated_suffix = suffixes.get(match.group(2))
        if not translated_base or not translated_suffix:
            continue
        for item_id in item_ids:
            items.setdefault(item_id, f"{translated_base}（{translated_suffix}）")
    for english_name, item_ids in item_names.items():
        if not english_name.startswith("Smithing Text: "):
            continue
        base_name = english_name.removeprefix("Smithing Text: ")
        translated_base = (
            translations.get(base_name)
            or normalized_translations.get(_normalized_english(base_name))
            or _close_translation(base_name, normalized_translations)
        )
        if not translated_base:
            continue
        for item_id in item_ids:
            items.setdefault(item_id, f"锻造书：{translated_base}")
    return {
        "schemaVersion": "1.0.0",
        "source": "Nioh 2 archive_19 aligned PTRBUNDLE names",
        "items": dict(sorted(items.items())),
        "effects": dict(sorted(effects.items())),
        "stats": {"items": len(items), "effects": len(effects), "matchedPairs": matched_pairs},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="只读对齐《仁王2》中英文名称表")
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--chinese", type=Path, required=True)
    parser.add_argument("--items", type=Path, required=True)
    parser.add_argument("--effects", type=Path, required=True)
    parser.add_argument("--base", type=Path, help="可选现有目录；冲突时保留已验证条目")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    mapping = build_mapping(args.english, args.chinese, args.items, args.effects)
    if args.base:
        base = json.loads(args.base.read_text(encoding="utf-8"))
        for section in ("items", "effects"):
            existing = base.get(section, {}) if isinstance(base, dict) else {}
            mapping[section].update({str(key): str(value) for key, value in existing.items()})
        mapping["source"] += "; existing verified entries preserved on conflict"
        mapping["stats"]["items"] = len(mapping["items"])
        mapping["stats"]["effects"] = len(mapping["effects"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(mapping["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
