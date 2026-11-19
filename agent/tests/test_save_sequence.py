import copy
import hashlib
import json
import os
from pathlib import Path
import random
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from agent.parser import EQUIPMENT_START, EQUIPMENT_SIZE, MIN_SAVE_SIZE, SCROLL_START, SCROLL_SIZE
from agent.tools.compare_save_sequence import (PATTERNS, PHASES, build_report, pattern,
                                                provenance, reject_reparse,
                                                structured_comparison, transition_summary)


def manifest_for(blobs):
    samples = []
    for index, (phase, data) in enumerate(zip(PHASES, blobs)):
        samples.append({"phase": phase, "copy": f"{phase}.bin", "sha256": hashlib.sha256(data).hexdigest(),
                        "sampleId": phase, "characterRef": "synthetic-character", "saveSlot": "SAVEDATA00",
                        "context": "same-safe-area", "equipmentState": "scroll-B" if phase == "B" else "scroll-A",
                        "action": "synthetic-baseline" if phase == "A0" else "synthetic-switch",
                        "capturedAt": f"2026-10-10T12:0{index}:00Z", "observedAt": f"2026-10-10T12:0{index}:00Z",
                        "screenshotRefs": ["synthetic-observation-no-image"]})
    return {"schemaVersion": 1, "intent": "equipped-scroll",
            "game": {"platform": "synthetic", "version": "synthetic", "dlc": "synthetic"}, "samples": samples}


