"""Synthetic HTTP/copy tests: never read or modify a player's game save."""
import http.client
import io
import json
import tempfile
import threading
import unittest
from email.message import Message
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

from agent.nioh2_agent import ApiHandler


class DesktopImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nioh-import-test-")
        self.root = Path(self.temp.name)
        self.handler_type = type("TestImportHandler", (ApiHandler,), {
            "store": self.root / "store", "pipeline_defaults": {"snapshot_workspace": self.root / "copies"},
            "pipeline_config": {"source": self.root / "synthetic-source"},
            "refresh_lock": threading.Lock(), "log_message": lambda *args: None,
        })
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler_type)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.pipeline_patch = patch("agent.nioh2_agent.run_pipeline")
        self.pipeline = self.pipeline_patch.start()

    def tearDown(self):
        self.pipeline_patch.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def post(self, headers, body=b"", path="/api/import-save"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.putrequest("POST", path)
            connection.putheader("X-Nioh2-Desktop-Sync", "1")
            for name, value in headers:
                connection.putheader(name, value)
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_ambiguous_or_unbounded_upload_never_reaches_parser(self):
        for headers in (
            [], [("Content-Length", "-1")], [("Content-Length", "+1000000")],
            [("Content-Length", "01000000")], [("Content-Length", "1000000, 1000000")],
            [("Content-Length", "1000000"), ("Content-Length", "1000000")],
            [("Content-Length", "1000000"), ("Transfer-Encoding", "")],
            [("Content-Length", "1000000"), ("Transfer-Encoding", "chunked")],
            [("Content-Length", "999999")], [("Content-Length", "8388609")],
            [("Content-Length", "9" * 100)],
        ):
            with self.subTest(headers=headers):
                status, payload = self.post(headers)
                self.assertEqual(400, status)
                self.assertIn("error", payload)
                self.assertFalse(self.handler_type.refresh_lock.locked())
        self.pipeline.assert_not_called()

    def test_duplicate_or_foreign_control_headers_never_reach_parser(self):
        host = f"127.0.0.1:{self.server.server_port}"
        for headers in (
            [("Host", host)], [("X-Nioh2-Desktop-Sync", "1")],
            [("Origin", f"http://{host}"), ("Origin", f"http://{host}")],
            [("Origin", "https://untrusted.example")],
        ):
            with self.subTest(headers=headers):
                status, _ = self.post(headers + [("Content-Length", "1000000")])
                self.assertEqual(403, status)
        self.pipeline.assert_not_called()

    def test_refresh_rejects_bad_lengths_without_hanging_or_parsing(self):
        for headers in (
            [("Content-Length", "-1")], [("Content-Length", "word")],
            [("Content-Length", "4097")],
            [("Content-Length", "0"), ("Content-Length", "0")],
            [("Transfer-Encoding", "")],
        ):
            with self.subTest(headers=headers):
                status, _ = self.post(headers, path="/api/refresh")
                self.assertEqual(400, status)
        status, _ = self.post([("Content-Length", "2")], b"[]", path="/api/refresh")
        self.assertEqual(400, status)
        self.pipeline.assert_not_called()

    def test_failed_source_switch_preserves_previous_selection(self):
        previous = self.handler_type.pipeline_config
        self.handler_type.source_options = {"source-new": self.root / "new-copy"}
        self.pipeline.side_effect = ValueError("synthetic failure")
        body = b'{"sourceId":"source-new"}'
        status, _ = self.post([("Content-Length", str(len(body)))], body, path="/api/refresh")
        self.assertEqual(500, status)
        self.assertIs(previous, self.handler_type.pipeline_config)
        self.assertFalse(self.handler_type.refresh_lock.locked())

    def test_refresh_requires_local_marker_or_explicit_legacy_token(self):
        host = f"127.0.0.1:{self.server.server_port}"
        for headers in ({}, {"Origin": "https://untrusted.example"},
                        {"X-Nioh2-Desktop-Sync": "1", "Host": "untrusted.example"},
                        {"X-Nioh2-Desktop-Sync": "1", "Origin": "https://untrusted.example"}):
            with self.subTest(headers=headers):
                connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
                try:
                    connection.request("POST", "/api/refresh", b"{}", headers)
                    response = connection.getresponse()
                    self.assertEqual(403, response.status)
                    response.read()
                finally:
                    connection.close()
        self.pipeline.assert_not_called()
        handler = self.handler_type.__new__(self.handler_type)
        handler.access_token = "synthetic-secret"
        handler._desktop_sync_allowed = lambda: False
        for token, origin, expected in (("synthetic-secret", f"http://{host}", True),
                                         ("wrong", f"http://{host}", False),
                                         ("synthetic-secret", "https://untrusted.example", False)):
            handler.headers = Message()
            handler.headers["Host"] = host
            handler.headers["Origin"] = origin
            handler.headers["X-Nioh2-Token"] = token
            self.assertEqual(expected, handler._refresh_allowed())
        handler.headers["X-Nioh2-Token"] = "synthetic-secret"
        self.assertFalse(handler._refresh_allowed())

    def test_mobile_control_rejects_ambiguous_or_non_object_body_without_mutation(self):
        sync = MagicMock()
        self.handler_type.mobile_sync = sync
        for headers, body in (
            ([("Content-Length", "0"), ("Content-Length", "0")], b""),
            ([("Content-Length", "0"), ("Transfer-Encoding", "")], b""),
            ([("Content-Length", "2")], b"[]"),
            ([("Content-Length", "4")], b"null"),
        ):
            with self.subTest(headers=headers, body=body):
                status, _ = self.post(headers, body, path="/api/mobile-sync/stop")
                self.assertEqual(400, status)
        sync.stop.assert_not_called()
        sync.control_lock.__enter__.assert_not_called()

    def test_upload_stages_exact_copy_and_cleans_it_after_success(self):
        body = b"synthetic-only" * 80000
        output = self.root / "result.json"
        output.write_text('{"snapshotId":"synthetic-upload"}', encoding="utf8")
        staged_paths = []

        def analyse(**kwargs):
            source = kwargs["source"]
            staged_paths.append(source)
            self.assertEqual("SAVEDATA.BIN", source.name)
            self.assertEqual(body, source.read_bytes())
            self.assertEqual(self.root / "store", kwargs["store"])
            return output

        self.pipeline.side_effect = analyse
        # Bad optional browser mtime must not reject otherwise valid data.
        status, payload = self.post([("Content-Length", str(len(body))), ("X-Nioh2-Modified", "not-a-number")], body)
        self.assertEqual(200, status)
        self.assertEqual("desktop-file-copy", payload["inputMethod"])
        self.assertEqual("synthetic-upload", payload["snapshotId"])
        self.assertFalse(staged_paths[0].exists())
        self.assertFalse(self.handler_type.refresh_lock.locked())

    def test_parser_failure_releases_lock_and_removes_only_staging(self):
        body = b"x" * 1_000_000
        staged_paths = []

        def fail(**kwargs):
            staged_paths.append(kwargs["source"])
            raise ValueError("合成数据解析失败")

        self.pipeline.side_effect = fail
        for _ in range(2):
            status, payload = self.post([("Content-Length", str(len(body)))], body)
            self.assertEqual(400, status)
            self.assertIn("合成数据解析失败", payload["error"])
            self.assertFalse(self.handler_type.refresh_lock.locked())
        self.assertEqual(2, self.pipeline.call_count)
        self.assertTrue(all(not path.exists() for path in staged_paths))

    def test_busy_upload_does_not_start_second_parser(self):
        self.handler_type.refresh_lock.acquire()
        try:
            status, _ = self.post([("Content-Length", "1000000")])
            self.assertEqual(409, status)
            self.assertTrue(self.handler_type.refresh_lock.locked())
            self.pipeline.assert_not_called()
        finally:
            self.handler_type.refresh_lock.release()

    def test_truncation_and_timeout_never_start_parser_and_allow_retry(self):
        for stream in (io.BytesIO(b"truncated"), MagicMock(read=MagicMock(side_effect=TimeoutError))):
            with self.subTest(stream=type(stream).__name__):
                handler = self.handler_type.__new__(self.handler_type)
                handler.headers = Message()
                handler.headers["Content-Length"] = "1000000"
                handler._desktop_sync_allowed = lambda: True
                handler._json = MagicMock()
                handler.connection = MagicMock()
                handler.rfile = stream
                handler._upload_save()
                self.assertEqual(400, handler._json.call_args.args[0])
                self.assertIn("尚未开始解析", handler._json.call_args.args[1]["error"])
                self.assertFalse(self.handler_type.refresh_lock.locked())
        self.pipeline.assert_not_called()


if __name__ == "__main__":
    unittest.main()
