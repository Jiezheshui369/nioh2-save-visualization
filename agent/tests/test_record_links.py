import struct
import unittest

from agent.tools.trace_equipment_links import occurrences, trace_record, trace_index, guardian_table_candidates


class RecordLinkTests(unittest.TestCase):
    def guardian_fixture(self):
        data = bytearray(144 * 4 + 464 * 2 + 8)
        table = 144 * 4
        for index in range(4):
            data[index * 144:index * 144 + 132] = bytes([index + 1]) * 132
        for row in range(2):
            at = table + row * 464
            struct.pack_into('<II', data, at, 50 + row, 1)
            struct.pack_into('<III', data, at + 448, 4, 4, 4)
            for slot in range(3):
                # Empty game records still carry defaults / empty effect IDs.
                struct.pack_into('<I', data, at + 8 + slot * 144 + 48, 0xFFFFFFFF)
        for slot, inventory in enumerate([2, 0, 3]):
            at = table + 8 + slot * 144
            data[at:at + 132] = data[inventory * 144:inventory * 144 + 132]
            struct.pack_into('<I', data, table + 448 + slot * 4, inventory)
        struct.pack_into('<II', data, len(data) - 8, 50, 51)
        return data, table

    def test_table_agreement_is_only_candidate_evidence(self):
        data, table = self.guardian_fixture()
        report = guardian_table_candidates(bytes(data), table, 2, [len(data) - 8, len(data) - 4],
                                           inventory_offset=0, inventory_slots=4)
        self.assertEqual(report['linkCounts'], {'matching-body': 3, 'empty-sentinel': 3})
        self.assertTrue(report['nonzeroIdsUnique'])
        self.assertTrue(all(row['paddingZero'] for row in report['rows']))
        self.assertFalse(report['selectionVerified'])
        self.assertEqual([s['matchingRowIndices'] for s in report['selectors']], [[0], [1]])
        self.assertTrue(all(s['role'] == 'unverified' for s in report['selectors']))

    def test_bad_references_and_duplicate_ids_are_not_hidden(self):
        data, table = self.guardian_fixture()
        struct.pack_into('<III', data, table + 448, 5, 4, 1)
        struct.pack_into('<I', data, table + 464, 50)
        report = guardian_table_candidates(bytes(data), table, 2, [len(data) - 8],
                                           inventory_offset=0, inventory_slots=4)
        self.assertEqual([link['status'] for link in report['rows'][0]['links']],
                         ['out-of-range-reference', 'sentinel-with-nonempty-copy', 'different-body'])
        self.assertFalse(report['nonzeroIdsUnique'])
        self.assertFalse(report['selectors'][0]['uniqueRowMatch'])

    def test_table_bounds_and_empty_inventory_checked(self):
        data, table = self.guardian_fixture()
        for at, count, selectors in [(-1, 2, []), (table, 129, []), (table + 1, 3, []),
                                     (table, 2, [-1]), (table, 2, [0, 0])]:
            with self.assertRaises(ValueError):
                guardian_table_candidates(bytes(data), at, count, selectors, inventory_offset=0, inventory_slots=4)
        data[288:420] = bytes(132)
        data[table + 8 + 144:table + 8 + 144 + 132] = bytes(132)
        report = guardian_table_candidates(bytes(data), table, 2, [], inventory_offset=0, inventory_slots=4)
        self.assertEqual(report['rows'][0]['links'][0]['status'], 'reference-to-empty-inventory')
        self.assertEqual(report['rows'][0]['links'][1]['status'], 'empty-copy-with-reference')

    def test_bounded_overlapping_matches(self):
        found = occurrences(b'aaaaaa', b'aaa', 2)
        self.assertEqual(found, {'count': 4, 'offsets': [0, 1], 'truncated': True})
        for pattern in (b'', bytes(8)):
            with self.assertRaises(ValueError):
                occurrences(b'anything', pattern)

    def test_detached_copy_is_never_promoted_to_equipped(self):
        record = bytearray(144)
        record[:4] = bytes.fromhex('72d272d2')
        record[36:44] = bytes.fromhex('0102030405060708')
        struct.pack_into('<II', record, 48, 0x1234, 150)
        data = bytes(record) + bytes(40) + bytes(record)
        report = trace_record(data, 0, 144)
        self.assertFalse(report['selectionVerified'])
        for trace in report['traces']:
            self.assertEqual(trace['count'], 2)
            self.assertTrue(all(m['sameBody'] for m in trace['matches']))
            self.assertTrue(all(m['verified'] is False for m in trace['matches']))
        self.assertEqual(record[36:44], bytes.fromhex('0102030405060708'))

    def test_pattern_match_without_matching_item_id_is_not_a_record_copy(self):
        record = bytearray(136)
        record[:2] = b'\x01\x02'
        record[36:44] = b'abcdefgh'
        other = bytearray(record)
        other[:2] = b'\x03\x04'
        report = trace_record(bytes(record + other), 0, 136)
        self.assertTrue(report['traces'][0]['matches'][0]['sameItemId'])
        self.assertFalse(report['traces'][0]['matches'][1]['sameItemId'])
        self.assertEqual(report['traces'][1]['status'], 'empty-pattern')

    def test_index_matches_remain_unverified_and_zero_is_skipped(self):
        result = trace_index(struct.pack('<IIII', 0, 1, 40, 39), 39, 248)
        self.assertFalse(result['selectionVerified'])
        self.assertTrue(all(row['verified'] is False for row in result['searches']))
        self.assertEqual(trace_index(b'\0' * 100, 0, 248)['searches'][0]['status'], 'zero-too-ambiguous')
        with self.assertRaises(ValueError):
            trace_index(b'', 248, 248)

    def test_truncated_or_empty_record_rejected(self):
        for data, base, size in [(b'\x01', 0, 144), (bytes(144), 0, 144), (bytes(200), -1, 136), (bytes(200), 0, 16)]:
            with self.assertRaises(ValueError):
                trace_record(data, base, size)
