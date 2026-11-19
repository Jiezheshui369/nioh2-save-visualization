"""Inventory existing private game/Figma derivatives and verify their evidence.

Only known .local asset folders are read. No game archives, player saves,
downloads, uploads or writes outside the private output are performed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = (ROOT / '.local').resolve()
RESEARCH = ROOT / '.local/visual-assets-research-20261011'
WORK = ROOT / '.local/mobile-visual-20261011'


def private_file(value: str | Path) -> Path:
    path = Path(value)
    resolved = (path if path.is_absolute() else ROOT / path).resolve()
    if not resolved.is_relative_to(PRIVATE):
        raise ValueError('Asset path escaped the private directory')
    return resolved


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    runtime = json.loads((WORK / 'runtime-assets.json').read_text(encoding='utf-8'))['images']
    optimized = json.loads((WORK / 'optimized-assets-manifest.json').read_text(encoding='utf-8'))['assets']
    rows: dict[str, dict] = {}
    source_evidence: dict[str, list] = {}
    game_files = []
    for name in ['sample-manifest.json', 'expanded-manifest.json', 'unmapped-manifest.json']:
        manifest = json.loads((RESEARCH / name).read_text(encoding='utf-8'))
        for asset in manifest['assets']:
            png, raw = private_file(asset['png']), private_file(asset['rawCopy'])
            if digest(png) != asset['pngSha256'] or digest(raw) != asset['sourceRangeSha256']:
                raise ValueError('Existing game derivative evidence changed')
            with Image.open(png) as image:
                if image.size != (asset['width'], asset['height']):
                    raise ValueError('Image dimensions differ from source evidence')
            evidence = {key: asset.get(key) for key in ['containerIndex', 'imageIndex', 'textureName', 'sourceRangeOffset', 'sourceRangeLength', 'sourceRangeSha256', 'format']}
            evidence['manifest'] = name
            source_evidence.setdefault(asset['pngSha256'], []).append(evidence)
            game_files.append(png)
    folders = [RESEARCH / 'samples', RESEARCH / 'expanded', RESEARCH / 'expanded-unmapped',
               WORK / 'figma-assets', WORK / 'final-design/assets', WORK / 'optimized-assets',
               RESEARCH, WORK, WORK / 'final-design']
    for folder in folders:
        for original in sorted(folder.iterdir()):
            if original.suffix.lower() not in {'.png', '.svg', '.webp', '.raw', '.dds'}:
                continue
            path = private_file(original)
            relative = path.relative_to(ROOT).as_posix()
            row = {'path': relative, 'bytes': path.stat().st_size, 'sha256': digest(path),
                   'kind': path.suffix[1:], 'runtimeKeys': [key for key, value in runtime.items() if private_file(value) == path],
                   'gameTextureEvidence': source_evidence.get(digest(path), []), 'privateOnly': True}
            if path.suffix.lower() in {'.png', '.webp'}:
                with Image.open(path) as image:
                    row['dimensions'] = list(image.size)
                    row['decodedRGBABytes'] = image.width * image.height * 4
            rows[relative] = row
    for asset in optimized:
        source, derivative = private_file(asset['source']), private_file(asset['optimized'])
        with Image.open(source) as image:
            source_pixels = image.convert('RGBA')
        with Image.open(derivative) as image:
            derivative_pixels = image.convert('RGBA')
        if source_pixels.size != derivative_pixels.size or source_pixels.tobytes() != derivative_pixels.tobytes():
            raise ValueError('Derivative is not lossless')
        if digest(source) != asset['sourceSha256'] or digest(derivative) != asset['optimizedSha256']:
            raise ValueError('Optimization evidence changed')
        row = rows[derivative.relative_to(ROOT).as_posix()]
        row['derivedFrom'] = source.relative_to(ROOT).as_posix()
        row['rgbaSha256'] = hashlib.sha256(source_pixels.tobytes()).hexdigest()
        row['losslessPixelEquality'] = True
        row['gameTextureEvidence'] = source_evidence.get(digest(source), [])
    uploads = json.loads((RESEARCH / 'figma-expanded-upload-manifest.json').read_text(encoding='utf-8'))
    for asset in uploads['assets']:
        relative = private_file(asset['png']).relative_to(ROOT).as_posix()
        rows[relative]['previousPrivateFigmaPlacement'] = {key: asset.get(key) for key in ['nodeId', 'imageHash', 'privatePreviewBinding']}
    selected = [row for row in rows.values() if row['runtimeKeys']]
    decoded = sum(row.get('decodedRGBABytes', 0) for row in selected)
    report = {'schema': 1, 'purpose': 'private-local-recovery-inventory; not a redistribution package',
              'newGameSourceReads': False, 'newUploads': False,
              'decodedGameFiles': len(game_files), 'decodedGameUniqueHashes': len({digest(path) for path in game_files}),
              'runtimeBindings': len(runtime), 'runtimeUniqueFiles': len(selected),
              'runtimeDecodedRGBABytesUpperBound': decoded,
              'memoryNote': 'Raster pixels only; excludes browser/GPU copies and SVG surfaces. Shared category URLs are reused; archive-wide textures are not preloaded. Compression does not reduce decoded memory.',
              'unresolvedConsumableMappings': ['仙药', '灵石', '御神水', '岁杀神之酒'],
              'files': sorted(rows.values(), key=lambda row: row['path'])}
    (WORK / 'PRIVATE_ASSET_INVENTORY.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['decodedGameFiles', 'decodedGameUniqueHashes', 'runtimeBindings', 'runtimeUniqueFiles', 'runtimeDecodedRGBABytesUpperBound']}))


if __name__ == '__main__':
    main()
