"""Native PC MVP protocol. Explicit injected dependencies; disabled by default.

No key generation/storage or token-bearing WebView API. Production installation
must separately supply approved native identity, keys, transport and publication.
"""
import base64
import copy
import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass, field

ORIGIN = 'https://review-relay.invalid'
CONNECT = 'wss://review-relay.invalid/v1/connect'


class MvpError(Exception):
    pass


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def key_fields(key):
    return [key[k] for k in ('kty', 'crv', 'x', 'y')]


def device_fields(device):
    return [device['id'], device['role'], device['version'], device['keyId'],
            key_fields(device['agreementKey']), key_fields(device['signingKey'])]


def enrollment_bytes(record, purpose):
    if purpose not in ('first-pc', 'phone-proof', 'phone-approve', 'phone-reject'):
        raise MvpError('INVALID_PURPOSE')
    return packed(['save-asset-enrollment/1', purpose, record['account']['issuer'], record['account']['subject'],
                   record['accountEpoch'], record['id'], record['nonce'], record['issuedAt'], record['expiresAt'],
                   device_fields(record['root']) if record.get('root') else None, device_fields(record['candidate'])])


def phrase(record):
    digest = hashlib.sha256(enrollment_bytes(record, 'phone-proof')).hexdigest()[:24].upper()
    return ' '.join(digest[i:i+4] for i in range(0, 24, 4))


def connection_bytes(record):
    d = record['device']
    return packed(['save-asset-connect/1', 'GET', '/v1/connect', record['account']['issuer'],
                   record['account']['subject'], record['accountEpoch'], record['id'], record['nonce'],
                   record['issuedAt'], record['expiresAt'], record['clientId'], record['tokenDigest'],
                   d['id'], d['role'], d['version'], d['keyId'], key_fields(d['signingKey']), key_fields(d['agreementKey'])])


def hpke_context(message):
    return packed(['save-asset-mvp/1', message['account']['issuer'], message['account']['subject'],
                   message['requestId'], message['fromDeviceId'], message['toDeviceId'],
                   message['fromDeviceVersion'], message['toDeviceVersion']])


@dataclass(frozen=True)
class NativeIdentity:
    issuer: str
    subject: str
    expires_at: int
    token: str = field(repr=False)


