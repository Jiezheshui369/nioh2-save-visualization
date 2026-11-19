import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from agent.effect_evidence import effect_slot_evidence
from agent.parser import (EQUIPMENT_START, EQUIPMENT_SIZE, SCROLL_START, SCROLL_SIZE,
                          _effect_names, _load_effects)
from agent.tools.analyze_character_status import sources_for
from agent.tools.inspect_effect_records import analyze, write_report

CATALOGUE = Path(__file__).parents[1] / "data/effects.json"


def synthetic_copy():
    data = bytearray(SCROLL_START + SCROLL_SIZE)
    for at in (EQUIPMENT_START, SCROLL_START):
        data[at:at + 2] = b"\x01\x01"
        struct.pack_into("<III", data, at + 48, 0x123453BC, 0xFFFFFFFF, 0xABCDEF01)
        struct.pack_into("<III", data, at + 72, 0xFFFF, 99, 0x1234)
    return bytes(data)


class EffectEvidenceTests(unittest.TestCase):
    def test_full_triples_offsets_and_empty_slots_are_preserved_for_both_tables(self):
        report = analyze(synthetic_copy(), json.loads(CATALOGUE.read_text(encoding="utf-8")))
        self.assertEqual(report["recordCount"], 2)
        self.assertFalse(report["complete"])
        for record, base in zip(report["records"], (EQUIPMENT_START, SCROLL_START)):
            self.assertEqual(len(record["effectSlots"]), 7)
            slot = record["effectSlots"][0]
            self.assertEqual((slot["recordOffset"], slot["idOffset"], slot["magnitudeOffset"], slot["footerOffset"]),
                             (base, base + 48, base + 52, base + 56))
            self.assertEqual((slot["rawId"], slot["rawIdHex"], slot["lookupId"]), (0x123453BC, "123453BC", "53BC"))
            self.assertEqual((slot["rawValue"], slot["rawFooter"], slot["rawFooterHex"]), (0xFFFFFFFF, 0xABCDEF01, "ABCDEF01"))
            self.assertFalse(slot["semanticsVerified"])
            self.assertFalse(record["selectionVerified"])
            self.assertEqual(record["effectSlots"][1]["effectSlotIndex"], 1)
            self.assertTrue(record["effectSlots"][1]["skippedByParser"])
            self.assertEqual(record["effectSlots"][2]["lookupId"], "FFFF")
            self.assertEqual(record["effectSlots"][2]["rawFooter"], 0x1234)
            self.assertTrue(record["effectSlots"][2]["skippedByParser"])

    def test_high_bits_and_footer_distinguish_research_but_preserve_legacy_display(self):
        effects = _load_effects(CATALOGUE)
        projections, evidence = [], []
        for raw_id, footer in ((0x53BC, 0), (0x123453BC, 0), (0x53BC, 0xABCDEF01)):
            data = bytearray(EQUIPMENT_SIZE)
            struct.pack_into("<III", data, 48, raw_id, 10, footer)
            projections.append(_effect_names(bytes(data), 0, effects, {}))
            evidence.append(effect_slot_evidence(bytes(data), 0)[0])
        self.assertEqual(projections[0], projections[1])
        self.assertEqual(projections[0], projections[2])
        self.assertEqual(len({json.dumps(e, sort_keys=True) for e in evidence}), 3)

    def test_character_source_alignment_after_skipped_slots_keeps_original_slot_offset(self):
        data = bytearray(SCROLL_START + SCROLL_SIZE)
        struct.pack_into("<III", data, SCROLL_START + 48 + 3 * 12, 0x12349158, 896, 0xABCDEF01)
        item = dict(recordIndex=0, name="Scroll", effectIds=["9158"], effectsZh=["charge"],
                    effectMagnitudes=["89.6%"], effectValueDetails=[dict(rawValue=896, kind="numeric", encoding="verified-id")])
        source = sources_for({"scrolls": [item]}, bytes(data))[0]
        self.assertEqual(source["effectId"], "9158")
        self.assertEqual(source["rawEffectEvidence"]["effectSlotIndex"], 3)
        self.assertEqual(source["rawEffectEvidence"]["rawIdHex"], "12349158")
        self.assertEqual(source["rawEffectEvidence"]["rawFooterHex"], "ABCDEF01")
        self.assertEqual(source["rawOffset"], f"0x{SCROLL_START + 52 + 3 * 12:X}")
        self.assertEqual(source["valueEncoding"], "verified-id")
        self.assertEqual(source["activeState"], "unknown-scroll-selection")

    def test_record_bounds_reject_negative_and_truncated_input(self):
        for data, at in ((bytes(132), -1), (bytes(131), 0), (bytes(132), 1)):
            with self.assertRaises(ValueError):
                effect_slot_evidence(data, at)

    def test_alias_match_remains_catalogue_only(self):
        data = bytearray(synthetic_copy())
        struct.pack_into("<I", data, EQUIPMENT_START + 48, 4)
        report = analyze(bytes(data), json.loads(CATALOGUE.read_text(encoding="utf-8")))
        match = report["records"][0]["effectSlots"][0]["catalogueMatch"]
        self.assertEqual(match["status"], "catalogue-alias")
        self.assertEqual(match["rawCatalogueId"], "04")
        self.assertFalse(match["semanticsVerified"])

    def test_cli_report_requires_known_hash_and_preserves_input_and_existing_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "copy"
            root.mkdir()
            source = root / "SAVEDATA.BIN"
            blob = synthetic_copy()
            source.write_bytes(blob)
            digest = hashlib.sha256(blob).hexdigest()
            output = Path(temp) / "research"
            report = write_report(root, source, output, digest.upper())
            self.assertTrue(report["inputHashUnchanged"])
            self.assertEqual(source.read_bytes(), blob)
            previous = (output / "effect-records.json").read_bytes()
            with self.assertRaises(FileExistsError):
                write_report(root, source, output, digest)
            self.assertEqual((output / "effect-records.json").read_bytes(), previous)
            for wrong in ("0" * 64, "bad"):
                destination = Path(temp) / "wrong"
                with self.assertRaises(ValueError):
                    write_report(root, source, destination, wrong)
                self.assertFalse(destination.exists())
            for destination in (root / "research", Path(temp)):
                with self.assertRaises(ValueError):
                    write_report(root, source, destination, digest)
            with self.assertRaises(ValueError):
                write_report(output, source, Path(temp) / "outside", digest)

    def test_changed_input_refuses_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "copy"
            root.mkdir()
            source = root / "SAVEDATA.BIN"
            blob = synthetic_copy()
            source.write_bytes(blob)
            original_read = Path.read_bytes
            reads = 0

            def read(path):
                nonlocal reads
                result = original_read(path)
                if path.resolve() == source.resolve():
                    reads += 1
                    if reads == 2:
                        return result[:-1] + b"\x01"
                return result

            output = Path(temp) / "research"
            with patch.object(Path, "read_bytes", read), self.assertRaisesRegex(RuntimeError, "changed"):
                write_report(root, source, output, hashlib.sha256(blob).hexdigest())
            self.assertFalse(output.exists())
            self.assertEqual(source.read_bytes(), blob)


if __name__ == "__main__":
    unittest.main()