class SaveSequenceTests(unittest.TestCase):
    def test_all_patterns_without_whole_file_return(self):
        a, b, c = b"\x00\x00\x00\x00\x00", b"\x00\x01\x01\x00\x01", b"\x00\x00\x01\x01\x02"
        result = transition_summary(a, b, c, max_ranges=2)
        self.assertEqual(result["bytePatternCounts"], {"unchanged": 1, **dict.fromkeys(PATTERNS, 1)})
        self.assertEqual(result["changedBytes"], 4)
        self.assertEqual(result["changedRanges"], 4)
        self.assertTrue(result["rangesTruncated"])
        self.assertEqual(result["ranges"][0]["pattern"], "returns-to-A")
        self.assertFalse(result["ranges"][0]["semanticsVerified"])

    def test_counts_match_independent_random_reference(self):
        rng = random.Random(102610)
        for _ in range(100):
            blobs = [bytes(rng.randrange(4) for _ in range(101)) for _ in range(3)]
            expected = dict.fromkeys(("unchanged", *PATTERNS), 0)
            for a, b, c in zip(*blobs):
                key = ("unchanged" if a == b == c else "returns-to-A" if a == c else
                       "retained-from-B" if b == c else "first-changes-in-A1" if a == b else "three-distinct-values")
                expected[key] += 1
            self.assertEqual(transition_summary(*blobs)["bytePatternCounts"], expected)

    def test_record_boundary_and_bounded_previews(self):
        a = bytes(EQUIPMENT_START + EQUIPMENT_SIZE + 2)
        b = bytearray(a)
        b[EQUIPMENT_START - 1:EQUIPMENT_START + EQUIPMENT_SIZE + 2] = b"\x01" * (EQUIPMENT_SIZE + 3)
        result = transition_summary(a, bytes(b), a, preview_bytes=2)
        self.assertEqual(result["changedRanges"], 3)
        self.assertEqual([r["location"].get("recordIndex") for r in result["ranges"]], [None, 0, 1])
        self.assertTrue(result["ranges"][1]["previewTruncated"])
        self.assertEqual(result["ranges"][1]["BHex"], "0101")

    def test_unequal_size_and_invalid_bounds_rejected(self):
        with self.assertRaises(ValueError):
            transition_summary(b"a", b"aa", b"a")
        for kwargs in ({"max_ranges": True}, {"max_ranges": 0}, {"preview_bytes": 65}):
            with self.assertRaises(ValueError):
                transition_summary(b"a", b"b", b"a", **kwargs)

    def test_complete_record_and_known_slot_evidence_does_not_infer_scroll(self):
        a = bytearray(SCROLL_START + SCROLL_SIZE)
        a[EQUIPMENT_START:EQUIPMENT_START + 2] = b"\x12\x34"
        a[SCROLL_START:SCROLL_START + 2] = b"\x23\x45"
        b = bytearray(a)
        b[EQUIPMENT_START + 136] = 1
        b[SCROLL_START + 40] = 7
        c = bytearray(a)
        c[EQUIPMENT_START + 142] = 9  # retained/late record tail; slot marker still returns
        result = structured_comparison((bytes(a), bytes(b), bytes(c)))
        self.assertEqual(result["markedLoadoutPattern"], "returns-to-A")
        self.assertEqual(len(result["changedCompleteRecords"]), 2)
        equipment, scroll = result["changedCompleteRecords"]
        self.assertEqual(equipment["wholeRecordPattern"], "three-distinct-values")
        self.assertEqual(equipment["fields"]["inventoryEquippedMarker"]["pattern"], "returns-to-A")
        self.assertEqual(equipment["fields"]["inventoryEquippedMarker"]["values"], {"A0": 0, "B": 1, "A1": 0})
        self.assertNotIn("inventoryEquippedMarker", scroll["fields"])
        self.assertFalse(result["scrollWearerSelectorDecoded"])
        self.assertFalse(scroll["selectionVerified"])

    def test_declared_identity_time_and_state_validation(self):
        valid = manifest_for((b"a", b"b", b"a"))
        self.assertEqual(provenance(valid)[0]["observationToCaptureSeconds"], 0)
        for key, value in (("saveSlot", "SAVEDATA01"), ("characterRef", "other"), ("context", "other"),
                           ("sampleId", "A0"), ("capturedAt", "2026-10-10T12:00:00"),
                           ("equipmentState", "scroll-A"), ("screenshotRefs", [])):
            invalid = copy.deepcopy(valid)
            invalid["samples"][1][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                provenance(invalid)
        invalid = copy.deepcopy(valid)
        invalid["samples"][2]["capturedAt"] = valid["samples"][0]["capturedAt"]
        with self.assertRaises(ValueError):
            provenance(invalid)
        with self.assertRaises(ValueError):
            provenance([])

    def prepare(self, directory):
        root = Path(directory)
        copies = root / "copies"
        copies.mkdir()
        a = bytes(MIN_SAVE_SIZE)
        b = bytearray(a)
        b[16] = 1
        c = bytearray(a)
        c[24] = 2  # nonreturning noise/history candidate; whole hash does not restore
        blobs = (a, bytes(b), bytes(c))
        for phase, data in zip(PHASES, blobs):
            (copies / f"{phase}.bin").write_bytes(data)
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps(manifest_for(blobs)), "utf-8")
        return copies, manifest, root / "report.json", blobs

    def test_end_to_end_exclusive_readonly_report_and_candidate_field(self):
        with tempfile.TemporaryDirectory() as directory:
            copies, manifest, output, blobs = self.prepare(directory)
            report = build_report(copies, manifest, output, max_ranges=4, candidate_fields=((16, 4),))
            self.assertTrue(report["inputHashesUnchanged"])
            self.assertFalse(report["wholeFileReturnedToA"])
            self.assertFalse(report["wholeFileReturnRequired"])
            self.assertEqual(report["newVerifiedFields"], 0)
            self.assertEqual(report["candidateFields"][0]["pattern"], "returns-to-A")
            self.assertFalse(report["candidateFields"][0]["semanticsVerified"])
            self.assertFalse(report["associationAutomaticallyVerified"])
            self.assertNotIn(str(Path(directory)), output.read_text("utf-8"))
            self.assertEqual([p.read_bytes() for p in [copies / f"{s}.bin" for s in PHASES]], list(blobs))
            with self.assertRaises(FileExistsError):
                build_report(copies, manifest, output)

    def test_input_guards_discard_report(self):
        with tempfile.TemporaryDirectory() as directory:
            copies, manifest, output, blobs = self.prepare(directory)
            original = json.loads(manifest.read_text())
            for changed in ({"copy": "../A0.bin"}, {"sha256": "0" * 64}):
                candidate = copy.deepcopy(original)
                candidate["samples"][0].update(changed)
                manifest.write_text(json.dumps(candidate), "utf-8")
                with self.assertRaises(ValueError):
                    build_report(copies, manifest, output)
                self.assertFalse(output.exists())
            manifest.write_text(json.dumps(original), "utf-8")
            with self.assertRaises(ValueError):
                build_report(copies, manifest, copies / "unsafe.json")
            with self.assertRaises(ValueError):
                build_report(copies, manifest, output, candidate_fields=((MIN_SAVE_SIZE, 4),))
            self.assertFalse(output.exists())

    def test_same_physical_input_not_three_captures(self):
        with tempfile.TemporaryDirectory() as directory:
            copies, manifest, output, _ = self.prepare(directory)
            (copies / "B.bin").unlink()
            os.link(copies / "A0.bin", copies / "B.bin")
            with self.assertRaisesRegex(ValueError, "physical"):
                build_report(copies, manifest, output)
            self.assertFalse(output.exists())

    def test_changed_input_or_manifest_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            copies, manifest, output, blobs = self.prepare(directory)
            with patch("agent.tools.compare_save_sequence.read_copy", side_effect=[*blobs, b"changed"]):
                with self.assertRaisesRegex(RuntimeError, "changed"):
                    build_report(copies, manifest, output)
            self.assertFalse(output.exists())

    def test_system_slot_and_reparse_rejected(self):
        invalid = manifest_for((b"a", b"b", b"a"))
        for sample in invalid["samples"]:
            sample["saveSlot"] = "SYSTEMSAVEDATA00"
        with self.assertRaises(ValueError):
            provenance(invalid)
        with patch.object(Path, "lstat", return_value=SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=0x400)):
            with self.assertRaisesRegex(ValueError, "Reparse"):
                reject_reparse(Path("copy"))

    def test_known_character_change_is_a_confounder_and_old_observation_keeps_time_gap(self):
        a = bytes(MIN_SAVE_SIZE)
        b = bytearray(a)
        b[0x1C4904:0x1C4908] = (321).to_bytes(4, "little")
        result = structured_comparison((a, bytes(b), a))
        level = next(row for row in result["changedKnownCharacterFields"] if row["field"] == "level")
        self.assertEqual(level["values"], {"A0": 0, "B": 321, "A1": 0})
        self.assertFalse(result["characterIdentityDecoded"])
        manifest = manifest_for((a, bytes(b), a))
        manifest["samples"][0]["observedAt"] = "2026-09-25T12:00:00Z"
        self.assertGreater(provenance(manifest)[0]["observationToCaptureSeconds"], 86400)

    def test_manifest_changed_during_analysis_is_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            copies, manifest, output, _ = self.prepare(directory)

            def mutate_manifest(blobs):
                manifest.write_text("{}", "utf-8")
                return structured_comparison(blobs)

            with patch("agent.tools.compare_save_sequence.structured_comparison", side_effect=mutate_manifest):
                with self.assertRaisesRegex(RuntimeError, "manifest changed"):
                    build_report(copies, manifest, output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
