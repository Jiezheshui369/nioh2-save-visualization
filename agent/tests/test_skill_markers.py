import copy
from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from agent.tools.scan_skill_markers import REVERSE_BITS, main, packed_matches, rank_hypotheses, scan, sequences


def observed(markers=None):
    markers = markers or ['circle', 'upward', 'none', 'circle'] * 4
    return {'sequences': [{'id': 'synthetic', 'entries': [
        dict(label=f'synthetic-{i}', marker=marker, rankText='壹') for i, marker in enumerate(markers)]}]}


class SkillMarkerTests(unittest.TestCase):
    def test_cli_keeps_inputs_unchanged_and_refuses_report_overwrite_or_copy_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copies = root / 'copies'
            copies.mkdir()
            source = copies / 'SAVEDATA.BIN'
            source.write_bytes(b'\xAA' * 40)
            evidence = root / 'observations.json'
            evidence.write_text(json.dumps(observed()), encoding='utf-8')
            original = (source.read_bytes(), evidence.read_bytes())
            output = root / 'report'
            argv = ['scan', '--copy-root', str(copies), '--decrypted-copy', str(source),
                    '--observations', str(evidence), '--output-dir', str(output)]
            with patch('sys.argv', argv), redirect_stdout(io.StringIO()):
                main()
            report = json.loads((output / 'skill-marker-candidates.json').read_text(encoding='utf-8'))
            self.assertTrue(report['inputsUnchanged'])
            self.assertEqual(report['newVerifiedFields'], 0)
            report_bytes = (output / 'skill-marker-candidates.json').read_bytes()
            with patch('sys.argv', argv), self.assertRaises(FileExistsError):
                main()
            argv[-1] = str(copies / 'bad-output')
            with patch('sys.argv', argv), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main()
            self.assertFalse((copies / 'bad-output').exists())
            self.assertEqual((source.read_bytes(), evidence.read_bytes()), original)
            self.assertEqual((output / 'skill-marker-candidates.json').read_bytes(), report_bytes)

    def test_rank_interpretations_are_separate_and_unlearned_one_is_zero(self):
        entries = [dict(marker='circle', rankText='参'), dict(marker='upward', rankText='贰'),
                   dict(marker='none', rankText='壹'), dict(marker='circle')]
        self.assertEqual(rank_hypotheses(entries), [('shown-rank-is-current', [3, 2, 0, 1]),
                                                   ('upward-shows-next-rank', [3, 1, 0, 1])])
        self.assertEqual(rank_hypotheses([dict(marker='upward', rankText='unknown')] + entries), [])
        self.assertEqual(rank_hypotheses([dict(marker='upward')] + entries), [])

    def test_preserves_observations_and_never_infers_rank_from_text(self):
        document = observed()
        before = copy.deepcopy(document)
        report = scan(b'\xA0' * 80, document)
        self.assertEqual(document, before)
        self.assertFalse(report['complete'])
        self.assertEqual(report['newVerifiedFields'], 0)
        self.assertTrue(all(not row['verified'] for row in report['results']))
        self.assertNotIn('currentRank', str(report))

    def test_all_bit_phases_and_byte_edges_against_bruteforce(self):
        rng = random.Random(4928)
        for _ in range(35):
            data = rng.randbytes(20)
            stream = ''.join(f'{value:08b}' for value in data)
            start = rng.randrange(0, 140)
            bits = stream[start:start + 17]
            expected = [(i // 8, i % 8) for i in range(len(stream) - len(bits) + 1) if stream.startswith(bits, i)]
            found = packed_matches(data, bits, 64, [10000])
            actual = [(row['byteOffset'], row['bitPhase']) for row in found['examples']]
            self.assertEqual(sorted(actual), expected)
            self.assertEqual(found['matchCount'], len(expected))
            self.assertFalse(found['searchTruncated'])

    def test_reversed_byte_bits_locate_lsb_hypothesis(self):
        markers = ['none', 'circle', 'upward', 'circle'] * 4
        bits = ''.join('0' if m == 'none' else '1' for m in markers)
        packed = int(bits, 2).to_bytes(2, 'big').translate(REVERSE_BITS)
        report = scan(packed, observed(markers))
        found = next(r for r in report['results'] if r['hypothesis'] == 'learned-flag' and r['encoding'] == 'packed-1bit-lsb-first')
        self.assertEqual(found['matchCount'], 1)
        self.assertEqual(found['examples'], [dict(byteOffset=0, bitPhase=0)])

    def test_scalar_unaligned_and_endian_hypotheses(self):
        markers = ['circle', 'upward', 'none', 'circle'] * 4
        values = [2, 1, 0, 2] * 4
        data = b'!' + b''.join(value.to_bytes(4, 'big') for value in values)
        found = next(r for r in scan(data, observed(markers))['results']
                     if r['hypothesis'] == 'marker-codes-012' and r['encoding'] == 'uint32-big')
        self.assertEqual(found['examples'], [dict(byteOffset=1, naturallyAligned=False)])
        self.assertEqual(found['matchCount'], 1)

    def test_examples_and_work_budget_are_separate(self):
        bits = '1010101010101010'
        result = packed_matches(b'\xAA' * 40, bits, 2, [10000])
        self.assertGreater(result['matchCount'], 2)
        self.assertEqual(len(result['examples']), 2)
        self.assertTrue(result['examplesTruncated'])
        self.assertFalse(result['searchTruncated'])
        limited = packed_matches(b'\xAA' * 40, bits, 2, [1])
        self.assertTrue(limited['searchTruncated'])
        self.assertEqual(limited['matchCount'], 1)

    def test_shared_work_budget_reports_incomplete_search(self):
        document = observed(['circle', 'none'] * 8)
        report = scan(b'\xAA' * 60, document, max_checks=1)
        self.assertTrue(report['searchTruncated'])
        self.assertEqual(report['checksUsed'], 1)
        self.assertEqual(report['newVerifiedFields'], 0)

    def test_rejects_missing_cropped_uniform_or_duplicate_sequences(self):
        for document in [None, {}, {'sequences': []}, observed(['circle'] * 16),
                         observed(['circle', 'none'] * 7), observed(['circle', 'unknown'] * 8)]:
            with self.subTest(document=document), self.assertRaises(ValueError):
                sequences(document)
        duplicate = observed()
        duplicate['sequences'] *= 2
        with self.assertRaises(ValueError):
            sequences(duplicate)
        invalid = observed()
        invalid['sequences'][0]['entries'][0]['label'] = ''
        with self.assertRaises(ValueError):
            sequences(invalid)

    def test_bounds_and_short_copy(self):
        self.assertTrue(all(r['matchCount'] == 0 for r in scan(b'', observed())['results']))
        for options in [dict(examples=0), dict(examples=True), dict(max_checks=0), dict(max_checks=True)]:
            with self.assertRaises(ValueError):
                scan(b'', observed(), **options)
        with self.assertRaises(ValueError):
            scan(bytearray(), observed())


if __name__ == '__main__':
    unittest.main()
