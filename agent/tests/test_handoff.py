import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.prepare_handoff import allowed, collect, export, verify


class HandoffTests(unittest.TestCase):
    def test_allowlist_excludes_private_generated_and_signing_files(self):
        for name in ['.local/character.json', 'SAVEDATA.BIN', 'agent/data/SAVEDATA.BIN',
                     'agent/tools/katana/_OUTPUT/save.bin', 'agent/tools/katana/_JsonWorkspace/save.json',
                     'android/local.properties', 'android/app/build/test.json',
                     'android/app/src/main/assets/public/index.html', 'ios/App/App/public/index.html',
                     'ios/App/App/capacitor.config.json', 'ios/App/Pods/test.swift',
                     'ios/App/App.xcodeproj/xcuserdata/user.xcuserdatad/test.xcscheme',
                     'packaging/studio-d.properties', 'agent/data/key.pem', 'agent/data/signing.p12',
                     'design-assets/screenshot.png', 'public/character.json', 'src/.env',
                     'vite.config.js', 'tsconfig.app.tsbuildinfo', 'relay/.dev.vars',
                     'relay/.dev.vars.production', 'relay/.wrangler/state.json',
                     'relay/node_modules/dependency/index.js']:
            with self.subTest(name=name):
                self.assertFalse(allowed(name))

    def test_required_source_and_build_files_survive(self):
        for name in ['package-lock.json', 'capacitor.config.ts', 'src/App.tsx', 'src/mobile.css',
                     'src/assets/figma/wallet.svg', 'agent/data/items.json',
                     'agent/tools/katana/LICENSE.txt', 'android/gradlew',
                     'android/gradle/wrapper/gradle-wrapper.jar', 'ios/App/App/Info.plist',
                     '.github/workflows/check.yml', 'docs/MAC_HANDOFF.md',
                     'relay/src/index.js', 'relay/wrangler.jsonc', 'relay/.gitignore',
                     'contracts/publication-v1-vectors.json']:
            with self.subTest(name=name):
                self.assertTrue(allowed(name))

    def test_exports_hash_manifest_without_private_files_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            (root / 'README.md').write_text('synthetic source', encoding='utf-8')
            (root / '.local').mkdir()
            (root / '.local' / 'private.json').write_text('PRIVATE', encoding='utf-8')
            output = Path(directory) / 'output'
            result = export(root, output)
            self.assertEqual(result['fileCount'], 1)
            archive = output / 'nioh2-source-private.zip'
            self.assertEqual(result['zipSha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(verify(archive)['fileCount'], 1)
            with zipfile.ZipFile(archive) as zipped:
                self.assertEqual(set(zipped.namelist()), {'README.md', 'HANDOFF_MANIFEST.json'})
                manifest = json.loads(zipped.read('HANDOFF_MANIFEST.json'))
                self.assertEqual(manifest['files'][0]['path'], 'README.md')
                self.assertEqual(manifest['files'][0]['sha256'], hashlib.sha256(zipped.read('README.md')).hexdigest())
            with self.assertRaises(FileExistsError):
                export(root, output)
            self.assertEqual((root / '.local' / 'private.json').read_text(), 'PRIVATE')

    def test_rejects_archive_members_outside_source_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'bad.zip'
            with zipfile.ZipFile(target, 'w') as archive:
                archive.writestr('../README.md', 'unsafe')
            with self.assertRaisesRegex(ValueError, 'Unexpected archive member'):
                verify(target)

    def test_detects_modified_zip_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            (root / 'README.md').write_text('original')
            output = Path(directory) / 'out'
            export(root, output)
            bad = Path(directory) / 'modified.zip'
            with zipfile.ZipFile(output / 'nioh2-source-private.zip') as original, zipfile.ZipFile(bad, 'w') as changed:
                for name in original.namelist():
                    changed.writestr(name, b'modified' if name == 'README.md' else original.read(name))
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                verify(bad)

    def test_detects_accidentally_placed_player_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'agent').mkdir()
            (root / 'agent' / 'sample.json').write_text('{"snapshotId":"personal"}')
            with self.assertRaisesRegex(ValueError, 'Player-like archive'):
                collect(root)

    def test_rejects_credentials_and_changed_bundled_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('ghp_' + 'a' * 36)
            with self.assertRaisesRegex(ValueError, 'credential'):
                collect(root)
            (root / 'README.md').write_text('safe')
            binary = root / 'agent/tools/katana/katana-savedata-resigner-cli.exe'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'not the pinned binary')
            with self.assertRaisesRegex(ValueError, 'pinned dependency'):
                collect(root)

    def test_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            target = Path(directory) / 'private.md'
            target.write_text('private')
            try:
                (root / 'README.md').symlink_to(target)
            except OSError:
                self.skipTest('OS does not permit creating symlinks')
            with self.assertRaisesRegex(ValueError, 'Linked path'):
                collect(root)


if __name__ == '__main__':
    unittest.main()
