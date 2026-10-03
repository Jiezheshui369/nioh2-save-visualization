import unittest
from agent.tools.analyze_parser_gaps import analyze


class GapAnalysisTests(unittest.TestCase):
    def test_distinguishes_numeric_grades_empty_caps_and_unknown_ids(self):
        record = {'id': 'AB', 'type': 'Soul Core', 'nameZh': '测试',
                  'effects': ['Numeric', 'Grade', 'Flag?', 'Missing', 'Unexpected'],
                  'effectsZh': ['数值', '等级', '待定', None, '意外'],
                  'effectIds': ['A', 'B', 'C', 'D', 'E'],
                  'effectMagnitudes': ['5%', None, None, None, None]}
        report = analyze({'equipmentInventory': [record]}, [
            {'id': 'A', 'CAP': '.1'}, {'id': 'B', 'CAP': 'A+'},
            {'id': 'C', 'CAP': ''}, {'id': 'E', 'CAP': '10'}])
        self.assertEqual(report['effectOccurrences'], 5)
        self.assertEqual(sum(report['valueCoverage'].values()), 5)
        self.assertEqual(report['valueCoverage']['nonNumericCatalogue'], 1)
        self.assertEqual(report['valueCoverage']['emptyCatalogueCap'], 1)
        self.assertEqual(report['valueCoverage']['noCatalogueEntry'], 1)
        self.assertEqual(report['valueCoverage']['numericCatalogueButMissingValue'], 1)
        self.assertEqual(report['missingEffectNames'][0]['id'], 'D')

    def test_old_snapshots_with_missing_parallel_arrays_are_not_assumed_decoded(self):
        result = analyze({'scrolls': [{'effects': ['Unknown'], 'id': '12'}]}, [])
        self.assertEqual(result['valueCoverage'], {'noCatalogueEntry': 1})
        self.assertEqual(result['missingItemNames'][0]['group'], 'scrolls')

    def test_occurrences_preserve_duplicates_but_do_not_double_count_loadout(self):
        record = {'effects': ['One', 'One'], 'effectIds': ['AB', 'AB']}
        result = analyze({'equipmentInventory': [record], 'currentLoadout': [record]}, [])
        self.assertEqual(result['effectOccurrences'], 2)
        self.assertEqual(result['missingEffectValues'][0]['occurrences'], 2)

    def test_no_personal_identifiers_or_paths_are_copied(self):
        result = analyze({'snapshotId': 'private', 'sourcePath': 'private', 'safety': {'hash': 'private'}}, [])
        self.assertNotIn('private', str(result))


if __name__ == '__main__':
    unittest.main()
