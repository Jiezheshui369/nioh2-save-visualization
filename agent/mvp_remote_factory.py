"""Native-only factory for already provisioned keys. No generation/persistence.

Startup must explicitly supply approved NativeDevice material and enabled=True.
Importing this module, or the normal app startup, performs no networking.
"""
from dataclasses import dataclass, field
import threading
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes
from agent.mvp_remote import MvpPcBackend, MvpError, b64, official_request, official_dial


@dataclass(frozen=True)
class NativeDevice:
    issuer: str
    subject: str
    device_id: str
    key_id: str
    signing_private: object = field(repr=False)
    agreement_private: object = field(repr=False)


def public_key(key):
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise MvpError('INVALID_NATIVE_KEY')
    numbers = key.public_key().public_numbers()
    return {'kty': 'EC', 'crv': 'P-256', 'x': b64(numbers.x.to_bytes(32, 'big')), 'y': b64(numbers.y.to_bytes(32, 'big'))}


class ManagedPcBackend(MvpPcBackend):
    """An explicit initialize action starts the bounded native receive loop."""
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._stop = threading.Event()
        self._worker = None
        self._last_error = None

    def initialize(self):
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise MvpError('BUSY')
        state = super().status()
        if state['state'] == 'signed-out':
            raise MvpError('SIGNED_OUT')
        if state['state'] == 'unregistered':
            super().initialize()
        elif state['state'] != 'ready':
            raise MvpError('REMOTE_NOT_READY')
        try:
            self.connect()
        except Exception:
            # Registration may already be committed. Never repeat it because dialing failed.
            # Provider exceptions can contain credentials; expose a fixed code only.
            self._last_error = 'REMOTE_CONNECTION_CLOSED'
            return self.status()
        with self._lock:
            self._stop.clear()
            self._last_error = None
            self._worker = threading.Thread(target=self._run, name='SaveAsset-native-PC', daemon=True)
            self._worker.start()
        return self.status()

    def _run(self):
        try:
            while not self._stop.is_set():
                try:
                    self.serve_once()
                except TimeoutError:
                    # Re-check the native credential lease on each bounded wait.
                    self._lease()
        except Exception:
            # Upstream messages can contain tokens or provider detail.
            self._last_error = 'REMOTE_CONNECTION_CLOSED'
        finally:
            self.invalidate()

    def invalidate(self):
        self._stop.set()
        super().invalidate()

    def status(self):
        value = super().status()
        if self.enabled and value['state'] == 'ready':
            with self._lock:
                connected = self._socket is not None
            value['connected'] = connected
            if not connected:
                value['reason'] = self._last_error or 'PC_CONNECT_REQUIRED'
        return value


def create_pc_runtime(*, identity, device, store, enabled=False, request=official_request,
                      dial=official_dial, now=None, publication=None):
    """All arguments are native dependencies; no HTTP route configures this.

    store is the existing parsed-publication directory. The reader opens its
    SQLite database in mode=ro; no parse, import, migration or save read occurs.
    """
    from agent.remote_runtime import NativeRemoteRuntime
    from agent.publication_store import read_remote_publication
    if not enabled:
        return NativeRemoteRuntime()
    if not isinstance(device, NativeDevice):
        raise MvpError('DEVICE_SETUP_REQUIRED')
    candidate = {'id': device.device_id, 'keyId': device.key_id,
                 'signingKey': public_key(device.signing_private), 'agreementKey': public_key(device.agreement_private)}
    def lease():
        current = identity()
        if current is None or (current.issuer, current.subject) != (device.issuer, device.subject):
            raise MvpError('SIGNED_OUT')
        return current
    def sign(content):
        r, s = utils.decode_dss_signature(device.signing_private.sign(content, ec.ECDSA(hashes.SHA256())))
        return r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
    kwargs = {} if now is None else {'now': now}
    backend = ManagedPcBackend(enabled=True, identity=lease, candidate=candidate, sign=sign,
        request=request, dial=dial, signer=device.signing_private, agreement_private=device.agreement_private,
        publication=publication if publication is not None else lambda: read_remote_publication(store), **kwargs)
    return NativeRemoteRuntime(mvp_backend=backend)
