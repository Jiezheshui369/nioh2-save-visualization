"""Post-JOSE claim policy only. Fake JOSE does NOT validate signatures/Authlib.

Real Authlib runtime and signed-token integration remain a separate build gate.
No sockets, persistent credentials or real tokens are used here.
"""
import base64
import copy
import json
import types
import unittest
from unittest.mock import patch

from agent import native_auth as auth


class Claims(dict):
    def validate(self, **options):
        if options != {"leeway": 0}:
            raise AssertionError("Strict claim validation required")


class PostJosePolicyTests(unittest.TestCase):
    def setUp(self):
        header = base64.urlsafe_b64encode(b'{"alg":"RS256","kid":"synthetic"}').rstrip(b'=').decode()
        self.identity = header + ".identity.signature"
        self.access = header + ".access.signature"
        self.tokens = {"id_token": self.identity, "access_token": self.access, "token_type": "Bearer"}
        common = {"iss": auth.ISSUER, "sub": "synthetic-subject", "iat": 900, "exp": 1100}
        self.claims = {
            self.identity: {**common, "aud": auth.CLIENT_ID, "nonce": "synthetic-nonce", "auth_time": 1000},
            self.access: {**common, "aud": auth.AUDIENCE, "azp": auth.CLIENT_ID, "scope": "openid relay:connect"},
        }

    def verify(self):
        records = self.claims
        class FakeJwt:
            def __init__(self, algorithms):
                if algorithms != ["RS256"]:
                    raise AssertionError("Algorithm allowlist required")
            def decode(self, raw, keys, claims_options):
                if claims_options['iss'] != {'essential': True, 'value': auth.ISSUER}:
                    raise AssertionError("Exact trusted issuer required")
                return Claims(copy.deepcopy(records[raw]))
        package = types.ModuleType('authlib')
        jose = types.ModuleType('authlib.jose')
        jose.JsonWebToken = FakeJwt
        package.jose = jose
        with patch.dict('sys.modules', {'authlib': package, 'authlib.jose': jose}), \
                patch.object(auth, 'request_json', return_value={'keys': []}), \
                patch.object(auth.time, 'time', return_value=1000):
            return auth.verify_tokens(self.tokens, 'synthetic-nonce')

    def test_valid_post_jose_policy(self):
        self.assertEqual(self.verify(), 1100)

    def test_recent_id_authentication_is_required_after_max_age_request(self):
        for value in [None,True,'1000',1001,699,-1,1000.5]:
            self.claims[self.identity]['auth_time']=value
            with self.subTest(value=value),self.assertRaises(auth.AuthFailure):self.verify()

    def test_diagnostics_are_booleans_and_never_use_standard_access_auth_time_or_iat(self):
        def token(value):
            return 'synthetic.'+base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()+'.synthetic'
        identity=token({'auth_time':1000,'sub':'must-not-leak'})
        access=token({'iat':1000,'auth_time':1000,'sub':'must-not-leak'})
        self.assertEqual(auth.authentication_diagnostics({'id_token':identity,'access_token':access},1000),{
            'idAuthenticationRecent':True,'serviceAuthenticationEvidence':False,'serviceAuthenticationRecent':False})
        access=token({auth.FRESH_AUTH_CLAIM:1000})
        self.assertTrue(auth.authentication_diagnostics({'id_token':identity,'access_token':access},1000)['serviceAuthenticationRecent'])
        self.assertFalse(auth.authentication_diagnostics({'id_token':identity,'access_token':access},1301)['serviceAuthenticationRecent'])

    def test_strict_integer_and_time_policy(self):
        for field, value in [('exp', 1000), ('exp', True), ('exp', 1100.5), ('exp', float('nan')),
                             ('exp', 2**53), ('iat', -1), ('iat', 1001), ('nbf', 1001), ('nbf', '900')]:
            with self.subTest(field=field, value=value):
                self.setUp()
                self.claims[self.access][field] = value
                with self.assertRaises(auth.AuthFailure):
                    self.verify()

    def test_nonce_subject_scope_and_client_fail_closed(self):
        for target, field, value in [(self.identity, 'nonce', 'other'), (self.access, 'sub', 'other'),
                                     (self.access, 'scope', 'openid'), (self.access, 'azp', 'other'),
                                     (self.access, 'client_id', 'contradiction')]:
            with self.subTest(field=field):
                self.setUp()
                self.claims[target][field] = value
                with self.assertRaises(auth.AuthFailure):
                    self.verify()

    def test_rfc9068_client_and_typed_audiences(self):
        self.claims[self.access].pop('azp')
        self.claims[self.access]['client_id'] = auth.CLIENT_ID
        self.assertEqual(self.verify(), 1100)
        self.claims[self.access]['aud'] = [auth.AUDIENCE, 1]
        with self.assertRaises(auth.AuthFailure):
            self.verify()

    def test_browser_controlled_jose_header_rejected(self):
        for field in ('jku', 'jwk', 'x5u', 'crit'):
            with self.subTest(field=field):
                self.setUp()
                header = base64.urlsafe_b64encode(json.dumps({'alg': 'RS256', field: 'untrusted'}).encode()).rstrip(b'=').decode()
                self.tokens['access_token'] = header + '.access.signature'
                with self.assertRaises(auth.AuthFailure):
                    self.verify()


if __name__ == '__main__':
    unittest.main()
