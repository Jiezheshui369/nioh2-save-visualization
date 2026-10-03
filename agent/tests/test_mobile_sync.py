import copy
import hashlib
import http.client
import json
import socket
import ssl
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from agent.mobile_sync import MobileSync, SyncState, TLSServer, private_ipv4, validate_archive
from agent.nioh2_agent import ApiHandler
from http.server import ThreadingHTTPServer


def archive():
    snapshot = json.loads((Path(__file__).parents[2] / "public/data/demo-snapshot.json").read_text(encoding="utf8"))
    snapshot["safety"].pop("snapshotCopySha256", None)
    return {"format": "nioh2-character-assets", "version": "1.0.0", "exportedAt": "test", "character": snapshot, "builds": []}


class MobileSyncTests(unittest.TestCase):
    def test_sparse_grade_evidence_round_trips_through_explicit_publication(self):
        value = archive()
        item = value['character']['currentLoadout'][0]
        item.update(effects=['Synthetic grade'], effectIds=['3961'], effectMagnitudes=['AA'],
                    effectValueDetails=[dict(rawValue=13, kind='grade', encoding='verified-id')])
        state = SyncState()
        state.publish(value)
        item['effectValueDetails'][0]['rawValue'] = 99
        item['effectMagnitudes'][0] = 'AAA+'
        received = state.receive(state.new_invite(), True)['archive']['character']['currentLoadout'][0]
        self.assertEqual(received['effectValueDetails'], [dict(rawValue=13, kind='grade', encoding='verified-id')])
        self.assertEqual(received['effectMagnitudes'], ['AA'])
    def test_upload_rejects_remote_control_and_oversize(self):
        handler = ApiHandler.__new__(ApiHandler)
        handler.headers = {"Content-Length": "9000000"}
        handler.pipeline_defaults = {"snapshot_workspace": Path("unused")}
        handler._json = unittest.mock.MagicMock()
        handler._desktop_sync_allowed = lambda: False
        handler._upload_save()
        self.assertEqual(403, handler._json.call_args.args[0])
        handler._desktop_sync_allowed = lambda: True
        handler._upload_save()
        self.assertEqual(400, handler._json.call_args.args[0])
    def test_only_literal_home_addresses(self):
        for value in ["10.0.1.1", "172.16.1.1", "192.168.1.3"]:
            self.assertTrue(private_ipv4(value))
        for value in ["127.0.0.1", "169.254.169.254", "8.8.8.8", "localhost", "192.168.01.1", "224.1.1.1"]:
            self.assertFalse(private_ipv4(value))

    def test_reject_unredacted_archive(self):
        value = archive()
        value["character"]["safety"]["originalMainSaveSha256"] = "private-hash"
        with self.assertRaises(ValueError): validate_archive(value)
        with self.assertRaises(ValueError): validate_archive({"format": "raw-save"})

    def test_bad_privacy_or_safety_metadata_is_rejected_without_replacing_publish(self):
        state = SyncState()
        state.publish(archive())
        revision = state.revision
        for field in ['privacy', 'safety']:
            for bad in [None, [], 'invalid', 7]:
                with self.subTest(field=field, bad=bad):
                    value = archive()
                    value['character'][field] = bad
                    with self.assertRaises(ValueError):
                        state.publish(value)
                    self.assertEqual(state.revision, revision)

    def test_single_use_and_expiry(self):
        s = SyncState(); s.publish(archive()); token = s.new_invite()
        first = s.receive(token, True)
        with self.assertRaises(PermissionError): s.receive(token, True)
        self.assertEqual(first["revision"], s.receive(first["deviceToken"], False)["revision"])
        token = s.new_invite(); s.invite_expires = 0
        with self.assertRaises(PermissionError): s.receive(token, True)
        s.session_expires = 0
        with self.assertRaises(PermissionError): s.receive(first["deviceToken"], False)

    def test_invalid_token_types_and_non_ascii_do_not_consume_invite(self):
        state = SyncState(); state.publish(archive()); token = state.new_invite()
        for invalid in (None, b'x' * 43, '', 'x' * 42, 'x' * 44, 'é' * 43, ' ' * 43, '/' * 43):
            with self.subTest(value=type(invalid).__name__):
                with self.assertRaises(PermissionError):
                    state.receive(invalid, True)
                self.assertEqual(state.invite, token)
        self.assertTrue(state.receive(token, True)['deviceToken'])

    def test_tls_rejects_ambiguous_headers_without_consuming_invite(self):
        sync = MobileSync(0)
        with patch('agent.mobile_sync.TLSServer', side_effect=lambda addr, handler: TLSServer(('127.0.0.1', 0), handler)):
            sync.start(archive(), ['192.168.1.2'])
        try:
            port = sync.server.server_port
            cert = ssl.get_server_certificate(('127.0.0.1', port))
            context = ssl.create_default_context(cadata=cert)
            context.check_hostname = False  # Isolated loopback harness, NOT production trust.
            token = sync.state.new_invite()
            good_auth = ('Authorization', 'Bearer ' + token)
            no_body = ('Content-Length', '0')
            cases = [
                (401, [('Authorization', token), no_body]),
                (401, [('Authorization', 'Basic ' + token), no_body]),
                (401, [('Authorization', 'Bearer ' + 'é' * 43), no_body]),
                (401, [good_auth, good_auth, no_body]),
                (400, [good_auth, no_body, no_body]),
                (400, [good_auth]),
                (400, [good_auth, ('Content-Length', '00')]),
                (400, [good_auth, no_body, ('Transfer-Encoding', '')]),
            ]
            for expected, headers in cases:
                with self.subTest(expected=expected, headers=[key for key, _ in headers]):
                    conn = http.client.HTTPSConnection('127.0.0.1', port, context=context, timeout=5)
                    try:
                        conn.putrequest('POST', '/v1/pair')
                        for key, value in headers: conn.putheader(key, value)
                        conn.endheaders()
                        response = conn.getresponse()
                        self.assertEqual(response.status, expected)
                        self.assertNotIn(token, response.read().decode())
                    finally: conn.close()
                    self.assertEqual(sync.state.invite, token)
            self.assertTrue(sync.state.receive(token, True)['deviceToken'])
        finally: sync.stop()

    def test_publish_is_explicit_and_invalid_publish_keeps_previous(self):
        s = SyncState(); a = archive(); s.publish(a); token = s.new_invite()
        device = s.receive(token, True)["deviceToken"]
        before = s.revision
        a["character"]["character"]["level"] = 321
        self.assertNotEqual(321, s.receive(device, False)["archive"]["character"]["character"]["level"])
        s.publish(a)
        self.assertNotEqual(before, s.revision)
        with self.assertRaises(ValueError): s.publish({})
        self.assertEqual(321, s.receive(device, False)["archive"]["character"]["character"]["level"])

    def test_publish_resets_old_read_time_and_exposes_current_source(self):
        sync = MobileSync(0)
        sync.state = SyncState()
        first = archive()
        sync.state.publish(first)
        device = sync.state.receive(sync.state.new_invite(), True)["deviceToken"]
        self.assertIsNotNone(sync.status()["lastSent"])
        second = copy.deepcopy(first)
        second["character"]["snapshotId"] = "another-synthetic-source"
        sync.state.publish(second)
        status = sync.status()
        self.assertIsNone(status["lastSent"])
        self.assertIsNotNone(status["publishedAt"])
        self.assertEqual("another-synthetic-source", status["publishedSnapshotId"])
        sync.state.receive(device, False)
        self.assertIsNotNone(sync.status()["lastSent"])
        with self.assertRaises(ValueError):
            sync.state.publish({})
        self.assertEqual(status["revision"], sync.status()["revision"])
        self.assertIsNotNone(sync.status()["lastSent"])

    def test_tls_pair_pull_routes_and_stop(self):
        sync = MobileSync(0)
        # Test listener stays on loopback; production only binds after desktop opt-in.
        with patch("agent.mobile_sync.TLSServer", side_effect=lambda addr, handler: TLSServer(("127.0.0.1", 0), handler)):
            sync.start(archive(), ["192.168.1.2"])
        try:
            port = sync.server.server_port
            cert = ssl.get_server_certificate(("127.0.0.1", port))
            der = ssl.PEM_cert_to_DER_cert(cert)
            self.assertEqual(hashlib.sha256(der).hexdigest(), sync.fingerprint)
            context = ssl.create_default_context(cadata=cert)
            context.check_hostname = False  # Test connects via loopback, cert SAN is the LAN IP.
            def request(path, token):
                conn = http.client.HTTPSConnection("127.0.0.1", port, context=context, timeout=5)
                conn.request("POST", path, body=b"", headers={"Authorization": "Bearer " + token})
                response = conn.getresponse(); data = json.loads(response.read()); status = response.status; conn.close()
                return status, data
            self.assertEqual(401, request("/v1/pull", "x"*43)[0])
            status, data = request("/v1/pair", sync.state.new_invite())
            self.assertEqual(200, status)
            self.assertEqual(200, request("/v1/pull", data["deviceToken"])[0])
            self.assertEqual(404, request("/api/sources", data["deviceToken"])[0])
            self.assertEqual(404, request("/api/refresh", data["deviceToken"])[0])
        finally:
            sync.stop()
        self.assertFalse(sync.status()["enabled"])

    def test_desktop_control_rejects_cross_origin_and_rebinding(self):
        handler = type("TestApi", (ApiHandler,), {"mobile_sync": MobileSync(0)})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            def status(headers):
                c = http.client.HTTPConnection("127.0.0.1", server.server_port)
                c.request("POST", "/api/mobile-sync/status", body=b"{}", headers=headers)
                r = c.getresponse(); r.read(); result = r.status; c.close(); return result
            self.assertEqual(403, status({}))
            self.assertEqual(403, status({"X-Nioh2-Desktop-Sync": "1", "Origin": "https://evil.example"}))
            self.assertEqual(403, status({"X-Nioh2-Desktop-Sync": "1", "Host": "evil.example"}))
            self.assertEqual(200, status({"X-Nioh2-Desktop-Sync": "1"}))
        finally:
            server.shutdown(); server.server_close()
