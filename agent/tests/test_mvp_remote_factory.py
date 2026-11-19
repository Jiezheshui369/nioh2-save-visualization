"""Native factory/lifecycle tests, synthetic material, no disk or network."""
import base64
import hashlib
import json
import threading
import time
import unittest
from cryptography.hazmat.primitives.asymmetric import ec
from agent.mvp_remote import NativeIdentity, MvpError
from agent.mvp_remote_factory import NativeDevice, create_pc_runtime, public_key
from agent.native_auth import NativeAuth, ISSUER


class FactoryTests(unittest.TestCase):
    def device(self):
        return NativeDevice('https://unit.example/', 'unit', 'pc-1', 'pc-key',
            ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1()))

    def test_disabled_factory_does_not_read_keys_store_or_identity(self):
        def forbidden(): raise AssertionError('called')
        runtime = create_pc_runtime(identity=forbidden, device=None, store=None)
        self.assertFalse(runtime.status()['enabled'])

    def test_factory_rejects_cross_account_identity(self):
        device = self.device()
        runtime = create_pc_runtime(identity=lambda: NativeIdentity(device.issuer, 'other', 2000, 'secret'),
            device=device, store=None, enabled=True, now=lambda: 1000)
        self.assertEqual(runtime.status()['state'], 'signed-out')

    def test_existing_registered_pc_starts_and_stops_receiver(self):
        device, now = self.device(), 1000
        identity = NativeIdentity(device.issuer, device.subject, 60000, 'synthetic.token')
        candidate = {'id': device.device_id, 'keyId': device.key_id,
            'signingKey': public_key(device.signing_private), 'agreementKey': public_key(device.agreement_private), 'role': 'pc', 'version': 1}
        calls = []
        def request(method, url, headers, payload):
            calls.append(url)
            if url.endswith('/state'): return {'state': 'pc-ready'}
            if url.endswith('/connect/begin'):
                return {'account': {'issuer': device.issuer, 'subject': device.subject}, 'accountEpoch': 1,
                    'id': 'a'*64, 'nonce': 'b'*64, 'issuedAt': now, 'expiresAt': 30000, 'clientId': 'pc-client',
                    'tokenDigest': hashlib.sha256(b'Bearer synthetic.token').hexdigest(), 'device': candidate}
            raise AssertionError('unexpected URL')
        class Socket:
            def __init__(self): self.closed = threading.Event()
            def recv(self, timeout):
                self.closed.wait(1)
                raise TimeoutError()
            def close(self): self.closed.set()
        socket = Socket()
        runtime = create_pc_runtime(identity=lambda: identity, device=device, store=None, enabled=True,
            request=request, dial=lambda *args: socket, now=lambda: now, publication=lambda: {})
        self.assertEqual(runtime.mvp_action('initialize')['state'], 'ready')
        worker = runtime._mvp._worker
        self.assertTrue(worker.is_alive())
        self.assertFalse(any('first-pc' in url for url in calls))
        with self.assertRaisesRegex(MvpError, 'BUSY'):
            runtime.mvp_action('initialize')
        runtime.cancel_detached(runtime.take_invalidations())
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(socket.closed.is_set())

    def test_native_verified_credential_lease_not_public_status(self):
        auth = NativeAuth()
        payload = base64.urlsafe_b64encode(json.dumps({'iss': ISSUER, 'sub': 'unit'}).encode()).rstrip(b'=').decode()
        with auth._lock:
            auth._state = 'signed-in'
            auth._tokens = {'id_token': 'synthetic.'+payload+'.signature', 'access_token': 'hidden.token'}
            auth._expires = time.time()+60
        identity = auth._capture_remote_identity()
        self.assertEqual(identity.subject, 'unit')
        self.assertEqual(identity.token, 'hidden.token')
        self.assertNotIn('hidden.token', str(auth.status()))
        auth.cancel()
        self.assertIsNone(auth._capture_remote_identity())

    def test_http_action_cannot_configure_native_factory(self):
        auth = NativeAuth()
        with self.assertRaises(ValueError):
            auth.remote_action('configure', {'enabled': True})
        self.assertFalse(auth.remote_action('status')['enabled'])

    def test_native_configuration_disabled_by_default(self):
        auth = NativeAuth()
        auth.configure_remote_mvp(device=None, store=None)
        self.assertFalse(auth.remote_action('status')['enabled'])



    def test_registration_survives_dial_failure_and_retry_does_not_register_again(self):
        from unittest.mock import patch
        from agent.mvp_remote_factory import ManagedPcBackend
        from agent.mvp_remote import MvpPcBackend
        backend = ManagedPcBackend(enabled=True)
        registered = [False]
        def status(_):
            return {'state': 'ready' if registered[0] else 'unregistered', 'enabled': True, 'pending': []}
        def register(_): registered[0] = True
        def dial(): backend._socket = object()
        with patch.object(MvpPcBackend,'status',status), patch.object(MvpPcBackend,'initialize',autospec=True,side_effect=register) as registration, patch.object(backend,'_run'):
            with patch.object(backend,'connect',side_effect=RuntimeError('provider-secret-must-not-leak')):
                first = backend.initialize()
            self.assertEqual(first['state'],'ready')
            self.assertFalse(first['connected'])
            self.assertNotIn('provider-secret',str(first))
            with patch.object(backend,'connect',side_effect=dial):
                second = backend.initialize()
            backend._worker.join(timeout=1)
            self.assertTrue(second['connected'])
            self.assertEqual(registration.call_count,1)

    def test_closed_or_error_status_never_attempts_registration(self):
        from unittest.mock import patch
        from agent.mvp_remote_factory import ManagedPcBackend
        from agent.mvp_remote import MvpPcBackend
        backend = ManagedPcBackend(enabled=True)
        for state in ['error','unconfigured']:
            with patch.object(MvpPcBackend,'status',return_value={'state':state}), patch.object(MvpPcBackend,'initialize') as register, patch.object(backend,'connect') as connect:
                with self.assertRaisesRegex(MvpError,'REMOTE_NOT_READY'): backend.initialize()
                register.assert_not_called();connect.assert_not_called()

if __name__ == '__main__': unittest.main()
