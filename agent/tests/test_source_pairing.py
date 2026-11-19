import json,tempfile,unittest,threading,http.client
from pathlib import Path
from unittest.mock import patch
from agent import nioh2_agent as agent

class SourcePairingTests(unittest.TestCase):
    def make(self,root,name='account-a',system=True):
        account=root/name;slot=account/'SAVEDATA00';slot.mkdir(parents=True)
        (slot/'SAVEDATA.BIN').write_bytes(b'character-'+name.encode())
        (slot/'BACKUP.BIN').write_bytes(b'backup-'+name.encode())
        if system:
            system_dir=account/'SYSTEMSAVEDATA00';system_dir.mkdir()
            (system_dir/'SAVEDATA.BIN').write_bytes(b'system-'+name.encode())
        return account,slot
    def snapshot(self,source,workspace):
        with patch.object(agent,'wait_until_stable'):
            copied=agent.snapshot_save(source,workspace)
        manifest=json.loads((copied/'snapshot-manifest.json').read_text(encoding='utf-8'))
        return copied,manifest
    def test_selected_slot_copies_exact_same_account_pair_and_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root)
            copied,manifest=self.snapshot(slot,root/'work')
            self.assertEqual({'SAVEDATA00/SAVEDATA.BIN','SAVEDATA00/BACKUP.BIN','SYSTEMSAVEDATA00/SAVEDATA.BIN'},
                             {x['relative_path'].replace('\\','/') for x in manifest['files']})
            self.assertEqual('SYSTEMSAVEDATA00/SAVEDATA.BIN',manifest['selection']['pairedSystemRelativePath'])
            for item in manifest['files']:
                self.assertEqual(agent.sha256(account/item['relative_path']),item['source_sha256'])
                self.assertEqual(item['source_sha256'],agent.sha256(copied/item['relative_path']))
            agent._verify_original_manifest(slot,manifest)
    def test_never_copies_other_slots_nested_files_or_other_accounts(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root);self.make(root,'account-b')
            other=account/'SAVEDATA01';other.mkdir();(other/'SAVEDATA.BIN').write_bytes(b'other-slot')
            nested=slot/'nested/SAVEDATA02';nested.mkdir(parents=True);(nested/'SAVEDATA.BIN').write_bytes(b'nested-slot')
            copied,manifest=self.snapshot(slot,root/'work')
            self.assertEqual(3,len(manifest['files']))
            self.assertFalse(list(copied.rglob('SAVEDATA01')))
            self.assertFalse(list(copied.rglob('nested')))
            self.assertEqual(b'system-account-a',(copied/'SYSTEMSAVEDATA00/SAVEDATA.BIN').read_bytes())
    def test_missing_system_does_not_borrow_another_account(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root,system=False);self.make(root,'account-b')
            copied,manifest=self.snapshot(slot,root/'work')
            self.assertEqual(2,len(manifest['files']));self.assertIsNone(manifest['selection']['pairedSystemRelativePath'])
            self.assertFalse((copied/'SYSTEMSAVEDATA00').exists())
    def test_direct_file_snapshot_is_unpaired_even_when_sibling_system_exists(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root)
            copied,manifest=self.snapshot(slot/'SAVEDATA.BIN',root/'work')
            self.assertEqual(['SAVEDATA.BIN'],[x['relative_path'] for x in manifest['files']])
            self.assertIsNone(manifest['selection']['pairedSystemRelativePath'])
    def test_changed_system_after_copy_is_detected_before_publish(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root);_,manifest=self.snapshot(slot,root/'work')
            (account/'SYSTEMSAVEDATA00/SAVEDATA.BIN').write_bytes(b'changed-system')
            with self.assertRaises(RuntimeError):agent._verify_original_manifest(slot,manifest)
    def test_changed_system_during_copy_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root);original=agent.shutil.copyfileobj
            def copy(src,dst,**kwargs):
                result=original(src,dst,**kwargs)
                if Path(src.name).parent.name=='SYSTEMSAVEDATA00':Path(src.name).write_bytes(b'changed-system')
                return result
            with patch.object(agent,'wait_until_stable'),patch.object(agent.shutil,'copyfileobj',side_effect=copy),self.assertRaises(RuntimeError):
                agent.snapshot_save(slot,root/'work')
            self.assertTrue(list((root/'work').glob('*/.incomplete')))
    def test_factory_retains_character_selection_and_snapshot_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);account,slot=self.make(root)
            server=agent.create_http_server(root/'store','127.0.0.1',0,source=account)
            try:
                selected=server.RequestHandlerClass.pipeline_config['source']
                self.assertEqual(slot.resolve(),selected)
                _,manifest=self.snapshot(selected,root/'work')
                self.assertEqual(3,len(manifest['files']))
            finally:server.RequestHandlerClass.mobile_sync.stop();server.server_close()
    def test_factory_source_id_keeps_each_accounts_own_system(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.make(root,'account-a');self.make(root,'account-b')
            server=agent.create_http_server(root/'store','127.0.0.1',0,source=root)
            try:
                handler=server.RequestHandlerClass
                self.assertIsNone(handler.pipeline_config)
                for source in handler.source_options.values():
                    copied,manifest=self.snapshot(source,root/'work')
                    self.assertEqual(b'system-'+source.parent.name.encode(),(copied/'SYSTEMSAVEDATA00/SAVEDATA.BIN').read_bytes())
                    self.assertEqual(3,len(manifest['files']))
            finally:server.RequestHandlerClass.mobile_sync.stop();server.server_close()

    def test_pipeline_rechecks_copied_and_original_system_after_parsing(self):
        for mutation in ('copied','original'):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);account,slot=self.make(root);workspace=root/'copies'
                decryptor=root/'decryptor/tool.exe';decryptor.parent.mkdir();decryptor.write_bytes(b'synthetic-decryptor')
                def decrypt(*args,**kwargs):
                    out=decryptor.parent/'_OUTPUT/result/SAVEDATA00/SAVEDATA.BIN'
                    out.parent.mkdir(parents=True);out.write_bytes(bytes(1000001))
                    return type('Result',(),dict(returncode=0,stdout='',stderr=''))()
                def parse(*args,**kwargs):
                    paired=kwargs['paired_system_path']
                    self.assertTrue(paired.is_relative_to(workspace.resolve()))
                    target=paired if mutation=='copied' else account/'SYSTEMSAVEDATA00/SAVEDATA.BIN'
                    target.write_bytes(b'changed-during-parse')
                    args[10]()
                    self.fail('A changed independent system input was accepted')
                with patch.object(agent,'wait_until_stable'),patch.object(agent.subprocess,'run',side_effect=decrypt),patch.object(agent,'parse_and_store',side_effect=parse),self.assertRaises(RuntimeError):
                    agent.run_pipeline(slot,workspace,root/'store',decryptor,root/'items.json',root/'effects.json')
                self.assertFalse((root/'store').exists())

if __name__=='__main__':unittest.main()
