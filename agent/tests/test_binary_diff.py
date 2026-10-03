import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from agent.binary_diff import (MAX_COPY_BYTES, build_report, changed_ranges, change_summary,
                               iter_changed_spans, read_copy, validate_paths, write_new_report)


class BinaryDiffTests(unittest.TestCase):
    def test_streaming_spans_match_reference_for_unequal_lengths(self):
        rng = random.Random(276)
        for _ in range(200):
            before = bytes(rng.randrange(3) for _ in range(rng.randrange(90)))
            after = bytes(rng.randrange(3) for _ in range(rng.randrange(90)))
            gap = rng.randrange(5)
            changed = [i for i in range(max(len(before), len(after))) if before[i:i + 1] != after[i:i + 1]]
            expected = []
            for index in changed:
                if not expected or index - expected[-1][1] > gap:
                    expected.append([index, index + 1, 1])
                else:
                    expected[-1][1] = index + 1
                    expected[-1][2] += 1
            self.assertEqual(list(iter_changed_spans(before, after, gap)), [tuple(s) for s in expected])
            self.assertEqual(change_summary(before, after, gap),
                             {'changedBytes': len(changed), 'changedRanges': len(expected)})

    def test_gap_validation_and_addition_deletion(self):
        for gap in (-1, 65537, True, 1.5):
            with self.assertRaises(ValueError):
                change_summary(b'a', b'b', gap)
        self.assertEqual(changed_ranges(b'', b'abc')[0]['beforeHex'], '')
        self.assertEqual(changed_ranges(b'abc', b'')[0]['afterHex'], '')
        self.assertEqual(change_summary(b'abc', b'abc'), {'changedBytes': 0, 'changedRanges': 0})

    def test_bounded_private_report_and_exclusive_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            copies = root / 'copies'
            copies.mkdir()
            before, after = copies / 'a.bin', copies / 'b.bin'
            before.write_bytes(bytes(20))
            after.write_bytes(b'\1\1\1\1\0' * 4)
            target = root / 'reports' / 'diff.json'
            left, right, output = validate_paths(copies, before, after, target)
            report = build_report(left, right, 0, max_ranges=2, preview_bytes=2)
            self.assertEqual(report['changedBytes'], 16)
            self.assertEqual(report['changedRanges'], 4)
            self.assertTrue(report['rangesTruncated'])
            self.assertEqual(len(report['ranges']), 2)
            self.assertTrue(report['ranges'][0]['previewTruncated'])
            self.assertEqual(report['ranges'][0]['afterHex'], '01 01')
            self.assertNotIn(str(root), json.dumps(report))
            write_new_report(output, report)
            original = target.read_bytes()
            with self.assertRaises(FileExistsError):
                write_new_report(output, {'bad': True})
            self.assertEqual(original, target.read_bytes())
            with self.assertRaises(FileExistsError):
                validate_paths(copies, before, after, target)
            for forbidden in (before, after, copies / 'new-report.json'):
                with self.assertRaises(ValueError):
                    validate_paths(copies, before, after, forbidden)
            self.assertEqual(before.read_bytes(), bytes(20))

    def test_outside_input_and_hardlink_output_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            copies = root / 'copies'
            copies.mkdir()
            inside = copies / 'a.bin'
            outside = root / 'outside.bin'
            inside.write_bytes(b'copy')
            outside.write_bytes(b'outside')
            with self.assertRaises(ValueError):
                validate_paths(copies, inside, outside, None)
            alias = root / 'alias.bin'
            os.link(inside, alias)
            with self.assertRaises(FileExistsError):
                validate_paths(copies, inside, inside, alias)
            with self.assertRaises(FileExistsError):
                write_new_report(alias, {})
            self.assertEqual(inside.read_bytes(), b'copy')

    def test_changed_input_report_is_discarded(self):
        with patch('agent.binary_diff.read_copy', side_effect=[b'a', b'b', b'changed']):
            with self.assertRaises(RuntimeError):
                build_report(Path('a'), Path('b'))

    def test_limits_checked_before_reading(self):
        for options in ({'max_ranges': 0}, {'preview_bytes': 257}, {'max_ranges': True}):
            with self.assertRaises(ValueError):
                build_report(Path('missing'), Path('missing'), **options)
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'oversized.bin'
            with target.open('wb') as stream:
                stream.truncate(MAX_COPY_BYTES + 1)
            with self.assertRaises(ValueError):
                read_copy(target)
            target.write_bytes(b'')
            with self.assertRaises(ValueError):
                read_copy(target)
