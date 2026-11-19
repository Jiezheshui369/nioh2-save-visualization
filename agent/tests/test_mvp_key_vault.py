"""RAM-only vault tests: injected protector, no Windows DPAPI/files/network."""
import json
import unittest
from unittest.mock import patch
from agent.mvp_key_vault import DeviceKeyVault, NativeMvpStartup, MAGIC
from agent.mvp_remote import MvpError, NativeIdentity
from agent.mvp_remote_factory import public_key
from agent.native_auth import ISSUER


class RamStore:
    def __init__(self): self.blob = None; self.writes = 0
    def read(self):
        if self.blob is None: raise FileNotFoundError()
        return self.blob
    def write_new(self, value):
        if self.blob is not None: raise FileExistsError()
        self.blob = value
        self.writes += 1


class RamProtector:
    """Opaque lookup only, deliberately no invented production cryptography."""
    def __init__(self): self.values = {}
    def protect(self, value):
        token = ('synthetic-protected-'+str(len(self.values))).encode()
        self.values[token] = value
        return token
    def unprotect(self, token): return self.values[token]


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.store, self.protector = RamStore(), RamProtector()
        self.vault = DeviceKeyVault(store=self.store, protector=self.protector)
    def create(self):
        return self.vault.provision(ISSUER, 'unit', enabled=True, explicit_native_action=True)

    def test_default_gate_does_not_generate_or_write(self):
        def fail(): raise AssertionError('generated')
        self.vault.generate = fail
        for args in ({}, {'enabled': True}, {'explicit_native_action': True}):
            with self.assertRaisesRegex(MvpError, 'NATIVE_PROVISION_APPROVAL_REQUIRED'):
                self.vault.provision(ISSUER, 'unit', **args)
        self.assertEqual(self.store.writes, 0)

    def test_load_missing_never_generates(self):
        self.vault.generate = lambda: self.fail('generated')
        with self.assertRaises(FileNotFoundError): self.vault.load(ISSUER, 'unit')

    def test_roundtrip_preserves_both_keys_and_ids(self):
        first = self.create()
        second = self.vault.load(ISSUER, 'unit')
        self.assertEqual(first.device_id, second.device_id)
        self.assertEqual(first.key_id, second.key_id)
        self.assertEqual(public_key(first.signing_private), public_key(second.signing_private))
        self.assertEqual(public_key(first.agreement_private), public_key(second.agreement_private))
        self.assertNotEqual(public_key(first.signing_private), public_key(first.agreement_private))
        self.assertNotIn('unit', self.store.blob.decode())

    def test_existing_vault_no_rotation(self):
        first = self.create()
        self.vault.generate = lambda: self.fail('rotated')
        self.assertEqual(self.create().device_id, first.device_id)
        self.assertEqual(self.store.writes, 1)

    def test_cross_account_cannot_load_or_overwrite(self):
        self.create()
        for action in (lambda: self.vault.load(ISSUER, 'other'),
                       lambda: self.vault.provision(ISSUER, 'other', enabled=True, explicit_native_action=True)):
            with self.assertRaisesRegex(MvpError, 'VAULT_ACCOUNT_MISMATCH'): action()
        self.assertEqual(self.store.writes, 1)

    def test_fixed_issuer_rejects_host_configuration(self):
        with self.assertRaisesRegex(MvpError, 'VAULT_ACCOUNT_MISMATCH'):
            self.vault.provision('https://evil.example/', 'unit', enabled=True, explicit_native_action=True)
        self.assertEqual(self.store.writes, 0)

    def test_corrupt_existing_vault_never_repaired(self):
        self.store.blob = b'corrupt'
        self.vault.generate = lambda: self.fail('generated')
        with self.assertRaisesRegex(MvpError, 'INVALID_VAULT'): self.create()
        self.assertEqual(self.store.blob, b'corrupt')

    def test_unknown_schema_or_extra_token_field_rejected(self):
        self.create()
        original = json.loads(next(iter(self.protector.values.values())))
        for changed in ({**original, 'schemaVersion': 2}, {**original, 'access_token': 'forbidden'}):
            self.store.blob = MAGIC+self.protector.protect(json.dumps(changed).encode())
            with self.assertRaisesRegex(MvpError, 'INVALID_VAULT'): self.vault.load(ISSUER, 'unit')

    def test_startup_default_does_no_vault_io(self):
        startup = NativeMvpStartup(None, None, vault=self.vault)
        startup.activate(object())
        self.assertEqual(self.store.writes, 0)

    def test_startup_enable_loads_only_existing_and_missing_reports_gate(self):
        class Auth:
            configured = None
            def _capture_remote_identity(s): return NativeIdentity(ISSUER, 'unit', 10000, 'ram-only')
            def configure_remote_mvp(s, **kwargs): s.configured = kwargs
        auth = Auth()
        startup = NativeMvpStartup(None, 'synthetic-store', enabled=True, vault=self.vault)
        startup.activate(auth)
        self.assertEqual(startup.reason, 'DEVICE_KEY_PROVISION_REQUIRED')
        self.assertIsNone(auth.configured)
        self.create()
        startup.activate(auth)
        self.assertEqual(startup.reason, '')
        self.assertEqual(auth.configured['store'], 'synthetic-store')

    def test_explicit_provision_after_verified_identity_once(self):
        class Auth:
            identity = None
            def _capture_remote_identity(s): return s.identity
            def configure_remote_mvp(s, **kwargs): pass
        auth = Auth()
        startup = NativeMvpStartup(None, None, enabled=True, provision_requested=True, vault=self.vault)
        startup.activate(auth)
        self.assertEqual(self.store.writes, 0)
        auth.identity = NativeIdentity(ISSUER, 'unit', 10000, 'ram-only')
        startup.activate(auth)
        self.assertEqual(self.store.writes, 1)
        self.assertFalse(startup.provision_requested)
        startup.activate(auth)
        self.assertEqual(self.store.writes, 1)

    def test_launcher_default_does_not_enable_or_provision(self):
        from desktop_launcher import build_parser
        args = build_parser().parse_args([])
        self.assertFalse(args.remote_mvp_enable)
        self.assertFalse(args.remote_mvp_provision_key)

    def test_launcher_provision_requires_native_enable_before_io(self):
        from desktop_launcher import main
        with patch('sys.argv', ['SaveAsset', '--remote-mvp-provision-key']):
            with self.assertRaisesRegex(ValueError, 'requires --remote-mvp-enable'): main()

    def test_launcher_browser_cannot_enable_native_vault(self):
        from desktop_launcher import main
        with patch('sys.argv', ['SaveAsset', '--remote-mvp-enable', '--browser']):
            with self.assertRaisesRegex(ValueError, 'require the native desktop window'): main()


if __name__ == '__main__': unittest.main()
