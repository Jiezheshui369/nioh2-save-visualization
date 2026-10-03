import struct
import unittest

from agent.tools.inspect_datatable_ids import blocks, inspect, sequence_candidates, ordered_ids, permutation_candidates


class DataTableResearchTests(unittest.TestCase):
    def test_permutation_search_finds_an_order_not_in_the_three_ordered_hypotheses(self):
        ids = [51, 52, 53, 54]
        data = bytearray(68)
        for index, value in enumerate([52, 54, 51, 53]):
            struct.pack_into('<I', data, 4 + index * 16, value)
        for order in ('record', 'ascending', 'descending'):
            self.assertEqual(sequence_candidates(data, ordered_ids(ids, order))['completeSequenceCount'], 0)
        result = permutation_candidates(data, ids)
        self.assertEqual(result['candidates'], [{'offset': 4, 'stride': 16, 'width': 4, 'matchedIds': 4, 'verified': False}])
        self.assertFalse(result['probeSearchTruncated'])
        self.assertFalse(result['semanticsVerified'])

    def test_permutation_candidates_do_not_cross_blocks_or_accept_duplicates(self):
        data = struct.pack('<IIIII', 2, 20, 8, 28, 4) + struct.pack('<III', 53, 51, 52)
        report = inspect(data, [51, 52, 53], 'permutation')
        self.assertEqual(sum(s['completeSequenceCount'] for b in report['blocks'] for s in b['searches']), 0)
        self.assertEqual(permutation_candidates(struct.pack('<III', 51, 51, 52), [51, 52, 53])['completeSequenceCount'], 0)

    def test_permutation_search_counts_overlapping_windows_but_bounds_output_and_work(self):
        data = struct.pack('<IIIII', 53, 51, 52, 53, 51)
        result = permutation_candidates(data, [51, 52, 53], maximum_results=1)
        # Three width-4 windows plus one width-8 stride window.
        self.assertEqual(result['completeSequenceCount'], 4)
        self.assertTrue(result['resultsTruncated'])
        self.assertEqual(len(result['candidates']), 1)
        bounded = permutation_candidates(data, [51, 52, 53], maximum_probes=1)
        self.assertTrue(bounded['probeSearchTruncated'])
        self.assertEqual(bounded['probes'], 1)

    def test_permutation_hypothesis_matches_brute_force_for_small_blobs(self):
        import random
        rng = random.Random(714)
        for width, fmt in ((2, '<H'), (4, '<I')):
            for _ in range(30):
                data = b''.join(struct.pack(fmt, rng.choice([0, 1, 2, 3])) for _ in range(18))
                brute = []
                for stride in range(width, 17, width):
                    for start in range(0, len(data) - 2 * stride - width + 1, width):
                        if {struct.unpack_from(fmt, data, start + i * stride)[0] for i in range(3)} == {1, 2, 3}:
                            brute.append((start, stride))
                result = permutation_candidates(data, [1, 2, 3], width=width, maximum_stride=16, maximum_results=64)
                self.assertEqual(sorted((c['offset'], c['stride']) for c in result['candidates']), sorted(brute))
                self.assertEqual(result['completeSequenceCount'], len(brute))

    def test_explicit_order_hypotheses_do_not_change_evidence_or_promote_meaning(self):
        ids = [53, 51, 52]
        data = struct.pack('<III', 1, 12, 12) + struct.pack('<III', 51, 52, 53)
        self.assertEqual(ordered_ids(ids, 'descending'), [53, 52, 51])
        self.assertEqual(ids, [53, 51, 52])
        original, ascending = inspect(data, ids), inspect(data, ids, 'ascending')
        count = lambda report: sum(s['completeSequenceCount'] for b in report['blocks'] for s in b['searches'])
        self.assertEqual(count(original), 0)
        self.assertGreater(count(ascending), 0)
        self.assertEqual(ascending['idOrder'], 'ascending')
        self.assertFalse(ascending['semanticsVerified'])
        with self.assertRaises(ValueError):
            ordered_ids(ids, 'guess')

    def test_container_offsets_are_explicit_and_truncation_is_rejected(self):
        data = struct.pack('<IIIII', 2, 20, 4, 24, 0) + b'abcd'
        self.assertEqual(blocks(data), [(20, 4), (24, 0)])
        for invalid in (b'', struct.pack('<I', 4097), data[:-1], struct.pack('<III', 1, 4, 4)):
            with self.assertRaises(ValueError):
                blocks(invalid)

    def test_ordered_sequence_matches_only_in_bounds_without_promoting_semantics(self):
        ids = [57, 32, 98, 21]
        data = bytearray(64)
        for index, value in enumerate(ids):
            struct.pack_into('<I', data, 4 + index * 16, value)
        result = sequence_candidates(bytes(data), ids)
        self.assertEqual(result['candidates'], [{'offset': 4, 'stride': 16, 'width': 4, 'matchedIds': 4, 'verified': False}])
        self.assertFalse(result['semanticsVerified'])
        self.assertEqual(sequence_candidates(bytes(data[:-16]), ids)['completeSequenceCount'], 0)
        self.assertEqual(sequence_candidates(bytes(data), [57, 98, 32, 21])['completeSequenceCount'], 0)

    def test_a_number_hit_is_not_a_sequence_and_search_width_is_explicit(self):
        data = struct.pack('<HHHH', 51, 52, 53, 0)
        self.assertEqual(sequence_candidates(data, [51, 52, 53], width=2)['completeSequenceCount'], 1)
        self.assertEqual(sequence_candidates(data, [51, 52, 53], width=4)['completeSequenceCount'], 0)
        self.assertEqual(sequence_candidates(struct.pack('<III', 51, 52, 9), [51, 52, 53])['distinctIdHits'], 2)

    def test_individual_blocks_are_searched_without_cross_block_matches(self):
        data = struct.pack('<IIIII', 2, 20, 8, 28, 4) + struct.pack('<III', 51, 52, 53)
        result = inspect(data, [51, 52, 53])
        self.assertFalse(result['semanticsVerified'])
        self.assertEqual(sum(s['completeSequenceCount'] for b in result['blocks'] for s in b['searches']), 0)

    def test_bounds_and_duplicate_ids_are_rejected(self):
        for ids in ([1, 2], [1, 2, 2], [0, 1, 2], [True, 2, 3], [-1, 2, 3], [1, 2, 2**32]):
            with self.assertRaises(ValueError):
                sequence_candidates(b'', ids)
        for options in ({'width': 1}, {'maximum_stride': 4097}, {'maximum_results': 65}):
            with self.assertRaises(ValueError):
                sequence_candidates(b'', [1, 2, 3], **options)


if __name__ == '__main__':
    unittest.main()
