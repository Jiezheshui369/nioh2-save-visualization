"""Prepare static, ID-keyed local resources; never copy player state into the app."""
import argparse
import hashlib
import json
from pathlib import Path


def prepare(evidence: Path, markdown: Path, root: Path) -> None:
    source = json.loads(evidence.read_text(encoding='utf-8'))
    table = {}
    for line in markdown.read_text(encoding='utf-8').splitlines():
        cells = [cell.strip() for cell in line.split('|')]
        if len(cells) == 8 and cells[6].startswith('0x'):
            key = int(cells[6], 16)
            if key in table:
                raise ValueError('Duplicate markdown title ID')
            table[key] = cells
    definitions, texts = [], {}
    for row in source['rows']:
        d = row['definition']; key = row['title_id']; cells = table[key]
        for value, digest in [(d['name'], d['source']['name_utf8_sha256']),
                              (d['condition_text'], d['source']['condition_utf8_sha256'])]:
            if hashlib.sha256(value.encode('utf-8')).hexdigest() != digest:
                raise ValueError('Native text hash differs')
        if (d['name'], d['condition_text'], d['fame_score_reward_u32']) != (cells[1], cells[2], int(cells[5])):
            raise ValueError('Markdown and native definition disagree by ID')
        definitions.append(dict(titleId=key, category=d['native_category'],
            threshold=d['threshold_parameter_u32'], reward=d['fame_score_reward_u32'],
            priorTitleId=d['prior_title_id'], textKey=f'title:{key:08X}', iconId=None))
        texts[f'title:{key:08X}'] = {'name': d['name'], 'condition': d['condition_text']}
    if len(definitions) != 390 or len({d['titleId'] for d in definitions}) != 390 or len(table) != 390:
        raise ValueError('Expected exact 390-ID catalog')
    catalog = dict(version='titles-v225', gameId='nioh2', definitions=definitions)
    outputs = {'agent/data/titles-v1.json': catalog, 'src/titleDefinitions.json': catalog,
        'src/titleTextIndex.json': {'version': 1, 'locales': {'zh-CN': texts, 'en': {}}},
        'src/titleIconIndex.json': {'version': 1, 'icons': {}}}
    for name, value in outputs.items():
        (root/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('390 ID definitions and Chinese texts verified; English and icons unbound (no inferred assets).')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--markdown', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.evidence, args.markdown, Path(__file__).resolve().parent.parent)
