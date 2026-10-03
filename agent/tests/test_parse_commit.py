"""Publishing must fail closed if any independently copied input changes."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from agent.nioh2_agent import parse_and_store


class ParseCommitTests(unittest.TestCase):
    def test_changed_main_or_backup_copy_is_never_published(self):
        fixture = json.loads((Path(__file__).parents[2] / "public/data/demo-snapshot.json").read_text(encoding="utf8"))
        for changed in ("SAVEDATA.BIN", "BACKUP.BIN"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory(prefix="nioh-parse-test-") as temp:
                root = Path(temp)
                main, backup, store = root / "SAVEDATA.BIN", root / "BACKUP.BIN", root / "store"
                main.write_bytes(b"synthetic-main")
                backup.write_bytes(b"synthetic-backup")
                store.mkdir()
                previous = store / "previous.json"
                previous.write_text('{"snapshotId":"previous"}', encoding="utf8")
                before = previous.read_bytes()
                calls = 0

                def parse(*args, **kwargs):
                    nonlocal calls
                    calls += 1
                    if calls == 2:
                        (root / changed).write_bytes(b"synthetic-concurrent-writer")
                    return json.loads(json.dumps(fixture))

                verifier = MagicMock()
                with patch("agent.nioh2_agent.parse_decrypted_file", side_effect=parse):
                    with self.assertRaisesRegex(RuntimeError, "副本发生变化"):
                        parse_and_store(main, backup, root, store, root / "items.json", root / "effects.json", "test", source_verifier=verifier)
                self.assertEqual(before, previous.read_bytes())
                self.assertEqual([previous], list(store.iterdir()))
                verifier.assert_not_called()


if __name__ == "__main__":
    unittest.main()
