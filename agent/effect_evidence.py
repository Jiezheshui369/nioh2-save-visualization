"""Raw effect triples for private research only, not the snapshot/share schema."""
from __future__ import annotations

import struct


def effect_slot_evidence(data: bytes, record_offset: int) -> list[dict]:
    if record_offset < 0 or record_offset + 132 > len(data):
        raise ValueError("Effect record is outside the copy")
    slots = []
    for index in range(7):
        offset = record_offset + 48 + index * 12
        raw_id, magnitude, footer = struct.unpack_from("<III", data, offset)
        low_id = raw_id & 0xFFFF
        slots.append({
            "effectSlotIndex": index,
            "recordOffset": record_offset,
            "idOffset": offset,
            "magnitudeOffset": offset + 4,
            "footerOffset": offset + 8,
            "rawId": raw_id,
            "rawIdHex": f"{raw_id:08X}",
            "lookupId": f"{low_id:04X}",
            "rawValue": magnitude,
            "rawFooter": footer,
            "rawFooterHex": f"{footer:08X}",
            "skippedByParser": low_id in {0, 0xFFFF},
            "semanticsVerified": False,
        })
    return slots
