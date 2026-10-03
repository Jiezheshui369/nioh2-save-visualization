import struct
import unittest

from agent.tools.scan_display_precision import scan, targets_from_audit


def audit(label='体力', observed='1234'):
    return {'rows': [dict(section='panel', status='unverified-final-value', label=label, observed=observed)]}


class DisplayPrecisionTests(unittest.TestCase):
    def test_maximum_selection_and_weight_components(self):
        self.assertEqual([t['display'] for t in targets_from_audit(audit('妖力', '0.0 / 17.8'))], ['17.8'])
        self.assertEqual([t['display'] for t in targets_from_audit(audit('装备重量', '38.0 / 57.4'))], ['38.0', '57.4'])
        self.assertEqual(targets_from_audit(audit('敏捷', 'B')), [])
        self.assertEqual(targets_from_audit(audit('抗净', '0.0')), [])

    def test_nearest_and_truncation_separate_not_final_values(self):
        data = struct.pack('<ddd', 1234.25, 1234.75, 1233.6)
        report = scan(data, audit())
        found = next(r for r in report['results'] if r['encoding'] == 'float64-le')
        self.assertEqual(found['matchCount'], 3)
        self.assertEqual(found['nearestCount'], 2)
        self.assertEqual(found['truncationCount'], 2)
        self.assertFalse(found['verified'])
        self.assertEqual(report['newVerifiedFields'], 0)
        self.assertFalse(report['complete'])

    def test_nonfinite_excluded_and_unaligned_included(self):
        data = b'x' + struct.pack('>fff', 17.83, float('nan'), float('inf'))
        found = next(r for r in scan(data, audit('妖力', '17.8'))['results'] if r['encoding'] == 'float32-be')
        self.assertEqual(found['matchCount'], 1)
        self.assertEqual(found['alignedCount'], 0)
        self.assertEqual(found['candidates'][0]['offset'], '0x1')

    def test_decimal_precision_not_broad_integer_interval(self):
        found = next(r for r in scan(struct.pack('<dd', 24.04, 24.4), audit('抗雷', '24.0'))['results']
                     if r['encoding'] == 'float64-le')
        self.assertEqual(found['matchCount'], 1)

    def test_signed_truncation_and_boundaries_conservative(self):
        data = struct.pack('<ddd', -5.45, -5.49, -5.31)
        found = next(r for r in scan(data, audit('降低', '−5.4%'))['results'] if r['encoding'] == 'float64-le')
        self.assertEqual(found['matchCount'], 2)
        self.assertEqual(found['truncationCount'], 2)

    def test_examples_bounded_counts_complete(self):
        found = next(r for r in scan(struct.pack('<d', 1234.125) * 20, audit(), examples=2)['results']
                     if r['encoding'] == 'float64-le')
        self.assertEqual(found['matchCount'], 20)
        self.assertEqual(len(found['candidates']), 2)
        self.assertTrue(found['examplesTruncated'])

    def test_invalid_inputs_and_no_targets(self):
        self.assertEqual(scan(b'', audit())['results'][0]['matchCount'], 0)
        self.assertEqual(scan(b'abcd', audit('敏捷', 'B'))['results'], [])
        for kwargs in [dict(examples=0), dict(examples=65), dict(examples=True)]:
            with self.assertRaises(ValueError):
                scan(b'', audit(), **kwargs)
        with self.assertRaises(ValueError):
            scan(bytearray(), audit())
        with self.assertRaises(ValueError):
            targets_from_audit({'rows': 'bad'})

    def test_does_not_scan_direct_or_special_effect_rows(self):
        evidence = audit()
        evidence['rows'][0]['status'] = 'direct-match'
        self.assertEqual(targets_from_audit(evidence), [])
        evidence = audit()
        evidence['rows'][0]['section'] = 'special-effect'
        self.assertEqual(targets_from_audit(evidence), [])


if __name__ == '__main__':
    unittest.main()
