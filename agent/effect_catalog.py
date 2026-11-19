"""Conservative effect lookup keys; original catalogue rows remain unchanged."""
from __future__ import annotations

import re
from typing import Any

# Catalogue-only aliases, not verified save encodings. 60/80 conflict with
# longer source IDs and are deliberately absent. Never truncate long IDs.
SHORT_EFFECT_ALIASES = frozenset({"04", "09", "62", "66"})
QUARANTINED_SHORT_EFFECT_IDS = frozenset({"60", "80"})


def effect_lookup_key(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    key = value.upper()
    if key in SHORT_EFFECT_ALIASES:
        return key.zfill(4)
    if re.fullmatch(r"[0-9A-F]{4}", key) and key not in {"0000", "FFFF"}:
        return key
    return None


def build_effect_lookup(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = effect_lookup_key(row.get("id"))
        if key is None:
            continue
        if key in lookup:
            # Fail independently of catalogue ordering; never select last-wins.
            raise ValueError(f"Ambiguous effect catalogue key: {key}")
        lookup[key] = row
    return lookup


def effect_translation_lookup(names: dict[str, Any]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for original_key, value in names.items():
        key = effect_lookup_key(original_key)
        if key is None:
            continue
        if key in lookup and lookup[key] != str(value):
            raise ValueError(f"Ambiguous effect translation key: {key}")
        lookup[key] = str(value)
    return lookup
