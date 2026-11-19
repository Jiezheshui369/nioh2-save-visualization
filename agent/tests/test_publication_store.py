import tempfile
import unittest
from pathlib import Path
from agent.publication_store import record_parsed_snapshot, publication_receipt, latest_publication


def parsed(snapshot_id="test-parsed"):
    return {"schemaVersion": "test", "parserVersion": "0.9.10", "snapshotId": snapshot_id,
        "character": {"level": 12, "attributes": {}, "proficiency": {}},
        "safety": {"parsedFromCopy": True, "sourceOpenedReadOnly": True,
            "originalHashUnchangedAfterProcessing": True, "originalMainSaveSha256": "private-test-hash"},
        "currentLoadout": [], "inventorySummary": {}, "limitations": []}


class PublicationStoreTests(unittest.TestCase):
    def test_durable_canonical_and_redacted_record_with_monotonic_versions(self):
        with tempfile.TemporaryDirectory() as temp:
            store = Path(temp)
            source = parsed(); source["internalDiagnostic"] = "must-not-transfer"
            first = record_parsed_snapshot(store, source)
            self.assertEqual(1, first["publicationVersion"])
            self.assertEqual(first, publication_receipt(store, source["snapshotId"]))
            self.assertEqual(first, record_parsed_snapshot(store, source))
            second = record_parsed_snapshot(store, parsed("second"))
            self.assertEqual(2, second["publicationVersion"])
            latest = latest_publication(store)
            self.assertEqual("已隐藏", latest["snapshot"]["safety"]["originalMainSaveSha256"])
            self.assertEqual("private-test-hash", latest["canonicalSnapshot"]["safety"]["originalMainSaveSha256"])
            self.assertNotIn("internalDiagnostic", latest["snapshot"])

    def test_conflicting_same_identity_keeps_committed_record(self):
        with tempfile.TemporaryDirectory() as temp:
            store = Path(temp); record_parsed_snapshot(store, parsed())
            changed = parsed(); changed["character"]["level"] = 99
            with self.assertRaises(ValueError): record_parsed_snapshot(store, changed)
            self.assertEqual(12, latest_publication(store)["snapshot"]["character"]["level"])

    def test_screenshot_record_never_becomes_automatic_parser_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            source = parsed(); source["characterStatus"] = {"groups": []}
            with self.assertRaises(ValueError): record_parsed_snapshot(Path(temp), source)
            with self.assertRaises(FileNotFoundError): latest_publication(Path(temp))
