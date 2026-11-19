"""Create a NEW local recovery checkpoint from an explicit private asset inventory.

No saves, credentials, browser state, uploads or dependency installation.
Source ZIP uses the existing handoff allowlist; assets remain in a separate ZIP.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from prepare_handoff import export, verify

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / '.local/mobile-visual-20261011'


def sha(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to((ROOT / '.local').resolve()):
        raise ValueError('Recovery output must remain private')
    if output.exists():
        raise ValueError('Use a new checkpoint directory; existing material is preserved')
    inventory = json.loads((WORK / 'PRIVATE_ASSET_INVENTORY.json').read_text(encoding='utf-8'))
    selected = {}

    def add(path: Path, expected: str | None = None) -> None:
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to((ROOT / '.local').resolve()) or path.is_symlink():
            raise ValueError('Recovery member escaped the private directory')
        if resolved.suffix.lower() not in {'.json', '.txt', '.md', '.html', '.css', '.js', '.png', '.svg', '.webp', '.raw', '.dds'}:
            raise ValueError('Unexpected asset/build member')
        blob = resolved.read_bytes()
        if expected and sha(blob) != expected:
            raise ValueError('Asset changed since inventory was created')
        selected[resolved.relative_to(ROOT).as_posix()] = blob

    for row in inventory['files']:
        add(ROOT / row['path'], row['sha256'])
    for name in ['PRIVATE_ASSET_INVENTORY.json', 'runtime-assets.json', 'runtime-assets-before-optimization.json',
                 'optimized-assets-manifest.json', 'figma-assets-manifest.json', 'consumable-semantic-followup.json',
                 'STABLE_BUILD_ISOLATION.json', 'STABLE_QA_EVIDENCE.json', 'STABLE_REPORT.md']:
        add(WORK / name)
    for name in ['sample-manifest.json', 'expanded-manifest.json', 'unmapped-manifest.json',
                 'figma-upload-manifest.json', 'figma-expanded-upload-manifest.json']:
        add(ROOT / '.local/visual-assets-research-20261011' / name)
    for path in (WORK / 'final-design').iterdir():
        if path.is_file() and path.suffix in {'.txt', '.json'}:
            add(path)
    for path in (WORK / 'web-stable').rglob('*'):
        if path.is_file():
            add(path)
    for name in ['browser-qa-stable', 'browser-qa-A1-stable', 'browser-qa-failures-stable']:
        add(WORK / name / 'report.json')

    output.mkdir(parents=True, exist_ok=False)
    source_result = export(ROOT, output / 'source')
    verify(output / 'source/nioh2-source-private.zip')
    manifest = {'purpose': 'local-private-recovery-only', 'noPersonalSaveOrCredentialCopy': True,
                'files': [{'path': name, 'bytes': len(blob), 'sha256': sha(blob)} for name, blob in sorted(selected.items())]}
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
    archive = output / 'private-assets-and-web.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as zipped:
        for name, blob in sorted(selected.items()):
            zipped.writestr(name, blob)
        zipped.writestr('PRIVATE_RECOVERY_MANIFEST.json', encoded)
    with zipfile.ZipFile(archive) as zipped:
        assert set(zipped.namelist()) == set(selected) | {'PRIVATE_RECOVERY_MANIFEST.json'}
        for row in manifest['files']:
            blob = zipped.read(row['path'])
            assert len(blob) == row['bytes'] and sha(blob) == row['sha256']
    (output / 'PRIVATE_RECOVERY_MANIFEST.json').write_bytes(encoded)
    result = {'source': source_result, 'privateAssetAndBuildFiles': len(selected),
              'privateZipBytes': archive.stat().st_size, 'privateZipSha256': sha(archive.read_bytes()),
              'allMembersVerified': True, 'personalSnapshotsCopied': False}
    (output / 'CHECKPOINT_RESULT.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    (output / 'SHA256SUMS.txt').write_text(result['privateZipSha256'] + '  private-assets-and-web.zip\n' +
                                        source_result['zipSha256'] + '  source/nioh2-source-private.zip\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
