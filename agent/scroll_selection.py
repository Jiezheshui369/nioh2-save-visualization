"""Opt-in scroll-index evidence for one observed PC layout; never activation proof."""
from __future__ import annotations
from typing import Any, Mapping
SELECTOR_OFFSET = 0x294070
TABLE_START = 0x294080
RECORD_SIZE = 0x88
TABLE_SLOTS = 248
HEADER_SIZE = 0x148

def inspect_scroll_selection(data: bytes, items: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    result = {
        "formatVersion": 1, "status": "unknown", "reason": None,
        "selectorOffset": hex(SELECTOR_OFFSET), "encodingHypothesis": "uint32-le-table-index",
        "rawSelector": None, "candidateRecord": None, "selectionVerified": False,
        "generalizationVerified": False,
        "evidenceScope": "one user-reported Steam/Windows ABA plus view-only control; game build unspecified",
    }
    def unknown(reason):
        result["reason"] = reason
        return result
    if len(data) < HEADER_SIZE or data[:7] != b"NIOHUSR":
        return unknown("unrecognized-container")
    if (int.from_bytes(data[0x14:0x18], "little") != HEADER_SIZE
            or int.from_bytes(data[0x18:0x1c], "little") != len(data) - HEADER_SIZE):
        return unknown("inconsistent-container-lengths")
    if len(data) < SELECTOR_OFFSET + 4:
        return unknown("truncated-selector")
    index = int.from_bytes(data[SELECTOR_OFFSET:SELECTOR_OFFSET + 4], "little")
    result["rawSelector"] = index
    if index == 0xffffffff:
        return unknown("unverified-sentinel")
    available = min(TABLE_SLOTS, max(0, (len(data) - TABLE_START) // RECORD_SIZE))
    if index >= available:
        return unknown("record-index-out-of-bounds")
    at = TABLE_START + index * RECORD_SIZE
    record = data[at:at + RECORD_SIZE]
    if record[:2] == b"\0\0":
        return unknown("empty-referenced-record")
    item_id = record[:2].hex().upper()
    meta = items.get(item_id)
    if not isinstance(meta, Mapping) or meta.get("type") != "Scrolls":
        return unknown("unrecognized-scroll-item")
    result.update(status="candidate", candidateRecord={
        "recordIndex": index, "offset": hex(at), "id": item_id,
    })
    return result