class MvpPcBackend:
    """request(method, fixed_url, headers, json) and dial are native-only ports.

    candidate has public keys only; sign(bytes) returns raw ES256 (64 bytes).
    signer/agreement_private remain native, passed only to mature HPKE adapter.
    """
    def __init__(self, *, enabled=False, identity=None, candidate=None, sign=None,
                 request=None, dial=None, signer=None, agreement_private=None,
                 publication=None, now=lambda: int(time.time()*1000)):
        self.enabled = enabled
        self._identity, self._candidate, self._sign = identity, copy.deepcopy(candidate), sign
        self._request, self._dial = request, dial
        self._signer, self._agreement = signer, agreement_private
        self._publication, self._now = publication, now
        self._lock = threading.RLock()
        self._generation = 0
        self._socket = None
        self._seen = {}

    def _lease(self):
        if not self.enabled:
            raise MvpError('PRODUCTION_APPROVAL_REQUIRED')
        value = self._identity() if callable(self._identity) else None
        if not isinstance(value, NativeIdentity) or value.expires_at <= self._now():
            raise MvpError('SIGNED_OUT')
        if not all((self._candidate, self._sign, self._request)):
            raise MvpError('DEVICE_SETUP_REQUIRED')
        return value

    def _check(self, generation, identity):
        if generation != self._generation or self._lease() != identity:
            raise MvpError('SIGNED_OUT')

    def _call(self, method, path, data=None):
        identity = self._lease()
        generation = self._generation
        result = self._request(method, ORIGIN + '/v1/enrollment/' + path,
                               {'Authorization': 'Bearer ' + identity.token}, copy.deepcopy(data))
        self._check(generation, identity)
        if not isinstance(result, dict):
            raise MvpError('INVALID_RESPONSE')
        return copy.deepcopy(result)

    def _record(self, record, *, root=False):
        identity = self._lease()
        if record.get('account') != {'issuer': identity.issuer, 'subject': identity.subject}:
            raise MvpError('ACCOUNT_MISMATCH')
        if type(record.get('expiresAt')) is not int or record['expiresAt'] <= self._now():
            raise MvpError('EXPIRED')
        if root:
            expected = {**self._candidate, 'role': 'pc', 'version': 1}
            if record.get('root') != expected:
                raise MvpError('KEY_MISMATCH')
        return record

    def _proof(self, content):
        result = self._sign(content)
        if not isinstance(result, bytes) or len(result) != 64:
            raise MvpError('INVALID_PROOF')
        return b64(result)

    def status(self):
        if not self.enabled:
            return {'state': 'unconfigured', 'enabled': False, 'reason': 'PRODUCTION_APPROVAL_REQUIRED', 'pending': []}
        try:
            state = self._call('GET', 'state')['state']
            return {'state': 'ready' if state == 'pc-ready' else 'unregistered', 'enabled': True, 'reason': '', 'pending': []}
        except MvpError as exc:
            if str(exc) == 'NOT_CONFIGURED':
                return {'state': 'unconfigured', 'enabled': False, 'reason': 'NOT_CONFIGURED', 'pending': []}
            return {'state': 'signed-out' if str(exc) == 'SIGNED_OUT' else 'error', 'enabled': True, 'reason': str(exc), 'pending': []}

    def initialize(self):
        record = self._record(self._call('POST', 'first-pc/begin', {'candidate': self._candidate}))
        if record.get('root') is not None or record.get('candidate') != {**self._candidate, 'role': 'pc', 'version': 1}:
            raise MvpError('KEY_MISMATCH')
        self._call('POST', 'first-pc/finish', {'id': record['id'], 'signature': self._proof(enrollment_bytes(record, 'first-pc'))})
        return self.status()

    def pending(self):
        result = self._call('GET', 'pending')
        records = result.get('requests')
        if not isinstance(records, list) or len(records) > 8:
            raise MvpError('INVALID_RESPONSE')
        public = []
        for record in records:
            self._record(record, root=True)
            if record.get('state') == 'pending-approval':
                public.append({'requestId': record['id'], 'phrase': phrase(record), 'expiresAt': record['expiresAt']})
        return {**self.status(), 'pending': public}

    def decide(self, request_id, comparison, decision):
        if decision not in ('approve', 'reject') or not isinstance(request_id, str) or not re.fullmatch('[a-f0-9]{64}', request_id):
            raise MvpError('INVALID_REQUEST')
        record = self._record(self._call('GET', 'requests/' + request_id), root=True)
        if record.get('state') != 'pending-approval' or comparison != phrase(record):
            raise MvpError('PHRASE_MISMATCH')
        self._call('POST', 'phone/decision', {'id': request_id, 'decision': decision, 'phrase': comparison,
                   'signature': self._proof(enrollment_bytes(record, 'phone-' + decision))})
        return self.pending()

    def connect(self):
        if not callable(self._dial):
            raise MvpError('TRANSPORT_UNAVAILABLE')
        identity = self._lease()
        generation = self._generation
        record = self._record(self._call('POST', 'connect/begin', {'deviceId': self._candidate['id']}))
        expected = {**self._candidate, 'role': 'pc', 'version': 1}
        if record.get('device') != expected or record.get('tokenDigest') != hashlib.sha256(('Bearer ' + identity.token).encode()).hexdigest():
            raise MvpError('KEY_MISMATCH')
        headers = {'Authorization': 'Bearer ' + identity.token, 'X-Save-Asset-Challenge': record['id'],
                   'X-Save-Asset-Proof': self._proof(connection_bytes(record))}
        socket = self._dial(CONNECT, headers)
        try:
            self._check(generation, identity)
            with self._lock:
                if self._socket is not None:
                    raise MvpError('BUSY')
                self._socket = socket
        except Exception:
            socket.close()
            raise
        return {'state': 'ready', 'enabled': True, 'reason': '', 'pending': []}

    def invalidate(self):
        with self._lock:
            self._generation += 1
            socket, self._socket = self._socket, None
            self._seen.clear()
        if socket is not None:
            socket.close()

    def serve_once(self):
        """Process one phone refresh on the existing socket; native worker loop only."""
        identity, generation = self._lease(), self._generation
        with self._lock:
            socket = self._socket
        if socket is None:
            raise MvpError('OFFLINE')
        raw = socket.recv(timeout=10)
        if not isinstance(raw, str) or len(raw.encode('utf-8')) > 128*1024:
            raise MvpError('INVALID_FRAME')
        frame = json.loads(raw)
        devices = self._call('GET', 'devices').get('devices')
        if not isinstance(devices, list):
            raise MvpError('INVALID_RESPONSE')
        peers = [d for d in devices if d.get('id') == frame.get('fromDeviceId') and d.get('state') == 'active'
                 and d.get('role') == 'app' and d.get('account') == {'issuer': identity.issuer, 'subject': identity.subject}]
        if len(peers) != 1:
            raise MvpError('DEVICE_NOT_AUTHORIZED')
        result = self.answer_frame(frame, peers[0])
        self._check(generation, identity)
        with self._lock:
            self._check(generation, identity)
            if socket is not self._socket:
                raise MvpError('SIGNED_OUT')
            socket.send(packed(result).decode('utf-8'))
        return {'state': 'ready', 'enabled': True, 'reason': '', 'pending': []}

    def snapshot_response(self, message, peer):
        """Called only after native HPKE verification; reads committed projection."""
        identity = self._lease()
        expected_keys = {'protocol', 'type', 'gameId', 'account', 'requestId', 'fromDeviceId', 'toDeviceId',
                         'fromDeviceVersion', 'toDeviceVersion', 'issuedAt', 'expiresAt', 'knownSnapshotId', 'knownRevision'}
        if not isinstance(message, dict) or set(message) != expected_keys:
            raise MvpError('INVALID_REQUEST')
        if message.get('account') != {'issuer': identity.issuer, 'subject': identity.subject}:
            raise MvpError('ACCOUNT_MISMATCH')
        now = self._now()
        if (message.get('protocol') != 'nioh-relay/1' or message.get('type') != 'snapshot.read'
                or message.get('gameId') != 'nioh2' or message.get('fromDeviceId') != peer.get('id')
                or message.get('fromDeviceVersion') != peer.get('version') or peer.get('role') != 'app'
                or message.get('toDeviceId') != self._candidate['id'] or message.get('toDeviceVersion') != 1
                or type(message.get('issuedAt')) is not int or type(message.get('expiresAt')) is not int
                or message['issuedAt'] > now + 5000 or message['expiresAt'] <= now
                or not 0 < message['expiresAt'] - message['issuedAt'] <= 60000
                or not isinstance(message.get('requestId'), str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', message['requestId'])):
            raise MvpError('INVALID_REQUEST')
        known_id, known_revision = message['knownSnapshotId'], message['knownRevision']
        if ((known_id is None) != (known_revision is None)
                or known_id is not None and (not isinstance(known_id, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', known_id))
                or known_revision is not None and (not isinstance(known_revision, str) or not re.fullmatch('[a-f0-9]{64}', known_revision))):
            raise MvpError('INVALID_REQUEST')
        with self._lock:
            self._seen = {k: v for k, v in self._seen.items() if v > now}
            if message['requestId'] in self._seen:
                raise MvpError('REPLAY')
            if len(self._seen) >= 256:
                raise MvpError('CAPACITY')
            self._seen[message['requestId']] = message['expiresAt']
        publication = self._publication()
        same = (message.get('knownSnapshotId') == publication['snapshot']['snapshotId']
                and message.get('knownRevision') == publication['revision'])
        return {'protocol': 'nioh-relay/1', 'type': 'snapshot.result', 'gameId': 'nioh2',
                'account': message['account'], 'requestId': message['requestId'],
                'fromDeviceId': self._candidate['id'], 'toDeviceId': peer['id'],
                'fromDeviceVersion': 1, 'toDeviceVersion': peer['version'], 'issuedAt': now,
                'expiresAt': message['expiresAt'], 'snapshotId': publication['snapshot']['snapshotId'],
                'revision': publication['revision'], 'publicationVersion': publication['publicationVersion'],
                'outcome': 'not-modified' if same else 'snapshot', 'snapshot': None if same else publication['snapshot']}

    def answer_frame(self, frame, peer):
        from agent.remote_hpke import decrypt_signed, encrypt_signed
        from cryptography.hazmat.primitives.asymmetric import ec
        identity = self._lease()
        generation = self._generation
        if not isinstance(frame, dict) or set(frame) != {'protocol', 'requestId', 'fromDeviceId', 'toDeviceId', 'ciphertext'}:
            raise MvpError('INVALID_FRAME')
        if frame['protocol'] != 'nioh-relay/1' or frame['fromDeviceId'] != peer['id'] or frame['toDeviceId'] != self._candidate['id']:
            raise MvpError('INVALID_FRAME')
        binding = {**frame, 'account': {'issuer': identity.issuer, 'subject': identity.subject},
                   'fromDeviceVersion': peer['version'], 'toDeviceVersion': 1}
        def public(jwk):
            n = lambda k: int.from_bytes(base64.urlsafe_b64decode(jwk[k] + '==='), 'big')
            return ec.EllipticCurvePublicNumbers(n('x'), n('y'), ec.SECP256R1()).public_key()
        wire = base64.urlsafe_b64decode(frame['ciphertext'] + '===')
        if not 1 <= len(wire) <= 65536:
            raise MvpError('CAPACITY')
        raw = decrypt_signed(wire, self._agreement, public(peer['signingKey']), peer['keyId'], hpke_context(binding))
        message = json.loads(raw)
        if any(frame[k] != message.get(k) for k in ('requestId', 'fromDeviceId', 'toDeviceId')):
            raise MvpError('INVALID_REQUEST')
        response = self.snapshot_response(message, peer)
        self._check(generation, identity)
        sealed = encrypt_signed(packed(response), public(peer['agreementKey']), self._signer,
                                self._candidate['keyId'], hpke_context(response))
        self._check(generation, identity)
        return {'protocol': 'nioh-relay/1', 'requestId': response['requestId'],
                'fromDeviceId': response['fromDeviceId'], 'toDeviceId': response['toDeviceId'], 'ciphertext': b64(sealed)}


def official_request(method, url, headers, payload=None):
    """Explicit native HTTPS adapter. Fixed endpoint, no redirects/proxy/logging."""
    import urllib.request
    import urllib.error
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if (method not in ('GET', 'POST') or parsed.scheme != 'https'
            or parsed.netloc != 'review-relay.invalid'
            or not parsed.path.startswith('/v1/enrollment/') or parsed.query or parsed.fragment
            or set(headers) != {'Authorization'}):
        raise MvpError('INVALID_ENDPOINT')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise MvpError('NETWORK_ERROR')
    data = packed(payload) if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method,
        headers={**headers, 'Accept': 'application/json', 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=15) as reply:
            raw = reply.read(256*1024+1)
            if len(raw) > 256*1024:
                raise MvpError('CAPACITY')
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise MvpError('NOT_CONFIGURED' if exc.code in (404,503) else 'UNAUTHORIZED' if exc.code==401 else 'REMOTE_REJECTED') from None
    except MvpError:
        raise
    except Exception:
        raise MvpError('NETWORK_ERROR') from None


def official_dial(url, headers):
    if url != CONNECT or set(headers) != {'Authorization', 'X-Save-Asset-Challenge', 'X-Save-Asset-Proof'}:
        raise MvpError('INVALID_ENDPOINT')
    import logging
    from websockets.sync.client import connect
    logger = logging.Logger('save-asset-mvp', level=logging.CRITICAL+1)
    logger.propagate = False
    return connect(url, additional_headers=headers, proxy=None, compression=None,
                   open_timeout=10, close_timeout=3, max_size=128*1024, max_queue=4, logger=logger)
