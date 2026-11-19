"""Native account HTTP boundary tests; no sockets, login, credentials or saves."""
import unittest
from unittest.mock import Mock
from email.message import Message
from types import SimpleNamespace

from agent.nioh2_agent import ApiHandler


class NativeAccountApiTests(unittest.TestCase):
    def handler(self, *, origin="http://127.0.0.1:13254", client="127.0.0.1"):
        h = object.__new__(ApiHandler)
        h.headers = Message()
        h.headers["Host"] = "127.0.0.1:13254"
        h.headers["X-Nioh2-Desktop-Sync"] = "1"
        if origin is not None:
            h.headers["Origin"] = origin
        h.client_address = (client, 9000)
        h.server = SimpleNamespace(server_port=13254)
        h.path = "/api/native-auth/status"
        h.command = "GET"
        h._json = Mock()
        h._request_body = Mock(return_value=b"")
        h.native_auth = Mock()
        h.native_auth.status.return_value = {"state": "signed-out", "error": None}
        return h

    def test_status_only_no_token_or_identity(self):
        h = self.handler()
        h._native_account("status")
        h._json.assert_called_once_with(200, {"state": "signed-out", "error": None})
        h.native_auth.start_login.assert_not_called()

    def test_actions_require_local_same_origin_custom_header(self):
        for case in ("cross-origin", "lan", "missing-header", "duplicate-host", "query"):
            with self.subTest(case=case):
                h = self.handler(origin="https://attacker.invalid" if case == "cross-origin" else "http://127.0.0.1:13254",
                                 client="192.168.1.2" if case == "lan" else "127.0.0.1")
                h.command = "POST"
                if case == "missing-header":
                    del h.headers["X-Nioh2-Desktop-Sync"]
                if case == "duplicate-host":
                    h.headers["Host"] = "127.0.0.1:13254"
                if case == "query":
                    h.path += "?code=must-not-process"
                h._native_account("login")
                self.assertEqual(403, h._json.call_args.args[0])
                h.native_auth.start_login.assert_not_called()

    def test_unavailable_outside_native_window(self):
        h = self.handler()
        h.native_auth = None
        h._native_account("status")
        self.assertEqual(503, h._json.call_args.args[0])

    def test_action_dispatch_and_exception_redaction(self):
        for action, method in (("login", "start_login"), ("cancel", "cancel"), ("logout", "logout")):
            h = self.handler()
            h.command = "POST"
            h._native_account(action)
            getattr(h.native_auth, method).assert_called_once_with()
            h._json.assert_called_once_with(200, h.native_auth.status.return_value)
        h = self.handler()
        h.command = "POST"
        h.native_auth.start_login.side_effect = RuntimeError("secret-token-synthetic")
        h._native_account("login")
        h._json.assert_called_once_with(400, {"error": "native_account_failed"})

    def test_body_rejection_does_not_start_login(self):
        h = self.handler()
        h.command = "POST"
        h._request_body.side_effect = ValueError("invalid_body")
        h._native_account("login")
        h.native_auth.start_login.assert_not_called()
        self.assertEqual(400, h._json.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
