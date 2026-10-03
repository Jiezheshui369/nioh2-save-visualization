import json
from pathlib import Path
import struct
import unittest

from agent.parser import _format_effect_magnitude, EQUIPMENT_START, EQUIPMENT_SIZE, SCROLL_START, SCROLL_SIZE
from agent.tools.analyze_character_status import analyze, byte_candidates, normalized_label, markdown, core_candidates, panel_search_value


class CharacterStatusResearchTests(unittest.TestCase):
    def test_requested_maximum_only_does_not_mutate_observation(self):
        row = self.row('妖力', '0.0 / 17.8')
        report = analyze(self.observations([row]), {'character': {}}, b'')
        self.assertEqual(report['rows'][0]['searchTarget'], '17.8')
        self.assertEqual(report['rows'][0]['observed'], '0.0 / 17.8')
        self.assertEqual(row['value'], '0.0 / 17.8')
        self.assertEqual(panel_search_value('装备重量', '38.0/57.4'), '38.0/57.4')
        self.assertEqual(panel_search_value('体力', '+964'), '+964')

    def test_extended_scan_reports_unverified_16bit_big_endian_and_fixed_point(self):
        data = struct.pack('>H', 9841) + struct.pack('<I', 984100)
        results = byte_candidates(data, '9841', extended=True)
        be = next(c for c in results if c['encoding'] == 'uint16-be')
        fixed = next(c for c in results if c['encoding'] == 'scaled-100-uint32-le')
        self.assertEqual(be['candidateOffsets'], ['0x0'])
        self.assertEqual(fixed['candidateOffsets'], ['0x2'])
        self.assertTrue(all(c['verified'] is False for c in results))
        self.assertFalse(any(c['encoding'] == 'uint16-be' for c in byte_candidates(data, '9841')))

    def observations(self, panel=None, effects=None):
        return {'source': 'game-screenshots',
                'groups': [{'title': '基础', 'entries': panel or []}],
                'effects': [{'title': '特殊效果', 'entries': effects or []}]}

    def row(self, label, value):
        return {'label': label, 'value': value, 'pages': [1]}

    def test_weight_codec_is_decimal_flat_not_integer_or_percentage(self):
        effect = {'id': '91A6', 'CAP': '2'}
        self.assertEqual(_format_effect_magnitude(effect, 19), '1.9')
        self.assertEqual(_format_effect_magnitude(effect, 20), '2')
        self.assertEqual(_format_effect_magnitude(effect, 0), '0')

    def test_aiming_speed_codec_is_percentage_even_with_integer_cap(self):
        self.assertEqual(_format_effect_magnitude({'id': '164A', 'CAP': '1'}, 1000), '100%')
        self.assertEqual(_format_effect_magnitude({'id': '164A', 'CAP': '1'}, 750), '75%')

    def test_sentience_charge_is_percent_not_integer(self):
        self.assertEqual(_format_effect_magnitude({'id': '9158', 'CAP': '1'}, 896), '89.6%')
        self.assertEqual(_format_effect_magnitude({'id': 'unknown', 'CAP': '1'}, 896), '896')

    def test_unrelated_integer_caps_and_unknown_grades_are_unchanged(self):
        self.assertEqual(_format_effect_magnitude({'id': 'FE22', 'CAP': '10'}, 10), '10')
        self.assertEqual(_format_effect_magnitude({'id': '9A06', 'CAP': '-1'}, 1), '-1')
        self.assertIsNone(_format_effect_magnitude({'id': 'C0C9', 'CAP': 'AA-'}, 12))
        self.assertIsNone(_format_effect_magnitude({'id': 'E9DA', 'CAP': '(Passive)'}, 0))

    def test_real_catalog_uses_the_verified_units(self):
        catalog = json.loads((Path(__file__).parents[1] / 'data/effects.json').read_text(encoding='utf-8'))
        entries = {e['id']: e for e in catalog}
        self.assertEqual(_format_effect_magnitude(entries['91A6'], 19), '1.9')
        self.assertEqual(_format_effect_magnitude(entries['164A'], 1000), '100%')
        self.assertEqual(_format_effect_magnitude(entries['9158'], 896), '89.6%')

    def test_direct_match_and_mismatch_are_distinct(self):
        observed = self.observations([self.row('等级', '689'), self.row('精华', '1,234'), self.row('体', '150')])
        snapshot = {'character': {'level': 689, 'amrita': 1235, 'attributes': {'constitution': 150}}}
        report = analyze(observed, snapshot, b'')
        self.assertEqual(report['coverage'], {'direct-match': 2, 'direct-mismatch': 1})
        self.assertFalse(report['complete'])

    def test_matching_bytes_are_never_promoted_to_a_field(self):
        data = struct.pack('<I', 9841) + bytes(12)
        report = analyze(self.observations([self.row('体力', '9841 / 9841')]), {'character': {}}, data)
        row = report['rows'][0]
        self.assertEqual(row['status'], 'unverified-final-value')
        self.assertIsNone(row['finalValue'])
        match = next(c for c in row['byteCandidates'] if c['encoding'] == 'uint32-le')
        self.assertEqual(match['candidateOffsets'], ['0x0'])
        self.assertFalse(match['verified'])

    def test_scan_bounds_examples_and_retains_total(self):
        candidates = byte_candidates(struct.pack('<I', 529) * 20, '529')
        match = next(c for c in candidates if c['encoding'] == 'uint32-le')
        self.assertEqual((match['matchCount'], match['alignedCount']), (20, 20))
        self.assertEqual(len(match['candidateOffsets']), 8)
        self.assertEqual(byte_candidates(bytes(500), '0.0'), [])

    def test_weapon_and_scroll_candidates_are_not_summed(self):
        data = bytearray(SCROLL_START + SCROLL_SIZE)
        records = []
        for index, slot in enumerate(['melee1', 'melee2']):
            struct.pack_into('<II', data, EQUIPMENT_START + index * EQUIPMENT_SIZE + 48, 0xDF8F, 100)
            records.append({'recordIndex': index, 'slot': slot, 'name': slot,
                            'effectsZh': ['武技伤害'], 'effectMagnitudes': ['10%']})
        struct.pack_into('<II', data, SCROLL_START + 48, 0xDF8F, 100)
        snapshot = {'character': {}, 'currentLoadout': records,
                    'scrolls': [{'recordIndex': 0, 'name': 'Scroll', 'effectsZh': ['武技伤害'], 'effectMagnitudes': ['10%']}]}
        report = analyze(self.observations(effects=[self.row('武技伤害', '+30%')]), snapshot, bytes(data))
        row = report['rows'][0]
        self.assertEqual(len(row['sourceCandidates']), 3)
        self.assertIsNone(row['finalValue'])
        self.assertEqual(row['status'], 'source-candidates-only')
        self.assertEqual(row['sourceCandidates'][2]['activeState'], 'unknown-scroll-selection')
        self.assertEqual(report['sourceValueEncodings'], {'not-decoded': 3})

    def test_source_encoding_is_distinct_from_final_verification(self):
        data = bytearray(SCROLL_START + SCROLL_SIZE)
        struct.pack_into('<II', data, SCROLL_START + 48, 0x9158, 896)
        item = {'recordIndex': 0, 'name': 'Scroll', 'effectsZh': ['妖念量表增加量'],
                'effectIds': ['9158'], 'effectMagnitudes': ['89.6%'],
                'effectValueDetails': [{'rawValue': 896, 'kind': 'numeric', 'encoding': 'verified-id'}]}
        observed = self.observations(effects=[self.row('妖念量表增加量', '+119.4%')])
        report = analyze(observed, {'character': {}, 'scrolls': [item]}, bytes(data))
        self.assertEqual(report['sourceValueEncodings'], {'verified-id': 1})
        self.assertIsNone(report['rows'][0]['finalValue'])
        self.assertFalse(report['complete'])
        self.assertIn('来源编码已验证', markdown(report))
        item['effectValueDetails'][0]['rawValue'] = 999
        report = analyze(observed, {'character': {}, 'scrolls': [item]}, bytes(data))
        self.assertEqual(report['sourceValueEncodings'], {'not-decoded': 1})

    def test_flat_and_percentage_observations_are_not_deduplicated(self):
        report = analyze(self.observations(effects=[self.row('体力', '+964'), self.row('体力', '+30.0%')]), {'character': {}}, b'')
        self.assertEqual(report['rowCount'], 2)
        self.assertTrue(all(r['finalValue'] is None for r in report['rows']))

    def test_detached_core_stays_unverified_even_when_value_matches(self):
        data = bytearray(EQUIPMENT_SIZE)
        data[0:2] = bytes.fromhex('72D2')
        struct.pack_into('<II', data, 48, 0xE5E7, 315)
        catalog = Path(__file__).parents[1] / 'data'
        records = core_candidates(bytes(data), [0], catalog)
        report = analyze(self.observations(effects=[self.row('对火敌人的妖怪技伤害', '+31.5%')]),
                         {'character': {}, 'candidateCoreRecords': records}, bytes(data))
        row = report['rows'][0]
        self.assertEqual(row['sourceCandidates'][0]['activeState'], 'unverified-detached-core')
        self.assertEqual(row['sourceCandidates'][0]['displayedValue'], '31.5%')
        self.assertIsNone(row['finalValue'])

    def test_core_candidates_reject_duplicates_bounds_and_non_core(self):
        catalog = Path(__file__).parents[1] / 'data'
        for offsets in ([0, 0], [-1], [500], [0]):
            with self.assertRaises(ValueError):
                core_candidates(bytes(EQUIPMENT_SIZE), offsets, catalog)

    def test_no_private_path_or_identity_is_copied(self):
        report = analyze(self.observations([self.row('等级', '1')]),
                         {'character': {'level': 1}, 'safety': {'originalMainSaveSha256': 'SECRET'},
                          'path': 'private-directory', 'steamId': 'private-id'}, b'')
        serialized = json.dumps(report)
        for value in ('SECRET', 'private-directory', 'private-id'):
            self.assertNotIn(value, serialized)
        self.assertIn('不是已完成', markdown(report))

    def test_normalization_keeps_conditions_distinct(self):
        self.assertEqual(normalized_label('抗常世 · 常暗'), normalized_label('抗常世·常暗'))
        self.assertNotEqual(normalized_label('近距离攻击伤害'), normalized_label('近距离攻击伤害（无伤）'))

    def test_rejects_unlabelled_observation(self):
        with self.assertRaises(ValueError):
            analyze({'source': 'automatic'}, {}, b'')


if __name__ == '__main__':
    unittest.main()
