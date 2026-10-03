import tempfile
import unittest
from pathlib import Path

from agent.tools.audit_snapshot_corpus import audit_corpus, audit_snapshot


class SnapshotCorpusAuditTests(unittest.TestCase):
    def test_audit_recalculates_coverage_and_checks_read_only_guards(self):
        snapshot = {
            "snapshotId": "copy-only",
            "parserVersion": "0.9.2",
            "safety": {
                "sourceOpenedReadOnly": True,
                "parsedFromCopy": True,
                "originalHashUnchangedAfterProcessing": True,
            },
            "backupComparison": {"copyHashesUnchangedAfterParsing": True},
            "currentLoadout": [{"equipIndex": 0}],
            "equipmentInventory": [
                {"recordIndex": 0, "nameZh": "土蜘蛛众手甲钩", "effects": ["Break"], "effectsZh": ["崩解"], "effectIds": ["EEA0"]},
                {"recordIndex": 1, "nameZh": None, "effects": ["Unknown effect"], "effectsZh": ["未识别词条（FFFF）"], "effectIds": ["FFFF"]},
            ],
            "inventoryItems": [{"nameZh": "神馔米"}],
            "scrolls": [],
        }
        report = audit_snapshot(snapshot, Path("sample.json"))
        self.assertEqual([], report["errors"])
        self.assertEqual({"translated": 1, "total": 2}, report["coverage"]["equipmentNames"])
        self.assertEqual({"translated": 1, "total": 2}, report["coverage"]["effects"])

    def test_corpus_rejects_invalid_json(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, "broken.json").write_text("{", encoding="utf-8")
            report = audit_corpus(Path(root))
            self.assertFalse(report["passed"])
            self.assertIn("无法读取 JSON", report["reports"][0]["errors"][0])

    def test_legacy_backup_comparison_without_new_guard_remains_auditable(self):
        snapshot = {
            "safety": {
                "sourceOpenedReadOnly": True,
                "parsedFromCopy": True,
                "originalHashUnchangedAfterProcessing": True,
            },
            "backupComparison": {"loadoutChanged": False},
            "currentLoadout": [],
        }
        self.assertEqual([], audit_snapshot(snapshot, Path("legacy.json"))["errors"])


if __name__ == "__main__":
    unittest.main()
