"""Emit an entirely synthetic parser snapshot for cross-language contract checks.

No file or save is read except the shipped static catalogs. Synthetic bytearrays
stay in memory and are never saved as game files.
"""
import json
from pathlib import Path
import struct

from agent.parser import EQUIPMENT_START, EQUIPMENT_SIZE, MIN_SAVE_SIZE, PARSER_VERSION, parse_bytes


def generate() -> dict:
    cases = [
        ('B4D8', 21, '2.1', True), ('5B76', 16, '1.6', True), ('5CFF', 15, '1.5', True),
        ('E5E7', 315, '31.5%', True), ('823B', 58, '5.8%', True), ('9D39', 298, '29.8%', True),
        ('9BF2', 33, '3.3%', True), ('8D1A', 31, '3.1%', True), ('AD6B', 59, '5.9%', True),
        ('3961', 13, 'AA', True), ('9AD2', 13, 'AA', True), ('24E8', 8, 'B+', True),
        ('3961', 12, '档位未解析', False), ('24E8', 9, '档位未解析', False),
        ('DAC2', 150, '条件词条（非数值加成）', False), ('D83E', 9, '单位未解析', False),
        ('91A6', 0, '0', True), ('91A6', 0xFFFFFFFF, '429496729.5', True),
        ('9158', 0xFFFFFFFF, '429496729.5%', True),
    ]
    data = bytearray(MIN_SAVE_SIZE)
    for index, (key, raw, _, _) in enumerate(cases):
        offset = EQUIPMENT_START + index * EQUIPMENT_SIZE
        data[offset:offset + 2] = bytes.fromhex('72D2')  # Catalog soul-core ID, synthetic record.
        struct.pack_into('<H', data, offset + 6, 1)
        data[offset + 20] = 5
        data[offset + 136] = 255  # No active equipment is inferred.
        struct.pack_into('<II', data, offset + 48, int(key, 16), raw)
    catalog = Path(__file__).resolve().parents[1] / 'data'
    parsed = parse_bytes(bytes(data), catalog / 'items.json', catalog / 'effects.json')
    snapshot = dict(schemaVersion='0.9.6-research', parserVersion=PARSER_VERSION,
                    game='Nioh 2', platform='synthetic-contract-test', snapshotId='synthetic-effect-contract',
                    sourceLastWriteLocal='2026-01-01T00:00:00Z',
                    safety=dict(sourceOpenedReadOnly=True, parsedFromCopy=True,
                                originalHashUnchangedAfterProcessing=True, originalMainSaveSha256='已隐藏'),
                    limitations=['Entirely synthetic test data; not a player archive.'], **parsed)
    return dict(synthetic=True, snapshot=snapshot,
                cases=[dict(index=i, effectId=key, rawValue=raw, expectedDisplay=display, verified=verified)
                       for i, (key, raw, display, verified) in enumerate(cases)])


if __name__ == '__main__':
    print(json.dumps(generate(), ensure_ascii=True))
