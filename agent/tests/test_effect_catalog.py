import copy
import json
from pathlib import Path
import struct
import unittest

from agent.effect_catalog import build_effect_lookup, effect_translation_lookup, effect_lookup_key
from agent.parser import _effect_names, _effect_value_details, _load_effects, _load_zh_effects
from agent.tools.analyze_parser_gaps import analyze

CATALOGUE = Path(__file__).parents[1] / "data/effects.json"


class EffectCatalogueTests(unittest.TestCase):
    def test_four_aliases_match_labels_and_keep_unverified_value_evidence(self):
        effects, zh = _load_effects(CATALOGUE), _load_zh_effects(CATALOGUE)
        data = bytearray(0x90)
        for slot, raw_id in enumerate((4, 9, 0x62, 0x66, 0x60, 0x80, 0)):
            struct.pack_into("<III", data, 48 + slot * 12, raw_id, 10, 0xABCDEF01)
        names, names_zh, ids, values = _effect_names(bytes(data), 0, effects, zh)
        details = _effect_value_details(bytes(data), 0, effects)
        self.assertEqual(ids, ["0004", "0009", "0062", "0066", "0060", "0080"])
        self.assertEqual(names[:4], ["Defense", "Pleiades (Surrounded)", "Guard Ki Consumption",
                                     "Bow Damage (Close Range)"])
        self.assertTrue(all(names_zh[:4]))
        self.assertEqual(names[4:], ["Unknown effect 0060", "Unknown effect 0080"])
        self.assertEqual(names_zh[4:], [None, None])
        self.assertEqual(values, ["10", None, "-1%", "1%", None, None])
        self.assertEqual([d["encoding"] for d in details],
                         ["legacy-cap", "not-decoded", "legacy-cap", "legacy-cap", "not-decoded", "not-decoded"])
        self.assertTrue(all(d["rawValue"] == 10 for d in details))
        self.assertEqual(len(ids), len(details))
        # Gap diagnostics must use exactly the same alias/quarantine policy.
        record = dict(effects=names, effectsZh=names_zh, effectIds=ids, effectMagnitudes=values)
        report = analyze({"equipmentInventory": [record]}, json.loads(CATALOGUE.read_text(encoding="utf-8")))
        self.assertEqual(report["valueCoverage"], {"decodedNumeric": 3, "nonNumericCatalogue": 1, "noCatalogueEntry": 2})

    def test_original_rows_and_catalogue_are_not_rewritten(self):
        rows = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        before = copy.deepcopy(rows)
        lookup = build_effect_lookup(rows)
        self.assertEqual(lookup["0004"]["id"], "04")
        self.assertEqual(rows, before)
        self.assertEqual(len(rows), 1970)
        self.assertNotIn("0060", lookup)
        self.assertNotIn("0080", lookup)

    def test_conflicting_alias_and_canonical_key_fail_in_any_order(self):
        rows = [{"id": "04", "Effect": "Defense"}, {"id": "0004", "Effect": "Different"}]
        for order in (rows, list(reversed(rows))):
            with self.assertRaisesRegex(ValueError, "0004"):
                build_effect_lookup(order)

    def test_long_ids_never_override_canonical_even_when_numerically_equal(self):
        rows = [{"id": "0041", "Effect": "Untouched Sticky Pot"},
                {"id": "000041", "Effect": "Heal Allies"},
                {"id": "12340041", "Effect": "High bits"}]
        for order in (rows, list(reversed(rows))):
            self.assertEqual(list(build_effect_lookup(order)), ["0041"])
            self.assertEqual(build_effect_lookup(order)["0041"]["Effect"], "Untouched Sticky Pot")

    def test_sentinels_and_unapproved_keys_are_not_activated(self):
        for key in ("00", "0000", "FFFF", "60", "80", "000060", "00000080", " 04", "4", "ZZZZ", 4):
            self.assertIsNone(effect_lookup_key(key))
        self.assertEqual(effect_lookup_key("aBcD"), "ABCD")
        data = bytearray(0x90)
        struct.pack_into("<I", data, 48, 0x12340000)
        struct.pack_into("<I", data, 60, 0x1234FFFF)
        self.assertEqual(_effect_names(bytes(data), 0, {}, {}), ([], [], [], []))
        self.assertEqual(_effect_value_details(bytes(data), 0, {}), [])

    def test_translation_aliases_follow_the_same_scope_and_reject_collisions(self):
        names = {"04": "defense", "60": "ambiguous", "000041": "long", "0041": "canonical"}
        self.assertEqual(effect_translation_lookup(names), {"0004": "defense", "0041": "canonical"})
        for names in ({"04": "first", "0004": "second"}, {"0004": "second", "04": "first"}):
            with self.assertRaises(ValueError):
                effect_translation_lookup(names)

    def test_same_name_ids_and_verified_rules_remain_distinct(self):
        effects = _load_effects(CATALOGUE)
        self.assertEqual([effects[k]["CAP"] for k in ("53BC", "5222", "CE36", "86D0", "7E06")],
                         ["38", "2", "54", "78", "10"])
        data = bytearray(0x90)
        struct.pack_into("<III", data, 48, 0xB4D8, 21, 0)
        self.assertEqual(_effect_names(bytes(data), 0, effects, {})[3], ["2.1"])
        self.assertEqual(_effect_value_details(bytes(data), 0, effects),
                         [{"rawValue": 21, "kind": "numeric", "encoding": "verified-id"}])


if __name__ == "__main__":
    unittest.main()
