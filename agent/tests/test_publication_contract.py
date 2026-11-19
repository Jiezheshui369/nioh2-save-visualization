import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from agent.publication_contract import publication_bytes, public_parsed_snapshot
from agent.publication_store import DATABASE_NAME, LOCAL_ONLY_ENCODING, RemotePublicationNotReady, read_remote_publication, record_parsed_snapshot, publication_receipt, latest_publication
from agent.tools.synthetic_publication_contract import snapshot
from agent.nioh2_agent import ApiHandler


class PublicationContractTests(unittest.TestCase):
    def test_fixed_encoding_vectors_and_invalid_values(self):
        vectors = json.loads((Path(__file__).parents[2]/'contracts/publication-v1-vectors.json').read_text(encoding='utf-8'))
        for v in vectors:
            with self.subTest(v['name']):
                raw = publication_bytes(v['value'])
                self.assertEqual(v['bytesHex'], raw.hex())
                self.assertEqual(v['sha256'], hashlib.sha256(raw).hexdigest())
        for value in [float('nan'), float('inf'), 9007199254740992, 2**2000, '\ud800', {'\udfff': 1}, object()]:
            with self.assertRaises((ValueError, UnicodeError)): publication_bytes(value)
        self.assertEqual(publication_bytes(-0.0), publication_bytes(0))

    def test_legacy_read_does_not_migrate_or_rewrite_database(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Path(directory); raw=snapshot(); db=store/DATABASE_NAME
            # Pre-v1 schema and hash: intentionally preserve the historical receipt.
            with closing(sqlite3.connect(db)) as c, c:
                c.execute('CREATE TABLE publications(version INTEGER PRIMARY KEY AUTOINCREMENT,snapshot_id TEXT UNIQUE,revision TEXT,canonical TEXT,public TEXT,prepared_at TEXT)')
                c.execute('INSERT INTO publications VALUES(?,?,?,?,?,?)',(7,raw['snapshotId'],'a'*64,json.dumps(raw),'{}','2001-01-01T00:00:00Z'))
            before=db.read_bytes(); result=read_remote_publication(store)
            self.assertEqual(7,result['publicationVersion']); self.assertNotEqual('a'*64,result['revision'])
            self.assertEqual(before,db.read_bytes()); self.assertNotIn('canonicalSnapshot',result)
            changed=snapshot();changed['character']['level']+=1
            with self.assertRaises(ValueError):record_parsed_snapshot(store,changed)
            self.assertEqual(before,db.read_bytes(), 'failed publication must roll back schema migration too')
            receipt=record_parsed_snapshot(store,raw)
            self.assertEqual('a'*64,receipt['revision']); self.assertEqual(receipt,publication_receipt(store,raw['snapshotId']))
            self.assertEqual(result,read_remote_publication(store))
            changed=snapshot();changed['character']['level']+=1
            with self.assertRaises(ValueError):record_parsed_snapshot(store,changed)

    def test_current_rows_monotonic_projection_and_read_only_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Path(directory)
            with self.assertRaises(FileNotFoundError):read_remote_publication(store)
            self.assertFalse((store/DATABASE_NAME).exists())
            first=snapshot(); a=record_parsed_snapshot(store,first)
            self.assertEqual(a['revision'],read_remote_publication(store)['revision'])
            second=snapshot();second['snapshotId']='synthetic-second'; b=record_parsed_snapshot(store,second)
            self.assertGreater(b['publicationVersion'],a['publicationVersion'])
            self.assertEqual(b['publicationVersion'],read_remote_publication(store)['publicationVersion'])
            projected=public_parsed_snapshot(first)
            self.assertNotIn('equipIndex',projected['scrolls'][0]);self.assertNotIn('privateDiagnostic',projected['character']['attributes'])

    def test_endpoint_requires_desktop_guard_before_read(self):
        handler=object.__new__(ApiHandler);handler.path='/api/publications/latest';handler.store=Path('not-used');handler.headers={}
        with patch.object(handler,'_authorized',return_value=True), patch.object(handler,'_desktop_sync_allowed',return_value=False), patch.object(handler,'_json') as out, patch('agent.nioh2_agent.read_remote_publication') as read:
            handler.do_GET();self.assertEqual(403,out.call_args.args[0]);read.assert_not_called()
        with patch.object(handler,'_authorized',return_value=True), patch.object(handler,'_desktop_sync_allowed',return_value=True), patch.object(handler,'_json') as out, patch('agent.nioh2_agent.read_remote_publication',return_value={'synthetic':True}) as read:
            handler.do_GET();read.assert_called_once_with(handler.store);self.assertEqual(200,out.call_args.args[0])
        with patch.object(handler,'_authorized',return_value=True), patch.object(handler,'_desktop_sync_allowed',return_value=True), patch.object(handler,'_json') as out, patch('agent.nioh2_agent.read_remote_publication',side_effect=RemotePublicationNotReady()):
            handler.do_GET();self.assertEqual(409,out.call_args.args[0])
            self.assertEqual({'error':'REMOTE_PUBLICATION_NOT_READY','reason':'UNSAFE_INTEGER'},out.call_args.args[1])

    def test_uint64_is_stored_exactly_locally_but_not_given_a_remote_revision(self):
        for field in ('amrita','gold'):
            for amount in (2**53,2**53+1,2**64-1):
                with self.subTest(field=field,amount=amount), tempfile.TemporaryDirectory() as directory:
                    store=Path(directory);raw=snapshot();raw['character'][field]=amount
                    receipt=record_parsed_snapshot(store,raw)
                    self.assertEqual('ready-local',receipt['status'])
                    self.assertEqual({'status':'not-ready','reason':'UNSAFE_INTEGER'},receipt['remotePublication'])
                    self.assertEqual(receipt,publication_receipt(store,raw['snapshotId']))
                    self.assertEqual(receipt,record_parsed_snapshot(store,raw))
                    local=latest_publication(store)
                    self.assertEqual(amount,local['canonicalSnapshot']['character'][field])
                    self.assertEqual(amount,local['snapshot']['character'][field])
                    with closing(sqlite3.connect(store/DATABASE_NAME)) as connection:
                        encoding=connection.execute('SELECT encoding FROM publications').fetchone()[0]
                    self.assertEqual(LOCAL_ONLY_ENCODING,encoding)
                    before=(store/DATABASE_NAME).read_bytes()
                    with self.assertRaises(RemotePublicationNotReady) as raised:read_remote_publication(store)
                    self.assertEqual('UNSAFE_INTEGER',raised.exception.reason)
                    self.assertEqual(before,(store/DATABASE_NAME).read_bytes())

    def test_local_identity_distinguishes_adjacent_unsafe_integers_without_rounding(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Path(directory);first=snapshot();first['character']['amrita']=2**53
            a=record_parsed_snapshot(store,first)
            changed=snapshot();changed['character']['amrita']=2**53+1
            with self.assertRaises(ValueError):record_parsed_snapshot(store,changed)
            changed['snapshotId']='synthetic-adjacent-uint64';b=record_parsed_snapshot(store,changed)
            self.assertNotEqual(a['revision'],b['revision'])
            self.assertEqual(2**53+1,latest_publication(store)['canonicalSnapshot']['character']['amrita'])


if __name__=='__main__':unittest.main()
