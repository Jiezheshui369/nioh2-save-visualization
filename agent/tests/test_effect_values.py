import struct
import unittest

from agent.parser import EFFECT_VALUE_RULES, _effect_names, _effect_value_details, _format_effect_magnitude


class EffectValueTests(unittest.TestCase):
    def test_shared_rule_registry_is_unambiguous_and_catalog_backed(self):
        import json
        from pathlib import Path
        catalog = {row['id'].upper() for row in json.loads(
            (Path(__file__).parents[1] / 'data/effects.json').read_text(encoding='utf-8'))}
        groups = [EFFECT_VALUE_RULES[key] for key in
                  ('conditionIds', 'unverifiedUnitIds', 'verifiedDecimalIds', 'verifiedPercentIds')]
        groups.append(list(EFFECT_VALUE_RULES['verifiedGradeValues']))
        seen = set()
        for values in groups:
            self.assertEqual(len(values), len(set(values)))
            self.assertFalse(seen.intersection(values))
            for key in values:
                self.assertRegex(key, r'^[0-9A-F]{4}$')
                self.assertIn(key, catalog)
                self.assertNotIn(key, ('0000', 'FFFF'))
            seen.update(values)
        self.assertTrue(set(EFFECT_VALUE_RULES['verifiedAnimaIds']).issubset(EFFECT_VALUE_RULES['verifiedDecimalIds']))
        for values in EFFECT_VALUE_RULES['verifiedGradeValues'].values():
            self.assertTrue(values)
            for raw, grade in values.items():
                self.assertEqual(str(int(raw)), raw)
                self.assertTrue(0 <= int(raw) <= 0xFFFFFFFF)
                self.assertRegex(grade, r'^(?:AAA|AA|A|B|C|D)[+-]?$')

    def test_all_ultimate_ids_suppress_conditional_raw_values(self):
        for key in EFFECT_VALUE_RULES['conditionIds']:
            self.assertIsNone(_format_effect_magnitude({'id': key, 'CAP': '150'}, 150))
            self.assertIsNone(_format_effect_magnitude({'id': key, 'CAP': '150'}, 999))

    def test_anima_units_are_not_guessed_from_cap(self):
        for key in EFFECT_VALUE_RULES['unverifiedUnitIds']:
            self.assertIsNone(_format_effect_magnitude({'id': key, 'CAP': '0.9'}, 9))

    def test_three_screenshot_correlated_anima_ids_are_decimal_not_percent(self):
        for key, raw, expected in [('B4D8', 21, '2.1'), ('5B76', 16, '1.6'), ('5CFF', 15, '1.5')]:
            with self.subTest(key=key):
                effect = {'id': key, 'CAP': '0.9', 'Effect': 'Anima'}
                self.assertEqual(_format_effect_magnitude(effect, raw), expected)
                data = bytearray(0x90)
                struct.pack_into('<II', data, 48, int(key, 16), raw)
                details = _effect_value_details(bytes(data), 0, {key: effect})
                self.assertEqual(details, [dict(rawValue=raw, kind='numeric', encoding='verified-id')])

    def test_anima_rules_do_not_cap_modified_saves_or_promote_other_ids(self):
        for key in EFFECT_VALUE_RULES['verifiedAnimaIds']:
            self.assertEqual(_format_effect_magnitude({'id': key, 'CAP': '1'}, 0), '0')
            self.assertEqual(_format_effect_magnitude({'id': key, 'CAP': '1'}, 12345), '1234.5')
            self.assertIn(key, EFFECT_VALUE_RULES['verifiedDecimalIds'])
            self.assertNotIn(key, EFFECT_VALUE_RULES['unverifiedUnitIds'])
        self.assertEqual(set(EFFECT_VALUE_RULES['unverifiedUnitIds']), {'523B', 'D83E', '2317'})

    def test_screenshot_correlated_core_percentages_ignore_catalog_cap(self):
        cases = [('E5E7', 315, '31.5%'), ('823B', 58, '5.8%'),
                 ('9D39', 298, '29.8%'), ('9BF2', 33, '3.3%'),
                 ('8D1A', 31, '3.1%'), ('AD6B', 59, '5.9%')]
        for key, raw, expected in cases:
            with self.subTest(key=key):
                effect = {'id': key, 'CAP': '999', 'Effect': 'synthetic label'}
                self.assertEqual(_format_effect_magnitude(effect, raw), expected)
                data = bytearray(0x90)
                struct.pack_into('<II', data, 48, int(key, 16), raw)
                self.assertEqual(_effect_value_details(bytes(data), 0, {key: effect}),
                                 [dict(rawValue=raw, kind='numeric', encoding='verified-id')])

    def test_verified_tenths_keep_uint32_precision_and_zero(self):
        for key in EFFECT_VALUE_RULES['verifiedDecimalIds'] + EFFECT_VALUE_RULES['verifiedPercentIds']:
            suffix = '%' if key in EFFECT_VALUE_RULES['verifiedPercentIds'] else ''
            for raw, text in [(0, '0'), (10, '1'), (0xFFFFFFFF, '429496729.5'), (1234567890, '123456789')]:
                self.assertEqual(_format_effect_magnitude({'id': key, 'CAP': '1'}, raw), text + suffix)

    def test_id_specific_metadata_cannot_disagree_with_value_due_to_cap(self):
        data = bytearray(0x90)
        for key in EFFECT_VALUE_RULES['verifiedDecimalIds'] + EFFECT_VALUE_RULES['verifiedPercentIds']:
            struct.pack_into('<II', data, 48, int(key, 16), 10)
            for cap in ['AA', '(Passive)', '', '-100']:
                effect = {'id': key, 'CAP': cap}
                self.assertIsNotNone(_format_effect_magnitude(effect, 10))
                self.assertEqual(_effect_value_details(bytes(data), 0, {key: effect}),
                                 [dict(rawValue=10, kind='numeric', encoding='verified-id')])

    def test_grade_evidence_is_scoped_to_both_id_and_raw_value(self):
        for key, raw, grade in [('3961', 13, 'AA'), ('9AD2', 13, 'AA'), ('24E8', 8, 'B+')]:
            with self.subTest(key=key):
                # A contradictory maximum must not override the actual observed grade.
                effect = {'id': key, 'CAP': 'AAA+', 'Effect': 'synthetic label'}
                self.assertEqual(_format_effect_magnitude(effect, raw), grade)
                data = bytearray(0x90)
                struct.pack_into('<II', data, 48, int(key, 16), raw)
                self.assertEqual(_effect_value_details(bytes(data), 0, {key: effect}),
                                 [dict(rawValue=raw, kind='grade', encoding='verified-id')])
                for unknown in [0, raw - 1, raw + 1, 0xFFFFFFFF]:
                    self.assertIsNone(_format_effect_magnitude({**effect, 'CAP': '150'}, unknown))
                    struct.pack_into('<I', data, 52, unknown)
                    self.assertEqual(_effect_value_details(bytes(data), 0, {key: effect}),
                                     [dict(rawValue=unknown, kind='unresolved-grade', encoding='not-decoded')])
        self.assertIsNone(_format_effect_magnitude({'id': 'C0C9', 'CAP': 'AA'}, 13))

    def test_grade_and_numeric_entries_stay_aligned_across_empty_slots(self):
        data = bytearray(0x90)
        catalog = {key: {'id': key, 'CAP': cap, 'Effect': key}
                   for key, cap in [('3961', 'AAA+'), ('24E8', 'A'), ('9BF2', '0.99')]}
        for slot, key, raw in [(0, '3961', 13), (2, '24E8', 7), (5, '9BF2', 33)]:
            struct.pack_into('<II', data, 48 + slot * 12, int(key, 16), raw)
        names, _, ids, values = _effect_names(bytes(data), 0, catalog, {})
        details = _effect_value_details(bytes(data), 0, catalog)
        self.assertEqual(names, ids)
        self.assertEqual(ids, ['3961', '24E8', '9BF2'])
        self.assertEqual(values, ['AA', None, '3.3%'])
        self.assertEqual([d['kind'] for d in details], ['grade', 'unresolved-grade', 'numeric'])

    def test_parallel_metadata_preserves_raw_and_skips_empty_slots(self):
        data = bytearray(0x90)
        entries = [('DAC2', '150', 150), ('FFFF', '', 0), ('91A6', '2', 19),
                   ('C0C9', 'AA-', 12), ('E9DA', '(Passive)', 0), ('FF01', '0.12', 119), ('FF02', '', 0xFFFFFFFF)]
        catalog = {}
        for i, (key, cap, raw) in enumerate(entries):
            struct.pack_into('<II', data, 48 + i * 12, int(key, 16), raw)
            if key != 'FF02':
                catalog[key] = {'id': key, 'CAP': cap, 'Effect': key}
        original = bytes(data)
        names, zh, ids, magnitudes = _effect_names(original, 0, catalog, {})
        details = _effect_value_details(original, 0, catalog)
        self.assertEqual(len(details), len(names))
        self.assertEqual(ids, ['DAC2', '91A6', 'C0C9', 'E9DA', 'FF01', 'FF02'])
        self.assertEqual(magnitudes, [None, '1.9', None, None, '11.9%', None])
        self.assertEqual([d['kind'] for d in details], ['condition', 'numeric', 'unresolved-grade', 'non-numeric', 'numeric', 'unknown'])
        self.assertEqual([d['encoding'] for d in details], ['not-decoded', 'verified-id', 'not-decoded', 'not-decoded', 'legacy-cap', 'not-decoded'])
        self.assertEqual([d['rawValue'] for d in details], [150, 19, 12, 0, 119, 0xFFFFFFFF])
        self.assertEqual(bytes(data), original)

    def test_unknown_cap_150_is_not_misclassified_as_ultimate(self):
        self.assertEqual(_format_effect_magnitude({'id': 'FF01', 'CAP': '150'}, 42), '42')


if __name__ == '__main__':
    unittest.main()
