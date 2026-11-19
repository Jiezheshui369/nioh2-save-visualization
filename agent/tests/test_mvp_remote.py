"""In-memory synthetic keys/accounts only; no files, HTTP or original saves."""
import base64
import copy
import hashlib
import json
import unittest
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes
from agent.mvp_remote import (MvpPcBackend, MvpError, NativeIdentity, enrollment_bytes,
                              connection_bytes, phrase, hpke_context, b64, packed)
from agent.remote_hpke import encrypt_signed, decrypt_signed


def jwk(key):
    n = key.public_key().public_numbers()
    return {'kty': 'EC', 'crv': 'P-256', 'x': b64(n.x.to_bytes(32, 'big')), 'y': b64(n.y.to_bytes(32, 'big'))}


class MvpTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000000
        self.signer = ec.generate_private_key(ec.SECP256R1())
        self.agreement = ec.generate_private_key(ec.SECP256R1())
        self.phone_signer = ec.generate_private_key(ec.SECP256R1())
        self.phone_agreement = ec.generate_private_key(ec.SECP256R1())
        self.account = {'issuer': 'https://unit.example/', 'subject': 'synthetic'}
        self.identity = NativeIdentity(**{'issuer': self.account['issuer'], 'subject': self.account['subject'], 'expires_at': self.now+60000, 'token': 'synthetic.token'})
        self.pc = {'id': 'pc-1', 'keyId': 'pc-key', 'signingKey': jwk(self.signer), 'agreementKey': jwk(self.agreement)}
        self.phone = {'id': 'app-1', 'keyId': 'app-key', 'role': 'app', 'version': 1,
                      'signingKey': jwk(self.phone_signer), 'agreementKey': jwk(self.phone_agreement)}
        self.record = {'account': self.account, 'accountEpoch': 1, 'id': 'a'*64, 'nonce': 'b'*64,
                       'issuedAt': self.now, 'expiresAt': self.now+30000, 'root': {**self.pc, 'role': 'pc', 'version': 1},
                       'candidate': self.phone, 'state': 'pending-approval'}
        self.calls = []
        self.responses = {}
        self.backend = MvpPcBackend(enabled=True, identity=lambda: self.identity, candidate=self.pc,
            sign=self.sign, request=self.request, signer=self.signer, agreement_private=self.agreement,
            publication=lambda: {'snapshot': {'snapshotId': 'parsed-1'}, 'revision': 'c'*64, 'publicationVersion': 1}, now=lambda: self.now)

    def sign(self, raw):
        r, s = utils.decode_dss_signature(self.signer.sign(raw, ec.ECDSA(hashes.SHA256())))
        return r.to_bytes(32, 'big')+s.to_bytes(32, 'big')

    def request(self, method, url, headers, data):
        self.calls.append((method, url, headers, data))
        path = url.split('/v1/enrollment/')[1]
        return copy.deepcopy(self.responses.get(path, {'state': 'pc-ready'}))

    def message(self):
        return {'protocol': 'nioh-relay/1', 'type': 'snapshot.read', 'gameId': 'nioh2', 'account': self.account,
                'requestId': 'request-1', 'fromDeviceId': 'app-1', 'toDeviceId': 'pc-1', 'fromDeviceVersion': 1,
                'toDeviceVersion': 1, 'issuedAt': self.now, 'expiresAt': self.now+30000,
                'knownSnapshotId': None, 'knownRevision': None}

    def test_default_disabled_without_io(self):
        b = MvpPcBackend()
        self.assertFalse(b.status()['enabled'])
        with self.assertRaisesRegex(MvpError, 'PRODUCTION_APPROVAL_REQUIRED'):
            b.initialize()

    def test_initialize_exact_native_key_transcript(self):
        record = {**self.record, 'root': None, 'candidate': {**self.pc, 'role': 'pc', 'version': 1}}
        self.responses['first-pc/begin'] = record
        self.assertEqual(self.backend.initialize()['state'], 'ready')
        body = self.calls[1][3]
        signature = base64.urlsafe_b64decode(body['signature']+'===')
        r, s = int.from_bytes(signature[:32], 'big'), int.from_bytes(signature[32:], 'big')
        self.signer.public_key().verify(utils.encode_dss_signature(r, s), enrollment_bytes(record, 'first-pc'), ec.ECDSA(hashes.SHA256()))

    def test_initialize_rejects_server_key_replacement(self):
        self.responses['first-pc/begin'] = {**self.record, 'root': None}
        with self.assertRaisesRegex(MvpError, 'KEY_MISMATCH'):
            self.backend.initialize()
        self.assertEqual(len(self.calls), 1)

    def test_pending_public_only_and_phrase(self):
        self.responses['pending'] = {'requests': [self.record]}
        public = self.backend.pending()
        self.assertEqual(public['pending'], [{'requestId': 'a'*64, 'phrase': phrase(self.record), 'expiresAt': self.record['expiresAt']}])
        self.assertNotIn('synthetic.token', json.dumps(public))
        self.assertNotIn('signingKey', json.dumps(public))

    def test_wrong_phrase_has_no_approval(self):
        self.responses['requests/'+'a'*64] = self.record
        with self.assertRaisesRegex(MvpError, 'PHRASE_MISMATCH'):
            self.backend.decide('a'*64, 'wrong', 'approve')
        self.assertEqual(len(self.calls), 1)

    def test_account_and_root_pin(self):
        for changed, code in [({**self.record, 'account': {**self.account, 'subject': 'other'}}, 'ACCOUNT_MISMATCH'),
                              ({**self.record, 'root': {**self.record['root'], 'keyId': 'other'}}, 'KEY_MISMATCH')]:
            self.responses['pending'] = {'requests': [changed]}
            with self.assertRaisesRegex(MvpError, code):
                self.backend.pending()

    def test_approve_and_reject_sign_distinct_purpose(self):
        self.responses['requests/'+'a'*64] = self.record
        self.responses['pending'] = {'requests': []}
        for decision in ('approve', 'reject'):
            self.backend.decide('a'*64, phrase(self.record), decision)
            body = next(c[3] for c in reversed(self.calls) if c[1].endswith('phone/decision'))
            self.assertEqual(body['decision'], decision)

    def test_connection_proof_bound_to_bearer_and_registered_keys(self):
        record = {**self.record, 'device': {**self.pc, 'role': 'pc', 'version': 1}, 'clientId': 'pc-client',
                  'tokenDigest': hashlib.sha256(b'Bearer synthetic.token').hexdigest()}
        self.responses['connect/begin'] = record
        class Socket:
            closed = False
            def close(s): s.closed = True
        socket = Socket()
        captured = []
        self.backend._dial = lambda url, headers: (captured.append((url, headers)) or socket)
        self.backend.connect()
        self.assertEqual(set(captured[0][1]), {'Authorization', 'X-Save-Asset-Challenge', 'X-Save-Asset-Proof'})
        self.backend.invalidate()
        self.assertTrue(socket.closed)

    def test_logout_during_request_discards_result(self):
        def request(*args):
            self.backend.invalidate()
            return {'state': 'pc-ready'}
        self.backend._request = request
        self.assertEqual(self.backend.status()['state'], 'signed-out')

    def test_snapshot_binding_replay_and_not_modified(self):
        message = self.message()
        self.assertEqual(self.backend.snapshot_response(message, self.phone)['outcome'], 'snapshot')
        with self.assertRaisesRegex(MvpError, 'REPLAY'):
            self.backend.snapshot_response(message, self.phone)
        message.update(requestId='request-2', knownSnapshotId='parsed-1', knownRevision='c'*64)
        self.assertIsNone(self.backend.snapshot_response(message, self.phone)['snapshot'])

    def test_real_hpke_request_response(self):
        message = self.message()
        sealed = encrypt_signed(packed(message), self.agreement.public_key(), self.phone_signer, 'app-key', hpke_context(message))
        frame = {k: message[k] for k in ('protocol', 'requestId', 'fromDeviceId', 'toDeviceId')}
        frame['ciphertext'] = b64(sealed)
        result = self.backend.answer_frame(frame, self.phone)
        binding = {**message, 'fromDeviceId': 'pc-1', 'toDeviceId': 'app-1'}
        raw = decrypt_signed(base64.urlsafe_b64decode(result['ciphertext']+'==='), self.phone_agreement,
                             self.signer.public_key(), 'pc-key', hpke_context(binding))
        self.assertEqual(json.loads(raw)['snapshot'], {'snapshotId': 'parsed-1'})

    def test_expiry_and_cross_account_snapshot(self):
        for change in ({'expiresAt': self.now}, {'account': {**self.account, 'subject': 'other'}}):
            with self.assertRaises(MvpError):
                self.backend.snapshot_response({**self.message(), **change}, self.phone)

    def test_serve_once_reads_authorized_peer_and_sends_hpke_only(self):
        message = self.message()
        sealed = encrypt_signed(packed(message), self.agreement.public_key(), self.phone_signer, 'app-key', hpke_context(message))
        frame = {k: message[k] for k in ('protocol', 'requestId', 'fromDeviceId', 'toDeviceId')}
        frame['ciphertext'] = b64(sealed)
        sent = []
        class Socket:
            def recv(s, timeout): return json.dumps(frame)
            def send(s, value): sent.append(value)
        self.backend._socket = Socket()
        self.responses['devices'] = {'devices': [{**self.phone, 'state': 'active', 'account': self.account}]}
        self.backend.serve_once()
        self.assertEqual(len(sent), 1)
        self.assertNotIn('parsed-1', sent[0])

    def test_logout_inside_publication_never_emits_ciphertext(self):
        message = self.message()
        sealed = encrypt_signed(packed(message), self.agreement.public_key(), self.phone_signer, 'app-key', hpke_context(message))
        frame = {k: message[k] for k in ('protocol', 'requestId', 'fromDeviceId', 'toDeviceId')}
        frame['ciphertext'] = b64(sealed)
        def publication():
            self.backend.invalidate()
            return {'snapshot': {'snapshotId': 'parsed-1'}, 'revision': 'c'*64, 'publicationVersion': 1}
        self.backend._publication = publication
        with self.assertRaisesRegex(MvpError, 'SIGNED_OUT'):
            self.backend.answer_frame(frame, self.phone)

    def test_revoked_peer_never_reads_publication(self):
        class Socket:
            def recv(s, timeout): return json.dumps({'fromDeviceId': 'app-1'})
        self.backend._socket = Socket()
        self.responses['devices'] = {'devices': [{**self.phone, 'state': 'revoked', 'account': self.account}]}
        with self.assertRaisesRegex(MvpError, 'DEVICE_NOT_AUTHORIZED'):
            self.backend.serve_once()


if __name__ == '__main__':
    unittest.main()
