"""Create a fresh, allowlisted source ZIP for PRIVATE cross-machine development.

Does not initialise git, upload anything, copy saves or establish asset licensing.
Run with --check first. Every included file is hashed; source links are rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile

ROOT_FILES = {
    '.gitignore', '.gitattributes', '.nvmrc', 'AGENTS.md', 'README.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'package.json', 'package-lock.json',
    'capacitor.config.ts', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'desktop_self_test.py',
    'tsconfig.node.json', 'index.html', 'desktop_launcher.py', 'desktop_window.py',
    'build-android.ps1', 'build-mobile.ps1', 'build-windows.ps1', 'run-local.ps1',
    'start-local.cmd', 'start-phone-test.cmd', 'start-private-mobile.cmd', 'start-private-mobile-color.cmd',
}
SOURCE_DIRS = {'src', 'agent', 'scripts', 'docs', 'packaging', 'android', 'ios', '.github', 'relay', 'contracts'}
SOURCE_SUFFIXES = {
    '.ts', '.tsx', '.mts', '.js', '.mjs', '.py', '.md', '.txt', '.json', '.svg', '.xml', '.css',
    '.gradle', '.properties', '.java', '.kt', '.swift', '.plist', '.storyboard',
    '.xcprivacy', '.pbxproj', '.xcworkspacedata', '.xcscheme', '.entitlements',
    '.jsonc', '.yml', '.yaml', '.ps1', '.sh', '.cmd', '.bat', '.spec', '.xcconfig',
}
SKIP_PARTS = {
    'node_modules', '__pycache__', '.gradle', 'build', 'Pods', 'DerivedData',
    'xcuserdata', '_OUTPUT', '_JsonWorkspace', 'assets', 'capacitor-cordova-android-plugins',
}
PUBLIC_FILES = {'_headers', 'app.ico', 'apple-touch-icon.png', 'icon-192.png',
                'icon-512.png', 'icon.svg', 'manifest.webmanifest', 'sw.js', 'data/demo-snapshot.json'}
GAME_ASSETS = {
    'nioh2-weapons/' + name + '.png' for name in (
        'sword_logo', 'dual_swords_logo', 'spear_logo', 'axe_logo', 'kusarigama_logo',
        'odachi_logo', 'tonfa_logo', 'hatchets_logo', 'switchglaive', 'splitstaff',
        'fists_logo', 'bow_logo', 'rifle_logo')
} | {'nioh2-equipment/' + name + '.png' for name in (
    'arms', 'body', 'demon-parade-scroll', 'feet', 'head', 'legs', 'omamori', 'yasakani-magatama'
)} | {'nioh2-equipment/manifest.json', 'nioh2-equipment/README.md'}
KATANA = 'agent/tools/katana/katana-savedata-resigner-cli.exe'
# Existing pinned dependency, not any executable in the project.
KATANA_SHA256 = '677F49B8F7B271303773C4F96D4772320A90FB87F22D510DC1B08682732AFA0E'
FORBIDDEN_NAMES = {'savedata.bin', 'backup.bin', 'local.properties', 'studio-d.properties',
                   'capacitor.config.json', 'capacitor.plugins.json'}
SECRET = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b')


def allowed(relative: str) -> bool:
    path = Path(relative)
    parts = path.parts
    if path.name.lower() in FORBIDDEN_NAMES or any(p in SKIP_PARTS for p in parts):
        # src/assets contains deliberately checked-in SVG UI icons, not native generated assets.
        if not (relative.startswith('src/assets/') and path.suffix in {'.svg', '.md'}):
            return False
    if relative == 'relay/.gitignore':
        return True
    if relative in ROOT_FILES or relative == KATANA or relative == 'agent/tools/katana/LICENSE.txt':
        return True
    if relative.startswith('agent/tools/katana/'):
        return False
    if parts[0] == 'public':
        return '/'.join(parts[1:]) in PUBLIC_FILES
    if parts[0] == 'design-assets':
        return '/'.join(parts[1:]) in GAME_ASSETS
    if parts[0] not in SOURCE_DIRS or any(p.startswith('.') for p in parts[1:]):
        return False
    if relative.startswith('ios/App/App/public/'):
        return False
    if relative in {'android/gradlew', 'android/gradle/wrapper/gradle-wrapper.jar'}:
        return True
    if relative.startswith('android/app/src/main/res/') and path.suffix == '.png':
        return True
    if relative.startswith('ios/App/App/Assets.xcassets/') and path.suffix == '.png':
        return True
    return path.suffix in SOURCE_SUFFIXES


def collect(root: Path) -> dict[str, bytes]:
    root = root.resolve(strict=True)
    result = {}

    def walk(directory: Path):
        for path in sorted(directory.iterdir()):
            relative = path.relative_to(root).as_posix()
            # Reject links on selected trees, including Windows junctions. Never traverse one.
            info = path.lstat()
            linked = path.is_symlink() or bool(getattr(info, 'st_file_attributes', 0) & 0x400)
            if linked:
                raise ValueError(f'Linked path must be reviewed: {relative}')
            if path.is_dir():
                parts = path.relative_to(root).parts
                if len(parts) == 1 and parts[0] not in SOURCE_DIRS | {'public', 'design-assets'}:
                    continue
                if any(p in SKIP_PARTS for p in parts) and relative != 'src/assets' and not relative.startswith('src/assets/'):
                    continue
                if any(p.startswith('.') for p in parts[1:]):
                    continue
                walk(path)
            elif allowed(relative):
                if not stat.S_ISREG(info.st_mode) or info.st_size > 8 * 1024 * 1024:
                    raise ValueError(f'Unexpected source file: {relative}')
                blob = path.read_bytes()
                if SECRET.search(blob):
                    raise ValueError(f'Potential credential in {relative}; export stopped')
                if relative == KATANA and hashlib.sha256(blob).hexdigest().upper() != KATANA_SHA256:
                    raise ValueError('Katana binary does not match the pinned dependency')
                if path.suffix == '.json':
                    data = json.loads(blob)
                    if isinstance(data, dict) and ('snapshotId' in data or data.get('format') == 'nioh2-character-assets'):
                        if relative != 'public/data/demo-snapshot.json' or data.get('snapshotId') != 'synthetic-demo':
                            raise ValueError(f'Player-like archive must not migrate: {relative}')
                result[relative] = blob
    walk(root)
    return result


def export(root: Path, output: Path) -> dict:
    files = collect(root)
    # New destination only: never overwrite or remove existing material.
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'version': 1, 'purpose': 'private-development-handoff',
                'warnings': ['Game art/data licensing still needs review before public redistribution.',
                             'No original saves, decrypted saves, personal archives, credentials or chat history included.',
                             'iOS native compilation and physical-device acceptance require a Mac.'],
                'files': [{'path': name, 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()}
                          for name, blob in sorted(files.items())]}
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    archive = output / 'nioh2-source-private.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        for name, blob in sorted(files.items()):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (0o100755 if name == 'android/gradlew' or name.endswith('.sh') else 0o100644) << 16
            z.writestr(info, blob, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('HANDOFF_MANIFEST.json', encoded)
    with (output / 'HANDOFF_MANIFEST.json').open('xb') as stream:
        stream.write(encoded)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with (output / 'SHA256SUMS.txt').open('x', encoding='utf-8') as stream:
        stream.write(f'{digest}  {archive.name}\n')
    return {'fileCount': len(files), 'zipBytes': archive.stat().st_size, 'zipSha256': digest}


def verify(archive: Path) -> dict:
    """Integrity/allowlist check, not a digital signature or complete secret scanner."""
    if archive.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('Archive exceeds handoff size limit')
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        names = [member.filename for member in members]
        if len(names) != len(set(names)) or len(names) > 1000 or sum(m.file_size for m in members) > 40 * 1024 * 1024:
            raise ValueError('Duplicate members or unexpected archive size')
        for member in members:
            name = member.filename
            if (member.file_size > 8 * 1024 * 1024 or '\\' in name or ':' in name
                    or name.startswith('/') or any(p in {'', '.', '..'} for p in name.split('/'))
                    or stat.S_ISLNK(member.external_attr >> 16)
                    or name != 'HANDOFF_MANIFEST.json' and not allowed(name)):
                raise ValueError('Unexpected archive member')
        manifest = json.loads(zipped.read('HANDOFF_MANIFEST.json'))
        declared = manifest['files']
        if len(declared) != len(names) - 1 or {row['path'] for row in declared} != set(names) - {'HANDOFF_MANIFEST.json'}:
            raise ValueError('Manifest members differ from archive')
        for row in declared:
            blob = zipped.read(row['path'])
            if len(blob) != row['bytes'] or hashlib.sha256(blob).hexdigest() != row['sha256']:
                raise ValueError('Source file checksum mismatch')
            if SECRET.search(blob):
                raise ValueError('Potential credential found in archive')
    return {'fileCount': len(declared), 'status': 'hashes and source allowlist verified'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.verify)))
    elif args.check:
        files = collect(args.root)
        print(json.dumps({'fileCount': len(files), 'bytes': sum(map(len, files.values())),
                          'status': 'allowlist check passed; private migration only'}))
    elif args.output:
        print(json.dumps(export(args.root, args.output)))
    else:
        parser.error('Use --check or --output with a new directory')


if __name__ == '__main__':
    main()
