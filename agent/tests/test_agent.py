import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from desktop_launcher import KATANA_SHA256, app_data_root, bundle_root, file_sha256, prepare_decryptor, running_agent_status
from agent.nioh2_agent import _verify_original_manifest, discover_save_sources, import_snapshot_json, inventory_quantity_changes, is_request_authorized, list_snapshots, normalize_research_label, parse_and_store, public_source_options, sha256, snapshot_by_id, snapshot_save, steam_cloud_status, steam_sha1, summarize_save_source, summarize_snapshot_workspace
from agent.binary_diff import changed_ranges
from agent.parser import EQUIPMENT_SIZE, EQUIPMENT_START, LOADOUT_NAME_OFFSET, MIN_SAVE_SIZE, SCROLL_SIZE, SCROLL_START, SKILL_POINT_OFFSETS, STACKED_ITEM_START, _format_effect_magnitude, _set_or_grace, parse_bytes
from agent.tools.extract_official_localization import _template_translation


class AgentTests(unittest.TestCase):
    def test_desktop_launcher_keeps_data_outside_game_and_bundle(self):
        with tempfile.TemporaryDirectory() as root, patch.dict("os.environ", {"LOCALAPPDATA": root}):
            target = app_data_root()
            self.assertEqual(Path(root) / "Nioh2SaveCompanion", target)
            self.assertNotEqual(bundle_root(), target)

    def test_desktop_launcher_copies_verified_decryptor_to_writable_data(self):
        with tempfile.TemporaryDirectory() as root:
            target = prepare_decryptor(bundle_root(), Path(root))
            self.assertEqual(KATANA_SHA256, file_sha256(target))
            self.assertTrue((target.parent / "LICENSE.txt").is_file())

    def test_running_agent_probe_rejects_unrelated_service(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":"ok","writeBackSupported":false,"lanMode":true}'
        with patch("desktop_launcher.urllib.request.urlopen", return_value=response):
            self.assertTrue(running_agent_status(13253)["lanMode"])
        response.__enter__.return_value.read.return_value = b'{"status":"another-service"}'
        with patch("desktop_launcher.urllib.request.urlopen", return_value=response):
            self.assertIsNone(running_agent_status(13253))

    def test_public_demo_is_synthetic_and_redacted(self):
        project_root = Path(__file__).parents[2]
        demo_path = project_root / "public" / "data" / "demo-snapshot.json"
        raw = demo_path.read_text(encoding="utf-8")
        demo = json.loads(raw)
        self.assertEqual("synthetic-demo", demo["snapshotId"])
        self.assertTrue(demo["privacy"]["redactedForSharing"])
        self.assertEqual("REDACTED", demo["safety"]["originalMainSaveSha256"])
        self.assertNotIn("B0716AB0BB418380D1C5DC311A1E802E3894C0E5716ACFD9E4A7C3B5AD8E7C62", raw)

    def test_research_label_is_trimmed_and_bounded(self):
        self.assertEqual("拾取木灵前", normalize_research_label("  拾取木灵前  "))
        with self.assertRaises(ValueError):
            normalize_research_label(" ")
        with self.assertRaises(ValueError):
            normalize_research_label("x" * 81)

    def test_lan_token_is_required_only_for_remote_clients(self):
        self.assertTrue(is_request_authorized(None, "192.168.1.20", None))
        self.assertTrue(is_request_authorized("secret", "127.0.0.1", None))
        self.assertTrue(is_request_authorized("secret", "::1", None))
        self.assertTrue(is_request_authorized("secret", "192.168.1.20", "secret"))
        self.assertFalse(is_request_authorized("secret", "192.168.1.20", None))
        self.assertFalse(is_request_authorized("secret", "192.168.1.20", "wrong"))

    def test_snapshot_copies_without_changing_source(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "source"
            workspace = base / "workspace"
            source.mkdir()
            save = source / "SAVEDATA.BIN"
            save.write_bytes(b"nioh2-test-data")
            before = sha256(save)
            result = snapshot_save(source, workspace)
            self.assertEqual(before, sha256(save))
            self.assertEqual(before, sha256(result / "SAVEDATA.BIN"))
            manifest = json.loads((result / "snapshot-manifest.json").read_text(encoding="utf-8"))
            self.assertFalse(manifest["policy"]["writeBackSupported"])
            self.assertIn("source_last_write_utc", manifest["files"][0])

    def test_final_source_verification_detects_a_game_write_without_modifying_source(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "source"
            workspace = base / "workspace"
            source.mkdir()
            save = source / "SAVEDATA.BIN"
            save.write_bytes(b"first-stable-save")
            copied = snapshot_save(source, workspace)
            manifest = json.loads((copied / "snapshot-manifest.json").read_text(encoding="utf-8"))
            _verify_original_manifest(source, manifest)
            save.write_bytes(b"game-wrote-a-new-save")
            changed = sha256(save)
            with self.assertRaisesRegex(RuntimeError, "原始存档发生变化"):
                _verify_original_manifest(source, manifest)
            self.assertEqual(changed, sha256(save))

    def test_rapid_snapshots_get_distinct_directories(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "source"
            workspace = base / "workspace"
            source.mkdir()
            (source / "SAVEDATA.BIN").write_bytes(b"safe-copy")
            first = snapshot_save(source, workspace)
            second = snapshot_save(source, workspace)
            self.assertNotEqual(first, second)
            self.assertTrue((first / "SAVEDATA.BIN").is_file())
            self.assertTrue((second / "SAVEDATA.BIN").is_file())

    def test_snapshot_workspace_summary_exposes_counts_without_paths(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root) / "encrypted-copies"
            source = Path(root) / "source"
            source.mkdir()
            (source / "SAVEDATA.BIN").write_bytes(b"safe-copy")
            snapshot_save(source, workspace)
            incomplete = workspace / "incomplete-private-name"
            incomplete.mkdir()
            (incomplete / ".incomplete").write_text("pending", encoding="utf-8")
            summary = summarize_snapshot_workspace(workspace)
            self.assertEqual(1, summary["completeCopies"])
            self.assertEqual(1, summary["incompleteCopies"])
            self.assertIsNotNone(summary["latestCreatedAtUtc"])
            self.assertNotIn(str(workspace), json.dumps(summary))

    def test_steam_cloud_status_matches_local_metadata_without_exposing_paths_or_hashes(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "KoeiTecmo" / "NIOH2" / "Savedata" / "1000000001" / "SAVEDATA00"
            source.mkdir(parents=True)
            save = source / "SAVEDATA.BIN"
            save.write_bytes(b"cloud-test")
            timestamp = int(save.stat().st_mtime)
            cache = base / "Steam" / "userdata" / "1000000001" / "1325200" / "remotecache.vdf"
            cache.parent.mkdir(parents=True)
            private_sha = steam_sha1(save).lower()
            cache.write_text(
                f'''"1325200"\n{{\n\t"KoeiTecmo/NIOH2/Savedata/1000000001/SAVEDATA00/SAVEDATA.BIN"\n\t{{\n\t\t"size" "10"\n\t\t"localtime" "{timestamp}"\n\t\t"remotetime" "{timestamp}"\n\t\t"sha" "{private_sha}"\n\t}}\n}}''',
                encoding="utf-8",
            )
            status = steam_cloud_status(source, [base / "Steam"])
            self.assertTrue(status["detected"])
            self.assertEqual("synchronized", status["state"])
            self.assertTrue(status["contentMatches"])
            rendered = json.dumps(status)
            self.assertNotIn(private_sha, rendered.lower())
            self.assertNotIn(str(cache), rendered)

    def test_steam_cloud_status_detects_local_save_newer_than_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "1000000001" / "SAVEDATA00"
            source.mkdir(parents=True)
            save = source / "SAVEDATA.BIN"
            save.write_bytes(b"cloud-test")
            cache = base / "Steam" / "userdata" / "1000000001" / "1325200" / "remotecache.vdf"
            cache.parent.mkdir(parents=True)
            old = int(save.stat().st_mtime) - 60
            cache.write_text(
                f'''"1325200"\n{{\n\t"KoeiTecmo/NIOH2/Savedata/1000000001/SAVEDATA00/SAVEDATA.BIN"\n\t{{\n\t\t"size" "10"\n\t\t"localtime" "{old}"\n\t\t"remotetime" "{old}"\n\t}}\n}}''',
                encoding="utf-8",
            )
            self.assertEqual("local-newer", steam_cloud_status(source, [base / "Steam"])["state"])

    def test_source_summary_hides_full_path_and_lists_slots(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "1000000001"
            slot = source / "SAVEDATA00"
            slot.mkdir(parents=True)
            (slot / "SAVEDATA.BIN").write_bytes(b"test")
            summary = summarize_save_source(source)
            self.assertTrue(summary["configured"])
            self.assertEqual("…1843", summary["accountHint"])
            self.assertEqual(["SAVEDATA00"], summary["saveSlots"])
            self.assertNotIn(str(source), json.dumps(summary, ensure_ascii=False))

    def test_source_summary_does_not_leak_custom_directory_names(self):
        with tempfile.TemporaryDirectory() as root:
            slot = Path(root) / "private-profile-name" / "SAVEDATA00"
            slot.mkdir(parents=True)
            (slot / "SAVEDATA.BIN").write_bytes(b"test")
            summary = summarize_save_source(slot)
            self.assertEqual("已识别", summary["accountHint"])
            self.assertNotIn("profile", json.dumps(summary, ensure_ascii=False))

    def test_discovers_multiple_character_slots_without_exposing_paths(self):
        with tempfile.TemporaryDirectory() as root:
            account = Path(root) / "1000000001"
            for name in ("SAVEDATA00", "SAVEDATA01"):
                slot = account / name
                slot.mkdir(parents=True)
                (slot / "SAVEDATA.BIN").write_bytes(name.encode())
            sources = discover_save_sources(account)
            self.assertEqual(["SAVEDATA00", "SAVEDATA01"], [path.name for path in sources])
            options = public_source_options(sources, sources[1])
            self.assertEqual(["source-1", "source-2"], [item["id"] for item in options])
            self.assertFalse(options[0]["active"])
            self.assertTrue(options[1]["active"])
            self.assertNotIn(str(account), json.dumps(options, ensure_ascii=False))

    def test_import_requires_character(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            invalid = base / "bad.json"
            invalid.write_text('{"schemaVersion":"1"}', encoding="utf-8")
            with self.assertRaises(ValueError):
                import_snapshot_json(invalid, base / "store")

    def test_import_rejects_non_object_character_and_oversized_id(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            invalid = base / "bad.json"
            invalid.write_text(json.dumps({"schemaVersion": "1", "character": [], "snapshotId": "safe"}), encoding="utf-8")
            with self.assertRaises(ValueError):
                import_snapshot_json(invalid, base / "store")
            invalid.write_text(json.dumps({"schemaVersion": "1", "character": {}, "snapshotId": "a" * 81}), encoding="utf-8")
            with self.assertRaises(ValueError):
                import_snapshot_json(invalid, base / "store")

    def test_import_rejects_traversal_and_never_overwrites_collision(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "snapshot.json"
            source.write_text(json.dumps({"schemaVersion": "1", "snapshotId": "../escape", "character": {}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                import_snapshot_json(source, base / "store")

            source.write_text(json.dumps({"schemaVersion": "1", "snapshotId": "same", "character": {"level": 1}}), encoding="utf-8")
            first = import_snapshot_json(source, base / "store")
            source.write_text(json.dumps({"schemaVersion": "1", "snapshotId": "same", "character": {"level": 2}}), encoding="utf-8")
            second = import_snapshot_json(source, base / "store")
            self.assertNotEqual(first, second)
            self.assertEqual(1, json.loads(first.read_text(encoding="utf-8"))["character"]["level"])
            self.assertEqual("same-import-1", json.loads(second.read_text(encoding="utf-8"))["snapshotId"])

    def test_parser_rejects_short_file(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text("{}", encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            with self.assertRaises(ValueError):
                parse_bytes(b"too short", items, effects)

    def test_snapshot_history_round_trip(self):
        with tempfile.TemporaryDirectory() as root:
            store = Path(root)
            payload = {
                "snapshotId": "safe-id",
                "sourceLastWriteLocal": "2026-09-16T12:00:00+10:00",
                "parserVersion": "test",
                "character": {"level": 123},
            }
            (store / "safe-id.json").write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(123, snapshot_by_id(store, "safe-id")["character"]["level"])
            self.assertEqual("safe-id", list_snapshots(store)[0]["snapshotId"])

    def test_snapshot_id_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                snapshot_by_id(Path(root), "../outside")

    def test_binary_diff_compacts_nearby_changes(self):
        before = bytes.fromhex("00 01 02 03 04 05 06 07")
        after = bytes.fromhex("00 FF 02 03 EE 05 06 07")
        ranges = changed_ranges(before, after, merge_gap=2)
        self.assertEqual(1, len(ranges))
        self.assertEqual("0x00000001", ranges[0]["offsetHex"])
        self.assertEqual("01 02 03 04", ranges[0]["beforeHex"])

    def test_parse_and_store_records_read_only_backup_diagnostics(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text("{}", encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            snapshot_root = base / "copies"
            snapshot_root.mkdir()
            current = snapshot_root / "SAVEDATA.BIN"
            backup = snapshot_root / "BACKUP.BIN"
            current_data = bytearray(MIN_SAVE_SIZE)
            backup_data = bytearray(MIN_SAVE_SIZE)
            for fixture in (current_data, backup_data):
                fixture[:8] = b'NIOHUSR\0'
                fixture[8:12] = (0x21030200).to_bytes(4, 'little')
                fixture[0x14:0x18] = (0x148).to_bytes(4, 'little')
                fixture[0x18:0x1C] = (len(fixture)-0x148).to_bytes(4, 'little')
            current_data[0x7B8D8] = 2
            backup_data[0x7B8D8] = 1
            current.write_bytes(current_data)
            backup.write_bytes(backup_data)
            current_hash = sha256(current)
            backup_hash = sha256(backup)
            result = parse_and_store(current, backup, snapshot_root, base / "store", items, effects, current_hash)
            parsed = json.loads(result.read_text(encoding="utf-8"))
            self.assertEqual(1, parsed["backupComparison"]["binaryChangedBytes"])
            self.assertEqual(1, parsed["backupComparison"]["binaryChangedRanges"])
            self.assertTrue(parsed["backupComparison"]["inventoryChanged"] is False)
            self.assertTrue(parsed["backupComparison"]["copyHashesUnchangedAfterParsing"])
            self.assertEqual(current_hash, sha256(current))
            self.assertEqual(backup_hash, sha256(backup))

    def test_parse_uses_original_write_times_instead_of_decryptor_output_time(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text("{}", encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            copies = base / "copies"
            copies.mkdir()
            current = copies / "SAVEDATA.BIN"
            backup = copies / "BACKUP.BIN"
            fixture = bytearray(MIN_SAVE_SIZE)
            fixture[:8] = b'NIOHUSR\0'
            fixture[8:12] = (0x21030200).to_bytes(4, 'little')
            fixture[0x14:0x18] = (0x148).to_bytes(4, 'little')
            fixture[0x18:0x1C] = (len(fixture)-0x148).to_bytes(4, 'little')
            current.write_bytes(fixture)
            backup.write_bytes(fixture)
            result = parse_and_store(
                current, backup, copies, base / "store", items, effects, sha256(current), None,
                "2026-09-18T16:44:02+00:00", "2026-09-18T16:40:00+00:00",
            )
            parsed = json.loads(result.read_text(encoding="utf-8"))
            self.assertEqual("2026-09-18T16:44:02+00:00", parsed["sourceLastWriteLocal"])
            self.assertEqual("2026-09-18T16:40:00+00:00", parsed["backupComparison"]["backupLastWriteLocal"])

    def test_inventory_quantity_changes_aggregates_duplicate_item_slots(self):
        before = [
            {"id": "0529", "nameZh": "神馔米", "name": "Divine Rice", "quantity": 2},
            {"id": "0529", "nameZh": "神馔米", "name": "Divine Rice", "quantity": 3},
        ]
        after = [{"id": "0529", "nameZh": "神馔米", "name": "Divine Rice", "quantity": 8}]
        self.assertEqual([{
            "id": "0529", "nameZh": "神馔米", "name": "Divine Rice", "before": 5, "after": 8, "delta": 3,
        }], inventory_quantity_changes(before, after))

    def test_set_or_grace_recognizes_both_english_name_forms(self):
        self.assertEqual("Grace of Tsukuyomi", _set_or_grace(["Attack", "Grace of Tsukuyomi"]))
        self.assertEqual("Izanagi's Grace", _set_or_grace(["Defense", "Izanagi's Grace"]))
        self.assertEqual("Onmyo Austerity", _set_or_grace(["Onmyo Austerity"]))

    def test_effect_magnitude_uses_catalog_cap_encoding(self):
        self.assertEqual("11.9%", _format_effect_magnitude({"CAP": "0.12"}, 119))
        self.assertEqual("-5.4%", _format_effect_magnitude({"CAP": "-0.057"}, 54))
        self.assertEqual("24", _format_effect_magnitude({"CAP": "30"}, 24))
        self.assertIsNone(_format_effect_magnitude({"CAP": "AA-"}, 12))

    def test_official_localization_expands_unique_effect_templates(self):
        translations = {"Mystic Dyad (%ls)": "奥义两立（%ls）"}
        self.assertEqual("奥义两立（太刀）", _template_translation("Mystic Dyad (Sword)", translations))
        self.assertIsNone(_template_translation("Mystic Dyad (Unknown Weapon)", translations))
        tagged = {
            "^09~DEBUFF~%ls^09~~ (Onmyo Magic Hit)": "阴阳术命中赋予^09~DEBUFF~%ls^09~~",
            "Sloth": "动作速度降低",
        }
        self.assertEqual("阴阳术命中赋予动作速度降低", _template_translation("Sloth (Onmyo Magic Hit)", tagged))

    def test_parser_reads_skill_point_research_counters(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text("{}", encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)
            temporary, permanent = SKILL_POINT_OFFSETS["ninjutsu"]
            data[temporary:temporary + 4] = (69).to_bytes(4, "little")
            data[permanent:permanent + 4] = (48).to_bytes(4, "little")
            parsed = parse_bytes(bytes(data), items, effects)
            self.assertEqual({"temporary": 69, "permanent": 48}, parsed["character"]["skillPointCounters"]["ninjutsu"])

    def test_parser_reads_utf16_saved_preset_name(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text("{}", encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)
            encoded = "战斗准备 1".encode("utf-16le") + b"\0\0"
            data[LOADOUT_NAME_OFFSET:LOADOUT_NAME_OFFSET + len(encoded)] = encoded
            parsed = parse_bytes(bytes(data), items, effects)
            self.assertEqual("存档记录的当前装备", parsed["currentLoadoutName"])
            self.assertEqual("战斗准备 1", parsed["savedEquipmentPresetName"])

    def test_parser_uses_equipped_marker_and_preserves_empty_slots(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text(json.dumps({
                "FA97": {"name": "Tsuchigumo Clawed Fists", "type": "Weapon"},
                "0BF4": {"name": "Tengu's Khakkhara", "type": "Weapon"},
            }), encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)

            # Slot value 11 is the community-documented unequipped marker.
            data[EQUIPMENT_START:EQUIPMENT_START + 2] = bytes.fromhex("FA 97")
            data[EQUIPMENT_START + 136] = 11

            staff = EQUIPMENT_START + EQUIPMENT_SIZE
            data[staff:staff + 2] = bytes.fromhex("0B F4")
            data[staff + 6:staff + 8] = (190).to_bytes(2, "little")
            data[staff + 136] = 0

            parsed = parse_bytes(bytes(data), items, effects)
            self.assertEqual(["0BF4"], [item["id"] for item in parsed["currentLoadout"]])
            self.assertEqual("melee1", parsed["currentLoadout"][0]["slot"])
            self.assertIn(1, parsed["emptyLoadoutSlots"])
            self.assertNotIn("FA97", [item["id"] for item in parsed["currentLoadout"]])

    def test_parser_lists_stacked_items_with_quantity_and_official_name(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text(json.dumps({"342F": {"name": "Guardian Spirit Talisman", "type": "Usable Items"}}), encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            (base / "official_zh_cn.json").write_text(json.dumps({"items": {"342F": "守护灵呼唤符"}}, ensure_ascii=False), encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)
            data[STACKED_ITEM_START:STACKED_ITEM_START + 2] = bytes.fromhex("34 2F")
            data[STACKED_ITEM_START + 4:STACKED_ITEM_START + 6] = (17).to_bytes(2, "little")
            parsed = parse_bytes(bytes(data), items, effects)
            self.assertEqual(1, parsed["inventorySummary"]["stackedItemRecords"])
            self.assertEqual("守护灵呼唤符", parsed["inventoryItems"][0]["nameZh"])
            self.assertEqual(17, parsed["inventoryItems"][0]["quantity"])

    def test_parser_keeps_full_equipment_inventory(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text(json.dumps({"FA97": {"name": "Tsuchigumo Clawed Fists", "type": "Weapon"}}), encoding="utf-8")
            effects.write_text(json.dumps([{"id": "96D4", "Effect": "Imbue Corruption"}]), encoding="utf-8")
            (base / "official_zh_cn.json").write_text(json.dumps({"items": {"FA97": "土蜘蛛众手甲钩"}}, ensure_ascii=False), encoding="utf-8")
            (base / "official_effects_zh_cn.json").write_text(json.dumps({"effects": {"96D4": "赋予妖属性"}}, ensure_ascii=False), encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)
            data[EQUIPMENT_START:EQUIPMENT_START + 2] = bytes.fromhex("FA 97")
            data[EQUIPMENT_START + 6:EQUIPMENT_START + 8] = (190).to_bytes(2, "little")
            data[EQUIPMENT_START + 10:EQUIPMENT_START + 12] = (120).to_bytes(2, "little")
            data[EQUIPMENT_START + 20] = 5
            data[EQUIPMENT_START + 48:EQUIPMENT_START + 52] = (0x96D4).to_bytes(4, "little")
            parsed = parse_bytes(bytes(data), items, effects)
            equipment = parsed["equipmentInventory"][0]
            self.assertEqual("土蜘蛛众手甲钩", equipment["nameZh"])
            self.assertEqual(190, equipment["level"])
            self.assertEqual(120, equipment["plus"])
            self.assertEqual(["赋予妖属性"], equipment["effectsZh"])
            self.assertEqual(["96D4"], equipment["effectIds"])

    def test_parser_lists_scroll_level_attempts_and_effects(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text(json.dumps({"DEA7": {"name": "Scroll of the Damned", "type": "Scrolls"}}), encoding="utf-8")
            effects.write_text(json.dumps([{"id": "AE5A", "Effect": "Ultimate Skill"}]), encoding="utf-8")
            (base / "official_zh_cn.json").write_text(json.dumps({"items": {"DEA7": "百鬼夜行绘卷·地狱"}}, ensure_ascii=False), encoding="utf-8")
            (base / "official_effects_zh_cn.json").write_text(json.dumps({"effects": {"AE5A": "技之深奥"}}, ensure_ascii=False), encoding="utf-8")
            data = bytearray(SCROLL_START + SCROLL_SIZE)
            data[SCROLL_START:SCROLL_START + 2] = bytes.fromhex("DE A7")
            data[SCROLL_START + 6:SCROLL_START + 8] = (190).to_bytes(2, "little")
            data[SCROLL_START + 20] = 5
            data[SCROLL_START + 31] = 4
            data[SCROLL_START + 48:SCROLL_START + 52] = (0xAE5A).to_bytes(4, "little")
            parsed = parse_bytes(bytes(data), items, effects)
            scroll = parsed["scrolls"][0]
            self.assertEqual("百鬼夜行绘卷·地狱", scroll["nameZh"])
            self.assertEqual(190, scroll["level"])
            self.assertEqual(4, scroll["attemptsRemaining"])
            self.assertEqual(["技之深奥"], scroll["effectsZh"])
            self.assertEqual(["AE5A"], scroll["effectIds"])

    def test_official_chinese_catalog_contains_current_build_names(self):
        catalog = json.loads((Path(__file__).parents[1] / "data" / "official_zh_cn.json").read_text(encoding="utf-8"))
        self.assertEqual("土蜘蛛众手甲钩", catalog["items"]["FA97"])
        self.assertEqual("魔缘锡杖", catalog["items"]["0BF4"])
        self.assertEqual("崩国大炮", catalog["items"]["A9B7"])

    def test_official_chinese_effect_catalog_contains_current_build_effects(self):
        catalog = json.loads((Path(__file__).parents[1] / "data" / "official_effects_zh_cn.json").read_text(encoding="utf-8"))
        self.assertEqual("月读的恩宠", catalog["effects"]["BABD"])
        self.assertEqual("赋予妖属性", catalog["effects"]["96D4"])

    def test_verified_effect_template_overlay_covers_current_build_effects(self):
        catalog = json.loads((Path(__file__).parents[1] / "data" / "verified_effect_templates_zh_cn.json").read_text(encoding="utf-8"))
        self.assertEqual("不消耗招猫铃", catalog["effects"]["8EFF"])
        self.assertEqual("装备品掉落率（妖怪化时）", catalog["effects"]["EA77"])
        self.assertEqual("退击伤害", catalog["effects"]["55C6"])
        self.assertEqual("流影斩伤害", catalog["effects"]["218D"])
        self.assertEqual("挥茅精力伤害", catalog["effects"]["193C"])

    def test_soul_core_catalog_covers_current_sample_ids(self):
        data_root = Path(__file__).parents[1] / "data"
        catalog = json.loads((data_root / "soul_core_zh_cn.json").read_text(encoding="utf-8"))["items"]
        items = json.loads((data_root / "items.json").read_text(encoding="utf-8"))
        # The community table contains one non-16-bit anomaly (2000000000,
        # Seto Taisho). Equipment records expose 16-bit IDs, so we deliberately
        # omit that unmatchable value instead of inventing a mapping.
        self.assertEqual(78, len(catalog))
        normalized_items = {(item_id.zfill(4) if len(item_id) <= 4 else item_id): item for item_id, item in items.items()}
        self.assertTrue(all(normalized_items[item_id].get("type") == "Soul Core" for item_id in catalog))
        self.assertEqual("牛头鬼", catalog["6162"])
        self.assertEqual("黄泉丑女", catalog["4626"])

    def test_verified_variant_catalog_covers_known_accessories_and_fists(self):
        catalog = json.loads((Path(__file__).parents[1] / "data" / "verified_variant_zh_cn.json").read_text(encoding="utf-8"))["items"]
        self.assertEqual("鬼腕甲", catalog["0910"])
        self.assertEqual("发梳", catalog["864C"])
        self.assertEqual("扇子（黑）", catalog["8542"])
        self.assertEqual("扇子（白）", catalog["A7F2"])
        self.assertEqual("勾玉（白）", catalog["5F5D"])
        self.assertEqual("濑户瓢箪茶入（黄）", catalog["0677"])

    def test_parser_normalizes_short_official_item_ids(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            items = base / "items.json"
            effects = base / "effects.json"
            items.write_text(json.dumps({"529": {"name": "Divine Rice", "type": "Key Items"}}), encoding="utf-8")
            effects.write_text("[]", encoding="utf-8")
            (base / "official_zh_cn.json").write_text(json.dumps({"items": {"529": "神馔米"}}, ensure_ascii=False), encoding="utf-8")
            data = bytearray(MIN_SAVE_SIZE)
            data[STACKED_ITEM_START:STACKED_ITEM_START + 2] = bytes.fromhex("05 29")
            data[STACKED_ITEM_START + 4:STACKED_ITEM_START + 6] = (8).to_bytes(2, "little")
            parsed = parse_bytes(bytes(data), items, effects)
            self.assertEqual("0529", parsed["inventoryItems"][0]["id"])
            self.assertEqual("神馔米", parsed["inventoryItems"][0]["nameZh"])


if __name__ == "__main__":
    unittest.main()
