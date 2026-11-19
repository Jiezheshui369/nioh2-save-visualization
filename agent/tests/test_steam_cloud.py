"""Synthetic HTTP fixtures only; passing these tests proves no live Steam access."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from agent import steam_cloud as cloud

CONFIG = cloud.CloudConfig("synthetic-valve-client", (cloud.APP_ID,), ("read_cloud",), True)
TOKEN = "synthetic-secret-not-a-live-token"
BLOB = b"synthetic-encrypted-cloud-file"


def file(name="account/SAVEDATA00/SAVEDATA.BIN", blob=BLOB, **changes):
    return {"appid": cloud.APP_ID, "filename": name, "file_size": len(blob),
            "timestamp": 1700000000, "file_sha": hashlib.sha1(blob).hexdigest(),
            "url": "https://cloud.steamusercontent.com/synthetic?signature=private", **changes}


def page(rows, total=None, status=200, headers=None):
    return cloud.Reply(status, {"x-eresult": "1"} if headers is None else headers,
                       json.dumps({"response": {"files": rows, "total_files": len(rows) if total is None else total}}).encode())


def synthetic_container(size):
    data=bytearray(size)
    data[:8]=b'NIOHUSR\0'
    data[8:12]=(0x21030200).to_bytes(4,'little')
    data[0x14:0x18]=(0x148).to_bytes(4,'little')
    data[0x18:0x1C]=(size-0x148).to_bytes(4,'little')
    return data


class SteamCloudTests(unittest.TestCase):
    def test_missing_configuration_never_calls_transport(self):
        get = MagicMock()
        for config, token in [(None, None), (CONFIG, None),
                (cloud.CloudConfig("client", (1,), ("read_cloud",), True), TOKEN),
                (cloud.CloudConfig("client", (cloud.APP_ID,), ("write_cloud",), True), TOKEN),
                (cloud.CloudConfig("client", (cloud.APP_ID,), ("read_cloud",), False), TOKEN)]:
            with self.subTest(config=config), self.assertRaises(cloud.CloudError):
                cloud.SteamCloudClient(config, token, get)
        get.assert_not_called()
        self.assertEqual("configured_unverified", cloud.readiness(CONFIG, TOKEN)["status"])
        self.assertFalse(cloud.readiness(CONFIG, TOKEN)["livePullVerified"])
        self.assertIn("valve_client_approval", cloud.readiness(cloud.CloudConfig("", (cloud.APP_ID,), ("read_cloud",), True), TOKEN)["missing"])

    def test_configuration_rejects_secrets_and_wrong_types(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.json"
            self.assertIsNone(cloud.CloudConfig.load(path))
            base = {"client_id": "test", "app_ids": [cloud.APP_ID], "permissions": ["read_cloud"],
                    "valve_approval_confirmed": True}
            path.write_text(json.dumps(base))
            self.assertEqual(cloud.APP_ID, cloud.CloudConfig.load(path).app_ids[0])
            for value in [{**base, "access_token": TOKEN}, {**base, "valve_approval_confirmed": "true"},
                          {**base, "app_ids": [True]}, []]:
                path.write_text(json.dumps(value))
                with self.assertRaises(cloud.CloudError) as caught:
                    cloud.CloudConfig.load(path)
                self.assertNotIn(TOKEN, str(caught.exception))

    def test_official_get_parameters_and_pagination(self):
        get = MagicMock(side_effect=[page([file()], 2), page([file("account/SAVEDATA00/BACKUP.BIN")], 2)])
        result = cloud.SteamCloudClient(CONFIG, TOKEN, get).enumerate_files(count=1)
        self.assertEqual(2, len(result))
        for index, call in enumerate(get.call_args_list):
            url, limit = call.args
            self.assertTrue(url.startswith(cloud.ENUMERATE_URL))
            query = parse_qs(urlsplit(url).query)
            self.assertEqual([str(index)], query["start_index"])
            self.assertEqual([str(cloud.APP_ID)], query["appid"])
            self.assertEqual(["1"], query["extended_details"])
            self.assertEqual([TOKEN], query["access_token"])
            self.assertEqual(cloud.MAX_JSON_BYTES, limit)

    def test_http_200_requires_success_eresult(self):
        for response in [page([], headers={}), page([], headers={"x-eresult": "15"}),
                         page([], headers={"x-eresult": "27"}), page([], status=401),
                         page([], status=403), page([], status=503)]:
            with self.subTest(reply=response), self.assertRaises(cloud.CloudError):
                cloud.SteamCloudClient(CONFIG, TOKEN, lambda *_: response).enumerate_files()

    def test_empty_account_is_valid_but_cannot_pull_slot(self):
        client = cloud.SteamCloudClient(CONFIG, TOKEN, lambda *_: page([]))
        self.assertEqual([], client.enumerate_files())
        with self.assertRaisesRegex(cloud.CloudError, "唯一主存档"):
            cloud.select_slot([], "SAVEDATA00")

    def test_invalid_or_nonprogressing_pages_are_rejected(self):
        fixtures = [[page([], 1)], [page([file()], 2), page([file()], 2)],
                    [page([file()], 2), page([], 3)], [page([file()], 0)],
                    [cloud.Reply(200, {"x-eresult": "1"}, b"not-json")]]
        for replies in fixtures:
            with self.subTest(replies=replies), self.assertRaises(cloud.CloudError):
                cloud.SteamCloudClient(CONFIG, TOKEN, MagicMock(side_effect=replies)).enumerate_files(count=1)

    def test_unsafe_paths_metadata_and_download_urls_are_rejected(self):
        for changes in [{"filename": "../SAVEDATA00/SAVEDATA.BIN"}, {"filename": "C:/SAVEDATA.BIN"},
                {"filename": "SAVEDATA00\\SAVEDATA.BIN"}, {"appid": 1}, {"file_size": True},
                {"file_size": cloud.MAX_FILE_BYTES + 1}, {"timestamp": -1}, {"file_sha": "nope"},
                {"url": "http://cloud.steamusercontent.com/a"}, {"url": "https://127.0.0.1/a"},
                {"url": "https://steamusercontent.com.evil.example/a"},
                {"url": "https://name:secret@cloud.steamusercontent.com/a"},
                {"url": "https://cloud.steamusercontent.com:444/a"}]:
            with self.subTest(changes=changes), self.assertRaises(cloud.CloudError):
                cloud.CloudFile.parse(file(**changes))

    def test_no_redirects_and_transport_errors_are_redacted(self):
        with self.assertRaises(cloud.CloudError):
            cloud.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")
        with patch.object(cloud, "build_opener") as builder:
            builder.return_value.open.side_effect = OSError("leaked " + TOKEN)
            with self.assertRaises(cloud.CloudError) as caught:
                cloud.https_get(cloud.ENUMERATE_URL + "?access_token=" + TOKEN, 10)
            self.assertNotIn(TOKEN, str(caught.exception))
        with patch.object(cloud, "build_opener") as builder:
            response = builder.return_value.open.return_value.__enter__.return_value
            response.read.return_value = b"too many bytes"
            with self.assertRaises(cloud.CloudError) as caught:
                cloud.https_get("https://cloud.steamusercontent.com/a", 1)
            self.assertEqual("response_too_large", caught.exception.code)

    def test_download_requires_exact_length_and_hash_without_token(self):
        entry = cloud.CloudFile.parse(file())
        get = MagicMock(return_value=cloud.Reply(200, {}, BLOB))
        client = cloud.SteamCloudClient(CONFIG, TOKEN, get)
        self.assertEqual(BLOB, client.download(entry))
        self.assertNotIn(TOKEN, get.call_args.args[0])
        for blob in [b"bad", b"x" * len(BLOB)]:
            get.return_value = cloud.Reply(200, {}, blob)
            with self.assertRaises(cloud.CloudError):
                client.download(entry)

    def test_manual_slot_selection_rejects_ambiguity(self):
        rows = [cloud.CloudFile.parse(file()), cloud.CloudFile.parse(file("other/SAVEDATA00/SAVEDATA.BIN"))]
        with self.assertRaises(cloud.CloudError):
            cloud.select_slot(rows, "SAVEDATA00")
        with self.assertRaises(cloud.CloudError):
            cloud.select_slot(rows[:1], "../SAVEDATA00")
        self.assertEqual(rows[:1], cloud.select_slot(rows[:1], "SAVEDATA00"))

    def test_cross_directory_backup_is_rejected_before_download_or_write(self):
        rows = [file(), file("other/SAVEDATA00/BACKUP.BIN")]
        get = MagicMock(return_value=page(rows))
        client = cloud.SteamCloudClient(CONFIG, TOKEN, get)
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            workspace = project / ".local/raw"
            with self.assertRaises(cloud.CloudError) as caught:
                cloud.pull_snapshot(client, "SAVEDATA00", workspace, project)
            self.assertEqual("ambiguous_slot", caught.exception.code)
            self.assertFalse(workspace.exists())
            get.assert_called_once()
            self.assertTrue(get.call_args.args[0].startswith(cloud.ENUMERATE_URL))

    def test_committed_download_manifest_is_private_and_parser_compatible(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            rows = [file(), file("account/SAVEDATA00/BACKUP.BIN")]
            get = MagicMock(side_effect=[page(rows), cloud.Reply(200, {}, BLOB), cloud.Reply(200, {}, BLOB), page(rows)])
            client = cloud.SteamCloudClient(CONFIG, TOKEN, get)
            path = cloud.pull_snapshot(client, "SAVEDATA00", project / ".local/raw", project)
            raw = (path / "snapshot-manifest.json").read_text()
            for private in (TOKEN, "signature", "steamusercontent", "account/"):
                self.assertNotIn(private, raw)
            self.assertFalse((path / ".incomplete").exists())
            from agent.nioh2_agent import _verify_snapshot_manifest
            manifest = _verify_snapshot_manifest(path)
            self.assertFalse(manifest["policy"]["writeBackSupported"])
            self.assertEqual(hashlib.sha256(BLOB).hexdigest().upper(), manifest["files"][0]["copy_sha256"])

    def test_cloud_changes_or_corruption_never_commit_or_touch_previous(self):
        for replies in [[page([file()]), cloud.Reply(200, {}, b"bad")],
                [page([file()]), cloud.Reply(200, {}, BLOB), page([file(timestamp=1700000001)])],
                [page([file()]), cloud.Reply(200, {}, BLOB), page([], status=403)]]:
            with self.subTest(replies=replies), tempfile.TemporaryDirectory() as temp:
                project = Path(temp)
                root = project / ".local/raw"
                root.mkdir(parents=True)
                old = root / "old.json"
                old.write_bytes(b"previous-good-offline-snapshot")
                client = cloud.SteamCloudClient(CONFIG, TOKEN, MagicMock(side_effect=replies))
                with self.assertRaises(cloud.CloudError):
                    cloud.pull_snapshot(client, "SAVEDATA00", root, project)
                self.assertEqual(b"previous-good-offline-snapshot", old.read_bytes())
                self.assertFalse(list(root.glob("*/snapshot-manifest.json")))
                self.assertEqual(1, len(list(root.glob("*/.incomplete"))))

    def test_game_destination_is_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            client = MagicMock()
            for workspace in [project, project / "Savedata", project / ".local/../Savedata"]:
                with self.subTest(workspace=workspace), self.assertRaises(cloud.CloudError):
                    cloud.pull_snapshot(client, "SAVEDATA00", workspace, project)
            client.enumerate_files.assert_not_called()

    def test_directory_link_cannot_redirect_downloads_to_save_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            outside = project / "original-game-saves"
            outside.mkdir()
            (project / ".local").mkdir()
            linked = project / ".local/linked"
            if os.name == "nt":
                result = subprocess.run(["cmd", "/c", "mklink", "/J", str(linked), str(outside)], capture_output=True)
                self.assertEqual(0, result.returncode)
            else:
                linked.symlink_to(outside, target_is_directory=True)
            try:
                with self.assertRaises(cloud.CloudError):
                    cloud.cloud_root(project, linked / "raw")
                self.assertEqual([], list(outside.iterdir()))
            finally:
                # Unlink only this exact test link; do not recursively delete its target.
                if os.name == "nt":
                    linked.rmdir()
                else:
                    linked.unlink()

    def test_failed_disk_write_keeps_incomplete_marker_and_no_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            get = MagicMock(side_effect=[page([file()]), cloud.Reply(200, {}, BLOB)])
            original_open = Path.open

            def fail_save(path, *args, **kwargs):
                if path.name == "SAVEDATA.BIN" and args == ("xb",):
                    raise OSError("synthetic-disk-full")
                return original_open(path, *args, **kwargs)

            with patch.object(Path, "open", fail_save), self.assertRaises(OSError):
                cloud.pull_snapshot(cloud.SteamCloudClient(CONFIG, TOKEN, get), "SAVEDATA00", project / ".local/raw", project)
            self.assertFalse(list((project / ".local/raw").glob("*/snapshot-manifest.json")))
            self.assertEqual(1, len(list((project / ".local/raw").glob("*/.incomplete"))))

    def test_synthetic_download_bridge_runs_actual_copy_hash_and_parser(self):
        from agent.parser import MIN_SAVE_SIZE
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            rows = [file()]
            get = MagicMock(side_effect=[page(rows), cloud.Reply(200, {}, BLOB), page(rows)])
            snapshot = cloud.pull_snapshot(cloud.SteamCloudClient(CONFIG, TOKEN, get), "SAVEDATA00", project / ".local/raw", project)
            local = project / ".local"
            decryptor = local / "runtime/decryptor.exe"
            decryptor.parent.mkdir()
            decryptor.write_bytes(b"synthetic-executable-placeholder")
            items, effects = local / "items.json", local / "effects.json"
            items.write_text("{}")
            effects.write_text("[]")
            data = synthetic_container(MIN_SAVE_SIZE)
            data[0x7B8D8:0x7B8DC] = (321).to_bytes(4, "little")

            def decrypt(command, **kwargs):
                self.assertEqual(["-m", "d", "-g", "nioh2"], command[1:5])
                output = decryptor.parent / "_OUTPUT/new/SAVEDATA.BIN"
                output.parent.mkdir(parents=True)
                output.write_bytes(data)
                return subprocess.CompletedProcess(command, 0, "", "")

            options = dict(snapshot_workspace=local / "copies", store=local / "store",
                           decryptor=decryptor, items_path=items, effects_path=effects)
            with patch("agent.nioh2_agent.wait_until_stable"), patch("agent.nioh2_agent.subprocess.run", side_effect=decrypt):
                output = cloud.parse_cloud_snapshot(snapshot, project, **options)
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(321, result["character"]["gold"])
            self.assertEqual(BLOB, (snapshot / "SAVEDATA00/SAVEDATA.BIN").read_bytes())
            (snapshot / "SAVEDATA00/SAVEDATA.BIN").write_bytes(b"tampered")
            with self.assertRaises((cloud.CloudError, RuntimeError)):
                cloud.parse_cloud_snapshot(snapshot, project, **options)

    def test_cli_missing_permissions_and_errors_never_echo_token(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {cloud.TOKEN_ENV: TOKEN}):
            config = Path(temp) / "missing.json"
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(0, cloud.main(["status", "--config", str(config)]))
                self.assertEqual(1, cloud.main(["pull", "--config", str(config), "--slot", "SAVEDATA00"]))
            self.assertIn("configuration_missing", stdout.getvalue())
            self.assertNotIn(TOKEN, stdout.getvalue() + stderr.getvalue())

    def test_change_before_pipeline_copy_cannot_become_new_accepted_revision(self):
        from agent.nioh2_agent import snapshot_save
        from agent.parser import MIN_SAVE_SIZE
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            get = MagicMock(side_effect=[page([file()]), cloud.Reply(200, {}, BLOB), page([file()])])
            snapshot = cloud.pull_snapshot(cloud.SteamCloudClient(CONFIG, TOKEN, get), "SAVEDATA00", project / ".local/raw", project)
            local = project / ".local"
            decryptor = local / "runtime/decryptor.exe"
            decryptor.parent.mkdir()
            decryptor.write_bytes(b"synthetic")
            items, effects = local / "items.json", local / "effects.json"
            items.write_text("{}")
            effects.write_text("[]")
            store = local / "store"
            store.mkdir()
            previous = store / "previous.json"
            previous.write_bytes(b"previous-good-offline-snapshot")

            def changed_copy(source, workspace):
                (source / "SAVEDATA.BIN").write_bytes(b"changed-before-pipeline-capture")
                return snapshot_save(source, workspace)

            def decrypt(command, **kwargs):
                output = decryptor.parent / "_OUTPUT/new/SAVEDATA.BIN"
                output.parent.mkdir(parents=True)
                output.write_bytes(synthetic_container(MIN_SAVE_SIZE))
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch("agent.nioh2_agent.wait_until_stable"), patch("agent.nioh2_agent.snapshot_save", side_effect=changed_copy), patch("agent.nioh2_agent.subprocess.run", side_effect=decrypt):
                with self.assertRaises(cloud.CloudError) as caught:
                    cloud.parse_cloud_snapshot(snapshot, project, snapshot_workspace=local / "copies", store=store,
                                               decryptor=decryptor, items_path=items, effects_path=effects)
            self.assertEqual("cloud_copy_changed", caught.exception.code)
            self.assertEqual([previous], list(store.iterdir()))
            self.assertEqual(b"previous-good-offline-snapshot", previous.read_bytes())


if __name__ == "__main__":
    unittest.main()
