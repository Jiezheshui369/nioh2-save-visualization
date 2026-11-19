import unittest
from pathlib import Path
from agent.scroll_selection import inspect_scroll_selection, SELECTOR_OFFSET, TABLE_START, RECORD_SIZE
from agent.parser import parse_bytes

ITEMS = {"DEA7": {"type": "Scrolls", "name": "Scroll"}}
def fixture(index=39, records=40):
    data = bytearray(TABLE_START + RECORD_SIZE * records)
    data[:7] = b"NIOHUSR"
    data[0x14:0x18] = (0x148).to_bytes(4, "little")
    data[0x18:0x1c] = (len(data)-0x148).to_bytes(4, "little")
    data[SELECTOR_OFFSET:SELECTOR_OFFSET+4] = index.to_bytes(4, "little")
    for i in (36,39):
        if i < records:
            at=TABLE_START+i*RECORD_SIZE
            data[at:at+2]=bytes.fromhex("DEA7")
    return data

class ScrollSelectionTests(unittest.TestCase):
    def test_aba_reference_uses_index_not_shared_item_id(self):
        rows=[inspect_scroll_selection(fixture(i),ITEMS) for i in (39,36,39)]
        self.assertEqual([r["candidateRecord"]["recordIndex"] for r in rows],[39,36,39])
        self.assertEqual([r["candidateRecord"]["id"] for r in rows],["DEA7"]*3)
        self.assertTrue(all(r["status"]=="candidate" and r["selectionVerified"] is False
                            and r["generalizationVerified"] is False for r in rows))
    def test_bad_container_and_length_fail_closed(self):
        d=fixture();d[:7]=b"NIOHSYS"
        self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"unrecognized-container")
        d=fixture();d[0x18:0x1c]=(5).to_bytes(4,"little")
        self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"inconsistent-container-lengths")
    def test_truncated_selector_is_unknown(self):
        d=fixture()[:0x200];d[0x18:0x1c]=(len(d)-0x148).to_bytes(4,"little")
        self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"truncated-selector")
    def test_sentinel_is_unknown_not_claimed_unequipped(self):
        r=inspect_scroll_selection(fixture(0xffffffff),ITEMS)
        self.assertEqual(r["reason"],"unverified-sentinel");self.assertIsNone(r["candidateRecord"])
    def test_physical_and_logical_bounds(self):
        for d in (fixture(40),fixture(248,249)):
            self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"record-index-out-of-bounds")
        d=fixture(39);d=d[:-1];d[0x18:0x1c]=(len(d)-0x148).to_bytes(4,"little")
        self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"record-index-out-of-bounds")
    def test_empty_unknown_or_wrong_catalog_type_is_unknown(self):
        d=fixture();at=TABLE_START+39*RECORD_SIZE;d[at:at+2]=b"\0\0"
        self.assertEqual(inspect_scroll_selection(d,ITEMS)["reason"],"empty-referenced-record")
        for cat in ({},{"DEA7":{"type":"Sword"}}):
            self.assertEqual(inspect_scroll_selection(fixture(),cat)["reason"],"unrecognized-scroll-item")
    def test_parser_integration_defaults_off_and_preserves_existing_output(self):
        repo=Path(__file__).resolve().parents[2]
        args=(fixture(),repo/"agent/data/items.json",repo/"agent/data/effects.json")
        ordinary=parse_bytes(*args)
        experimental=parse_bytes(*args,include_experimental_scroll_selection=True)
        self.assertNotIn("experimentalScrollSelection",ordinary)
        extra=experimental.pop("experimentalScrollSelection")
        self.assertEqual(ordinary,experimental)
        self.assertEqual(extra["candidateRecord"]["recordIndex"],39)
        self.assertFalse(extra["selectionVerified"])
    def test_tiny_input_never_claims_selection(self):
        self.assertEqual(inspect_scroll_selection(b"",ITEMS)["status"],"unknown")
if __name__ == "__main__":
    unittest.main()
