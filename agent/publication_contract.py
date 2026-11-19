"""Cross-language parsed-publication projection and deterministic hash bytes.

This is a read-only data contract, not encryption or authenticity verification.
"""
from __future__ import annotations
import copy
import math
import struct

PUBLICATION_ENCODING = "save-asset-value/1"
REDACTED = "已隐藏"
ATTRIBUTES = ("constitution", "heart", "courage", "stamina", "strength", "skill", "dexterity", "magic")


class UnsafePublicationInteger(ValueError):
    """A local integer must not be rounded to fit the remote v1 number contract."""


def publication_bytes(value) -> bytes:
    def string(v):
        raw = v.encode("utf-8", errors="strict")
        return b"s" + str(len(raw)).encode("ascii") + b":" + raw

    def encode(v, depth=0):
        if depth > 64:
            raise ValueError("PUBLICATION_DEPTH")
        if v is None:
            return b"n"
        if isinstance(v, bool):
            return b"t" if v else b"f"
        if isinstance(v, str):
            return string(v)
        if type(v) in (int, float):
            if type(v) is int and abs(v) > 9007199254740991:
                raise UnsafePublicationInteger("UNSAFE_INTEGER")
            if not math.isfinite(v):
                raise ValueError("INVALID_PUBLICATION_NUMBER")
            if float(v).is_integer() and abs(v) > 9007199254740991:
                raise UnsafePublicationInteger("UNSAFE_INTEGER")
            return b"d" + struct.pack(">d", 0.0 if v == 0 else v).hex().encode("ascii")
        if isinstance(v, list):
            return b"a" + str(len(v)).encode("ascii") + b":" + b"".join(encode(x, depth+1) for x in v)
        if isinstance(v, dict) and all(isinstance(k, str) for k in v):
            keys = sorted(v, key=lambda k: k.encode("utf-16-be", errors="strict"))
            return b"o" + str(len(keys)).encode("ascii") + b":" + b"".join(string(k)+encode(v[k], depth+1) for k in keys)
        raise ValueError("INVALID_PUBLICATION_VALUE")
    return PUBLICATION_ENCODING.encode("ascii") + b"\n" + encode(value)


def _pick(row, keys):
    return {k: copy.deepcopy(row[k]) for k in keys if k in row}


def public_parsed_snapshot(snapshot):
    if (not isinstance(snapshot, dict) or "characterStatus" in snapshot
            or not isinstance(snapshot.get("snapshotId"), str)
            or not isinstance(snapshot.get("character"), dict)
            or snapshot.get("safety", {}).get("parsedFromCopy") is not True):
        raise ValueError("Only independently parsed snapshots may be published")
    out = _pick(snapshot, ("schemaVersion", "parserVersion", "game", "platform", "snapshotId", "researchLabel",
        "sourceLastWriteLocal", "currentLoadoutName", "savedEquipmentPresetName", "emptyLoadoutSlots", "loadoutSource", "limitations"))
    out["safety"] = _pick(snapshot["safety"], ("sourceOpenedReadOnly", "parsedFromCopy", "originalHashUnchangedAfterProcessing"))
    out["safety"]["originalMainSaveSha256"] = REDACTED
    out["privacy"] = {"redactedForSharing": True}
    c = snapshot["character"]
    out["character"] = _pick(c, ("level", "amrita", "gold", "proficiency"))
    out["character"]["attributes"] = _pick(c["attributes"], ATTRIBUTES)
    if "skillPointCounters" in c:
        out["character"]["skillPointCounters"] = {k: _pick(v, ("temporary", "permanent")) for k,v in c["skillPointCounters"].items()}
    out["inventorySummary"] = _pick(snapshot.get("inventorySummary", {}), ("equipmentRecords", "equipmentUnknownIds", "equipmentByType", "stackedItemRecords", "scrollRecordsDetected"))
    equipment_keys = ("recordIndex", "equipIndex", "id", "name", "nameZh", "level", "plus", "rarity", "setOrGrace", "type")
    effects = ("effects", "effectsZh", "effectIds", "effectMagnitudes")
    for key in ("currentLoadout", "equipmentInventory", "scrolls"):
        if key not in snapshot:
            continue
        keys = (("recordIndex", "id", "name", "nameZh", "level", "rarity", "attemptsRemaining") if key == "scrolls"
                else equipment_keys + (("slot",) if key == "currentLoadout" else ()))
        out[key] = []
        for item in snapshot[key]:
            row = _pick(item, keys + effects)
            if "effectValueDetails" in item:
                row["effectValueDetails"] = [_pick(v, ("rawValue", "kind", "encoding")) for v in item["effectValueDetails"]]
            out[key].append(row)
    if "inventoryItems" in snapshot:
        out["inventoryItems"] = [_pick(v, ("recordIndex", "id", "name", "nameZh", "type", "quantity")) for v in snapshot["inventoryItems"]]
    if "backupComparison" in snapshot:
        backup = snapshot["backupComparison"]
        out["backupComparison"] = _pick(backup, ("backupLastWriteLocal", "level", "amrita", "gold", "binaryChangedBytes", "binaryChangedRanges", "loadoutChanged", "inventoryChanged", "copyHashesUnchangedAfterParsing", "attributeChangesToCurrent"))
        if "inventoryQuantityChanges" in backup:
            out["backupComparison"]["inventoryQuantityChanges"] = [_pick(v, ("id", "nameZh", "name", "before", "after", "delta")) for v in backup["inventoryQuantityChanges"]]
    return out
