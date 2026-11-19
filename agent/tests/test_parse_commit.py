"""Publishing must fail closed if any independently copied input changes."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from agent.nioh2_agent import parse_and_store
from agent.nioh2_agent import ApiHandler
from agent.tools.synthetic_publication_contract import snapshot
from agent.publication_store import read_remote_publication, RemotePublicationNotReady, latest_publication


class ParseCommitTests(unittest.TestCase):
    def test_relay_disabled_uint64_import_succeeds_and_preserves_exact_local_data(self):
        for amount in (2**53,2**53+1,2**64-1):
            with self.subTest(amount=amount), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);store=root/'store';main=root/'synthetic-input';main.write_bytes(b'synthetic-parser-input')
                raw=snapshot();raw['character']['amrita']=amount;raw['character']['gold']=amount
                def pipeline(**kwargs):
                    # Exercise actual parse-and-commit path; only the binary parser is synthetic.
                    with patch('agent.nioh2_agent.parse_decrypted_file',return_value=raw):
                        return parse_and_store(main,None,root,store,root/'items.json',root/'effects.json','synthetic-hash')
                handler=object.__new__(ApiHandler);handler.store=store;handler.pipeline_defaults={'synthetic':True}
                handler.refresh_lock=threading.Lock();handler.headers={}
                with patch.dict('os.environ',{'RELAY_ENABLED':'false'}), patch.object(handler,'_desktop_sync_allowed',return_value=True), patch.object(handler,'_request_body',return_value=b'synthetic-upload'), patch('agent.nioh2_agent.run_pipeline',side_effect=pipeline), patch.object(handler,'_json') as response:
                    handler._upload_save()
                status,result=response.call_args.args;self.assertEqual(200,status)
                self.assertEqual(amount,result['character']['amrita']);self.assertEqual(amount,result['character']['gold'])
                self.assertEqual({'status':'not-ready','reason':'UNSAFE_INTEGER'},result['localPublication']['remotePublication'])
                stored=json.loads((store/(raw['snapshotId']+'.json')).read_text(encoding='utf-8'))
                self.assertEqual(amount,stored['character']['amrita']);self.assertEqual(amount,stored['character']['gold'])
                self.assertEqual(amount,latest_publication(store)['canonicalSnapshot']['character']['gold'])
                self.assertFalse(handler.refresh_lock.locked())
                with self.assertRaises(RemotePublicationNotReady):read_remote_publication(store)

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
