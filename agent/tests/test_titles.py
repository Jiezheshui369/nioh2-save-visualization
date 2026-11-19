import struct
import unittest

from agent.titles import derive_titles, CATALOG, NEXT, KEYS, FLAGS, HEAD, TAIL, COUNT


def container(ids=(), notification=0):
    data = bytearray(2715432)
    data[:8] = b'NIOHUSR\0'
    for offset, value in [(8, 0x21030200), (0x14, 0x148), (0x18, 0x296de0), (0x150, 0x21030200)]:
        struct.pack_into('<I', data, offset, value)
    struct.pack_into('<1024I', data, NEXT, *([0xFFFFFFFF]*1024))
    used = []
    for key in ids:
        slot = key & 1023
        while slot in used:
            slot = (slot+1) & 1023
        used.append(slot)
        struct.pack_into('<I', data, KEYS+slot*4, key)
        data[FLAGS+slot] = notification
    for index, slot in enumerate(used):
        struct.pack_into('<I', data, NEXT+slot*4, used[index+1] if index+1 < len(used) else 1024)
    struct.pack_into('<III', data, HEAD, used[0] if used else 1024, used[-1] if used else 1024, len(used))
    return data


class TitlesTests(unittest.TestCase):
    def test_empty_saved_set_is_known_absence(self):
        result = derive_titles(bytes(container()))
        self.assertEqual(result['state'], 'verified-saved-set')
        self.assertEqual(len(result['entries']), 390)
        self.assertEqual(result['summary']['awarded'], 0)
        self.assertEqual(result['summary']['notAwarded'], 390)
        self.assertTrue(all(e['savedAwarded'] is False for e in result['entries']))

    def test_zero_notification_is_still_awarded_and_input_is_not_modified(self):
        key = CATALOG['definitions'][0]['titleId']; data = bytes(container([key]))
        before = bytes(data); result = derive_titles(data)
        self.assertEqual(data, before)
        self.assertTrue(next(e for e in result['entries'] if e['titleId'] == key)['savedAwarded'])
        self.assertEqual(result['summary']['awarded'], 1)
        self.assertTrue(all(v is None for v in result['current'].values()))
        self.assertEqual(derive_titles(bytes(container()))['summary']['awarded'], 0)

    def test_corrupt_link_count_key_probe_and_notification_become_unknown(self):
        key = CATALOG['definitions'][0]['titleId']; slot = key & 1023
        cases = [(NEXT+slot*4, slot), (COUNT, 2), (TAIL, (slot+1)&1023), (KEYS+slot*4, 0)]
        for offset, value in cases:
            data = container([key]); struct.pack_into('<I', data, offset, value)
            with self.subTest(offset=offset): self.assert_unknown(data)
        data = container([key]); data[FLAGS+slot] = 2; self.assert_unknown(data)
        data = container(); struct.pack_into('<I', data, NEXT+5*4, 1024)
        struct.pack_into('<I', data, KEYS+5*4, key); struct.pack_into('<III', data, HEAD, 5, 5, 1)
        self.assert_unknown(data)

    def test_unknown_layout_is_not_all_unearned(self):
        for data in [bytes(2715432), bytes(container())[:-1]]:
            self.assert_unknown(data)

    def test_orphan_and_duplicate_ids_become_unknown(self):
        key = CATALOG['definitions'][0]['titleId']; slot = key & 1023
        data = container([key]); second = (slot+1)&1023
        struct.pack_into('<I', data, NEXT+second*4, 1024)
        struct.pack_into('<I', data, KEYS+second*4, key)
        struct.pack_into('<I', data, COUNT, 2)
        self.assert_unknown(data)
        struct.pack_into('<I', data, NEXT+slot*4, second)
        struct.pack_into('<I', data, TAIL, second)
        self.assert_unknown(data)

    def assert_unknown(self, data):
        result = derive_titles(bytes(data))
        self.assertEqual(result['state'], 'unknown')
        self.assertEqual(result['summary']['unknown'], 390)
        self.assertIsNone(result['summary']['awarded'])
        self.assertTrue(all(e['savedAwarded'] is None for e in result['entries']))


if __name__ == '__main__': unittest.main()
