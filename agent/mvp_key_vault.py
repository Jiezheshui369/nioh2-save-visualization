"""Windows CurrentUser DPAPI device vault. No token or game-save access.

Only provision(explicit_native_action=True) generates/writes material. Loading an
existing vault never generates keys or repairs/replaces a corrupt/account-mismatched
vault. The production implementation is not exercised by synthetic tests.
"""
import base64
import ctypes
import json
import os
from pathlib import Path
import re
import secrets
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from agent.mvp_remote import MvpError
from agent.mvp_remote_factory import NativeDevice

MAGIC = b'SaveAsset-DPAPI-device/1\n'
ENTROPY = b'SaveAsset-current-user-native-device-v1'
MAX_BLOB = 32768


class CurrentUserDpapi:
    def _run(self, value, encrypt):
        if os.name != 'nt':
            raise MvpError('WINDOWS_DPAPI_REQUIRED')
        if not isinstance(value, bytes) or not 1 <= len(value) <= MAX_BLOB:
            raise MvpError('INVALID_VAULT')
        from ctypes import wintypes
        class Blob(ctypes.Structure):
            _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]
        def source(raw):
            buffer = ctypes.create_string_buffer(raw)
            return Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer
        incoming, keep = source(value)
        entropy, keep_entropy = source(ENTROPY)
        outgoing = Blob()
        library = ctypes.WinDLL('crypt32', use_last_error=True)
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        function = library.CryptProtectData if encrypt else library.CryptUnprotectData
        function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        function.restype = wintypes.BOOL
        try:
            # CRYPTPROTECT_UI_FORBIDDEN only; never CRYPTPROTECT_LOCAL_MACHINE.
            if not function(ctypes.byref(incoming), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(outgoing)):
                raise MvpError('VAULT_DPAPI_FAILED')
            if not 1 <= outgoing.cbData <= MAX_BLOB:
                raise MvpError('INVALID_VAULT')
            return ctypes.string_at(outgoing.pbData, outgoing.cbData)
        finally:
            ctypes.memset(keep, 0, len(keep))
            if outgoing.pbData:
                ctypes.memset(outgoing.pbData, 0, outgoing.cbData)
                kernel.LocalFree(outgoing.pbData)

    def protect(self, value): return self._run(value, True)
    def unprotect(self, value): return self._run(value, False)


class FileBlobStore:
    def __init__(self, directory): self.path = Path(directory) / 'native-device.dpapi'
    def read(self):
        with self.path.open('rb') as stream:
            raw = stream.read(MAX_BLOB+1)
        if len(raw) > MAX_BLOB: raise MvpError('INVALID_VAULT')
        return raw
    def write_new(self, blob):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive create preserves every existing identity, including corrupt
        # files. Only DPAPI ciphertext is written, never a plaintext temp file.
        with self.path.open('xb') as stream:
            stream.write(blob)
            stream.flush()
            os.fsync(stream.fileno())


class DeviceKeyVault:
    def __init__(self, directory=None, *, protector=None, store=None, generator=None):
        self.protector = protector if protector is not None else CurrentUserDpapi()
        self.store = store if store is not None else FileBlobStore(directory)
        self.generate = generator if generator is not None else lambda: ec.generate_private_key(ec.SECP256R1())

    @staticmethod
    def _account(issuer, subject):
        from agent.native_auth import ISSUER
        if issuer != ISSUER or not isinstance(subject, str) or not subject.strip() or len(subject) > 255:
            raise MvpError('VAULT_ACCOUNT_MISMATCH')

    def load(self, issuer, subject):
        self._account(issuer, subject)
        raw = self.store.read()
        if not raw.startswith(MAGIC): raise MvpError('INVALID_VAULT')
        try:
            value = json.loads(self.protector.unprotect(raw[len(MAGIC):]))
            fields = {'schemaVersion', 'issuer', 'subject', 'deviceId', 'keyId', 'signingPkcs8', 'agreementPkcs8'}
            if not isinstance(value, dict) or set(value) != fields or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
                raise ValueError()
            if (value['issuer'], value['subject']) != (issuer, subject):
                raise MvpError('VAULT_ACCOUNT_MISMATCH')
            for field in ('deviceId', 'keyId'):
                if not isinstance(value[field], str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', value[field]):
                    raise ValueError()
            def key(field):
                result = serialization.load_der_private_key(base64.b64decode(value[field], validate=True), password=None)
                if not isinstance(result, ec.EllipticCurvePrivateKey) or not isinstance(result.curve, ec.SECP256R1):
                    raise ValueError()
                return result
            return NativeDevice(issuer, subject, value['deviceId'], value['keyId'], key('signingPkcs8'), key('agreementPkcs8'))
        except MvpError: raise
        except Exception: raise MvpError('INVALID_VAULT') from None

    def provision(self, issuer, subject, *, enabled=False, explicit_native_action=False):
        if not enabled or not explicit_native_action:
            raise MvpError('NATIVE_PROVISION_APPROVAL_REQUIRED')
        self._account(issuer, subject)
        try:
            return self.load(issuer, subject)
        except FileNotFoundError:
            pass
        signing, agreement = self.generate(), self.generate()
        def encoded(key):
            if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
                raise MvpError('INVALID_NATIVE_KEY')
            raw = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            return base64.b64encode(raw).decode('ascii')
        value = {'schemaVersion': 1, 'issuer': issuer, 'subject': subject, 'deviceId': 'pc-'+secrets.token_hex(16),
                 'keyId': 'key-'+secrets.token_hex(16), 'signingPkcs8': encoded(signing), 'agreementPkcs8': encoded(agreement)}
        blob = MAGIC + self.protector.protect(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode())
        if len(blob) > MAX_BLOB: raise MvpError('INVALID_VAULT')
        try: self.store.write_new(blob)
        except FileExistsError:
            # Another native process won. Load that identity; never overwrite.
            return self.load(issuer, subject)
        return NativeDevice(issuer, subject, value['deviceId'], value['keyId'], signing, agreement)


class NativeMvpStartup:
    def __init__(self, directory, store, *, enabled=False, provision_requested=False, vault=None):
        self.enabled, self.provision_requested = enabled, provision_requested
        self.store = store
        self.vault = vault if vault is not None else DeviceKeyVault(directory)
        self.reason = 'DEVICE_KEY_PROVISION_REQUIRED' if enabled else 'PRODUCTION_APPROVAL_REQUIRED'

    def activate(self, auth):
        if not self.enabled: return
        identity = auth._capture_remote_identity()
        if identity is None:
            self.reason = 'SIGNED_OUT'
            return
        try:
            if self.provision_requested:
                device = self.vault.provision(identity.issuer, identity.subject, enabled=True, explicit_native_action=True)
                self.provision_requested = False
            else:
                device = self.vault.load(identity.issuer, identity.subject)
            auth.configure_remote_mvp(device=device, store=self.store, enabled=True)
            self.reason = ''
        except FileNotFoundError:
            self.reason = 'DEVICE_KEY_PROVISION_REQUIRED'
        except Exception:
            self.reason = 'DEVICE_KEY_LOAD_FAILED'
