import unittest
import os
import threading
import time
import urllib.parse
import urllib.request
import types
import json
import base64
from unittest.mock import patch

from agent.native_auth import NativeAuth, AuthFailure, ISSUER, CLIENT_ID, AUDIENCE, verify_tokens


class NativeAuthTest(unittest.TestCase):
    def callback(self, query='state=good&code=synthetic', host=None, path='/oauth/callback'):
        return NativeAuth._callback(path + '?' + query, host or ['127.0.0.1:13255'], 'good')

    def test_valid_code(self):
        self.assertEqual(self.callback(), 'synthetic')

    def test_duplicate_and_missing_state(self):
        for query in ('state=good&state=bad&code=c', 'code=c', 'state=bad&code=c', 'state=good&code=c&code=d', 'state=%E4%B8%AD&code=c'):
            with self.subTest(query=query), self.assertRaises(AuthFailure):
                self.callback(query)

    def test_host_path_issuer(self):
        for host in (['localhost:13255'], ['evil.test'], ['127.0.0.1:13255', 'evil.test']):
            with self.assertRaises(AuthFailure):
                self.callback(host=host)
        for path in ('/wrong', 'http://127.0.0.1:13255/oauth/callback'):
            with self.assertRaises(AuthFailure):
                self.callback(path=path)
        with self.assertRaises(AuthFailure):
            self.callback('state=good&code=c&iss=https://evil.test/')

    def test_cancelled_and_ambiguous_callback(self):
        self.assertIsNone(self.callback('state=good&error=access_denied&error_description=private'))
        with self.assertRaises(AuthFailure):
            self.callback('state=good&code=c&error=access_denied')

    def test_logout_state_and_path(self):
        self.assertEqual(NativeAuth._callback('/oauth/logout/callback?state=good', ['127.0.0.1:13255'], 'good', True), 'logout')
        with self.assertRaises(AuthFailure):
            NativeAuth._callback('/oauth/logout/callback?state=bad', ['127.0.0.1:13255'], 'good', True)

    def test_status_allowlist_and_cancel_erases(self):
        auth = NativeAuth()
        auth._tokens = {'access_token': 'secret'}
        auth._state, auth._expires = 'signed-in', 9999999999
        self.assertEqual(auth.status(), {'state': 'signed-in'})
        before = auth._generation
        self.assertEqual(auth.cancel(), {'state': 'signed-out'})
        self.assertIsNone(auth._tokens)
        self.assertGreater(auth._generation, before)

    def test_expired_tokens_erased(self):
        auth = NativeAuth()
        auth._tokens, auth._state = {'access_token': 'secret'}, 'signed-in'
        self.assertEqual(auth.status(), {'state': 'signed-out'})
        self.assertIsNone(auth._tokens)

    def test_token_claim_boundary_with_injected_jose(self):
        # Signature crypto is Authlib's responsibility; exercise our surrounding
        # native claim policy without substituting a production verifier.
        header = base64.urlsafe_b64encode(json.dumps({'alg': 'RS256'}).encode()).rstrip(b'=').decode()
        tokens = {'id_token': header + '.id.signature', 'access_token': header + '.access.signature', 'token_type': 'Bearer'}
        now = int(time.time())
        identity = dict(iss=ISSUER, aud=CLIENT_ID, sub='synthetic', exp=now + 100, iat=now, auth_time=now, nonce='nonce')
        access = dict(iss=ISSUER, aud=AUDIENCE, sub='synthetic', exp=now + 100, iat=now, azp=CLIENT_ID, scope='relay:connect')
        class Claims(dict):
            def validate(self, **kwargs):
                pass
        class Jwt:
            def __init__(self, algorithms):
                self.algorithms = algorithms
            def decode(self, raw, keys, claims_options):
                claims = identity if raw == tokens['id_token'] else access
                for name in ('iss', 'aud'):
                    if claims[name] != claims_options[name]['value']:
                        raise AuthFailure('INVALID_TOKEN')
                return Claims(claims)
        module = types.ModuleType('authlib.jose')
        module.JsonWebToken = Jwt
        with patch.dict('sys.modules', {'authlib': types.ModuleType('authlib'), 'authlib.jose': module}), patch('agent.native_auth.request_json', return_value={'keys': []}):
            self.assertGreater(verify_tokens(tokens, 'nonce'), now)
            cases = ((identity, 'nonce', 'wrong'), (identity, 'aud', 'wrong'),
                     (access, 'aud', 'wrong'), (access, 'scope', ''),
                     (access, 'sub', 'other'), (access, 'exp', True),
                     (access, 'iat', now + 100), (access, 'nbf', now + 100),
                     (access, 'client_id', 'other'))
            for claims, key, value in cases:
                with self.subTest(key=key):
                    old, present = claims.get(key), key in claims
                    claims[key] = value
                    with self.assertRaises(AuthFailure):
                        verify_tokens(tokens, 'nonce')
                    if present:
                        claims[key] = old
                    else:
                        del claims[key]

    def test_missing_dependency_does_not_open_browser(self):
        opened = []
        auth = NativeAuth(opener=opened.append)
        with patch.dict('sys.modules', {'authlib': None}):
            self.assertEqual(auth.start_login(), {'state': 'error', 'errorCode': 'AUTH_DEPENDENCY_UNAVAILABLE'})
        self.assertEqual(opened, [])

    @unittest.skipUnless(os.environ.get('SAVE_ASSET_AUTH_LOOPBACK_TEST') == '1', 'Explicit loopback test opt-in; current sandbox denies connect with WinError 10013')
    def test_real_loopback_login_then_logout_synthetic_only(self):
        requests = []
        threads = []
        def opener(url):
            parsed = urllib.parse.urlsplit(url)
            values = dict(urllib.parse.parse_qsl(parsed.query))
            requests.append(values)
            callback = values.get('redirect_uri', values.get('post_logout_redirect_uri'))
            query = {'state': values['state']}
            if parsed.path == '/authorize':
                query['code'] = 'synthetic-code'
            def deliver():
                try:
                    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(callback + '?' + urllib.parse.urlencode(query), timeout=5) as response:
                        self.assertEqual(response.status, 200)
                except Exception as exc:
                    failures.append(exc)
            thread = threading.Thread(target=deliver)
            threads.append(thread)
            thread.start()
            return True
        failures = []
        def exchange(url, payload):
            self.assertEqual(url, ISSUER + 'oauth/token')
            self.assertEqual(payload['code'], 'synthetic-code')
            self.assertTrue(payload['code_verifier'])
            return {'access_token': 'synthetic-access', 'id_token': 'synthetic-id'}
        auth = NativeAuth(opener=opener, exchange=exchange, verifier=lambda tokens, nonce: time.time() + 60, timeout=8)
        # Exercise actual native listener without Auth0 or dependency bypass in production.
        auth._state, auth._generation = 'signing-in', 1
        auth._run(1)
        for thread in threads:
            thread.join(5)
        self.assertFalse(failures)
        self.assertEqual(auth.status(), {'state': 'signed-in'})
        self.assertEqual(requests[0]['code_challenge_method'], 'S256')
        self.assertEqual(requests[0]['scope'], 'openid relay:connect')
        self.assertNotIn('access_token', repr(requests))
        auth.cancel()
        auth._state = 'signing-in'
        auth._run(auth._generation, True)
        for thread in threads:
            thread.join(5)
        self.assertFalse(failures)
        self.assertEqual(auth.status(), {'state': 'signed-out'})
        self.assertIsNone(auth._tokens)
        self.assertNotIn('id_token_hint', requests[1])


if __name__ == '__main__':
    unittest.main()
