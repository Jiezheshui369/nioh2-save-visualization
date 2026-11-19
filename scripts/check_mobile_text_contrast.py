"""Check computed text colors against actual Chrome background pixels.

Use browser QA --contrast first. Its isolated page hides glyphs without changing
backgrounds, then captures each text rectangle. This is a conservative pixel
check, not a claim about physical devices or every accessibility requirement.
"""
from pathlib import Path
import argparse, json, math, re
from PIL import Image
import numpy as np


def luminance(rgb):
    value = np.asarray(rgb, dtype=float) / 255
    value = np.where(value <= .04045, value / 12.92, ((value + .055) / 1.055) ** 2.4)
    return value[..., 0] * .2126 + value[..., 1] * .7152 + value[..., 2] * .0722


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    directory = args.directory.resolve(strict=True)
    assert directory.is_relative_to((root / '.local').resolve())
    checks = []
    for path in sorted(directory.glob('*.text.json')):
        image = Image.open(path.with_name(path.name.replace('.text.json', '.text-background.png'))).convert('RGB')
        background = np.asarray(image)
        for item in json.loads(path.read_text(encoding='utf-8')):
            box = item['box']
            left, top = max(0, math.floor(box['x'])), max(0, math.floor(box['y']))
            right = min(image.width, math.ceil(box['x'] + box['width']))
            bottom = min(image.height, math.ceil(box['y'] + box['height']))
            if right <= left or bottom <= top:
                continue
            color = [float(v) for v in re.findall(r'[\d.]+', item['color'])]
            alpha = color[3] if len(color) > 3 else 1
            bg = background[top:bottom, left:right].astype(float)
            foreground = np.asarray(color[:3]) * alpha + bg * (1 - alpha)
            l1, l2 = luminance(foreground), luminance(bg)
            contrast = (np.maximum(l1, l2) + .05) / (np.minimum(l1, l2) + .05)
            large = item['fontSize'] >= 24 or item['fontSize'] >= 18.67 and item['fontWeight'] >= 700
            threshold = 3 if large else 4.5
            minimum = float(contrast.min())
            checks.append({'page':path.name, 'text':item['text'], 'className':item['className'],
                           'fontSize':item['fontSize'], 'minimumContrast':minimum,
                           'threshold':threshold, 'passed':minimum + .01 >= threshold})
    assert checks, 'Missing contrast captures'
    failures = [row for row in checks if not row['passed']]
    report = {'method':'computed text RGBA vs glyph-hidden Chrome background pixels inside visible text rectangles',
              'syntheticOnly':True, 'physicalDeviceTest':False, 'checkedTextRectangles':len(checks),
              'minimumSmallTextContrast':min(row['minimumContrast'] for row in checks if row['threshold']==4.5),
              'failures':failures, 'checks':checks}
    (directory / 'TEXT_CONTRAST_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['checkedTextRectangles','minimumSmallTextContrast','failures']},ensure_ascii=False))
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
