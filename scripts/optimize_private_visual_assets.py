"""Lossless private PNG -> WebP derivatives; never modifies source pictures.

Use an existing Python runtime with Pillow. No dependency installation, downloads,
game access or public outputs. --apply updates only the private runtime manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, features

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = (ROOT / ".local").resolve()


def private_path(relative: str) -> Path:
    if not isinstance(relative, str) or not relative.startswith('.local/') or '\\' in relative or '..' in relative.split('/'):
        raise ValueError('Private manifest paths only')
    value = (ROOT / relative).resolve()
    if not value.is_relative_to(PRIVATE):
        raise ValueError('Path escaped the private directory')
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not features.check('webp'):
        raise RuntimeError('This existing Pillow runtime does not support WebP')
    manifest_path = private_path('.local/mobile-visual-20261011/runtime-assets.json')
    baseline_path = private_path('.local/mobile-visual-20261011/runtime-assets-before-optimization.json')
    manifest = json.loads((baseline_path if baseline_path.exists() else manifest_path).read_text(encoding='utf-8'))
    if manifest.get('schema') != 1 or not isinstance(manifest.get('images'), dict):
        raise ValueError('Unsupported private asset manifest')
    output = private_path('.local/mobile-visual-20261011/optimized-assets')
    output.mkdir(exist_ok=True)
    rows = []
    replacements = {}
    for relative in sorted(set(manifest['images'].values())):
        source = private_path(relative)
        if source.suffix != '.png':
            continue
        destination = private_path('.local/mobile-visual-20261011/optimized-assets/' + source.stem + '.webp')
        if destination.parent != output:
            raise ValueError('Derivative escaped its output directory')
        source_hash = sha256(source)
        with Image.open(source) as image:
            pixels = image.convert('RGBA')
        pixels.save(destination, 'WEBP', lossless=True, quality=100, method=6, exact=True)
        with Image.open(destination) as image:
            decoded = image.convert('RGBA')
        if decoded.size != pixels.size or decoded.tobytes() != pixels.tobytes():
            raise RuntimeError('Lossless pixel verification failed')
        if sha256(source) != source_hash:
            raise RuntimeError('Source asset changed during optimization')
        derivative = destination.relative_to(ROOT).as_posix()
        selected = destination.stat().st_size < source.stat().st_size
        if selected:
            replacements[relative] = derivative
        rows.append({'source': relative, 'optimized': derivative, 'size': list(pixels.size),
                     'sourceBytes': source.stat().st_size, 'optimizedBytes': destination.stat().st_size,
                     'sourceSha256': source_hash, 'optimizedSha256': sha256(destination),
                     'rgbaSha256': hashlib.sha256(pixels.tobytes()).hexdigest(),
                     'losslessPixelEquality': True, 'useOptimized': selected})
    evidence = {'format': 'lossless WebP; unchanged dimensions; exact RGBA equality', 'assets': rows}
    private_path('.local/mobile-visual-20261011/optimized-assets-manifest.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
    if args.apply:
        if not baseline_path.exists():
            baseline_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifest['images'] = {key: replacements.get(value, value) for key, value in manifest['images'].items()}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(rows), 'sourceBytes': sum(row['sourceBytes'] for row in rows),
                      'optimizedBytes': sum(min(row['sourceBytes'], row['optimizedBytes']) for row in rows),
                      'manifestApplied': args.apply}))


if __name__ == '__main__':
    main()
