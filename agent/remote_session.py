"""Native relay transport/lifecycle candidate. Not wired to the installed app.
No key generation, token persistence, enrollment, automatic login or auto-connect.
"""
from dataclasses import dataclass, field
import logging
import re
import threading

ENDPOINT='wss://review-relay.invalid/v1/connect'


class SessionError(Exception):
    pass


@dataclass(frozen=True)
class NativeLease:
    issuer: str
    subject: str
    device_id: str
    version: int
    key_id: str
    role: str
    expires_at: int
    access_token: str = field(repr=False)


class NativeRelaySession:
    def __init__(self, lease, now, *, enabled=False):
        self._lease, self._now, self._enabled=lease,now,enabled
        self._lock=threading.RLock();self._generation=0;self._socket=None;self._captured=None;self._seen={};self._deadline=None

    def _current(self):
        lease=self._lease()
        if not self._enabled:raise SessionError('NOT_CONFIGURED')
        if not isinstance(lease,NativeLease) or type(lease.expires_at) is not int or lease.expires_at<=self._now() or lease.version<1 \
            or lease.role not in ('pc','app') or not lease.issuer.startswith('https://') or not lease.subject \
            or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}',lease.device_id) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}',lease.key_id) \
            or not isinstance(lease.access_token,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,16384}',lease.access_token):
            raise SessionError('UNAUTHORIZED')
        return lease

    def connect(self, dial, device_proof):
        # The proof must come from native challenge/registered-key code, never JS.
        if not isinstance(device_proof,str) or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',device_proof):
            raise SessionError('DEVICE_PROOF_REQUIRED')
        with self._lock:
            if self._socket is not None or self._captured is not None:raise SessionError('BUSY')
            lease=self._current();self._generation+=1;epoch=self._generation;self._captured=lease
        socket=None
        try:
            socket=dial(ENDPOINT,{'Authorization':'Bearer '+lease.access_token,'X-SaveAsset-Device-Proof':device_proof})
            with self._lock:
                self._check(epoch);self._socket=socket
                self._deadline=threading.Timer(max(0.001,(lease.expires_at-self._now())/1000),lambda:self.invalidate(epoch))
                self._deadline.daemon=True;self._deadline.start()
        except Exception:
            if socket is not None:
                try:socket.close()
                except Exception:pass
            self.invalidate(epoch);raise SessionError('CONNECT_FAILED') from None

    def _check(self, epoch):
        if epoch!=self._generation or self._captured is None or self._current()!=self._captured:
            raise SessionError('UNAUTHORIZED')

    def invalidate(self, expected_generation=None):
        with self._lock:
            if expected_generation is not None and expected_generation!=self._generation:return
            self._generation+=1;socket=self._socket;self._socket=None;self._captured=None
            timer=self._deadline;self._deadline=None
            if timer is not None:timer.cancel()
        if socket is not None:
            try:socket.close()
            except Exception:pass

    def send(self, ciphertext):
        if not isinstance(ciphertext,bytes) or not 1<=len(ciphertext)<=8*1024*1024:raise SessionError('INVALID_MESSAGE')
        with self._lock:self._check(self._generation);epoch=self._generation;socket=self._socket
        if socket is None:raise SessionError('OFFLINE')
        try:
            socket.send(ciphertext)
            with self._lock:self._check(epoch)
        except Exception:
            self.invalidate(epoch);raise SessionError('SEND_FAILED') from None

    def receive_and_commit(self, request_id, issuer, subject, expires_at, decrypt, commit):
        """commit(value, check) MUST run check inside its real storage transaction.
        decrypt is trusted native HPKE/JWS + pending-request validation, not JS.
        """
        with self._lock:
            self._check(self._generation);epoch=self._generation;socket=self._socket;lease=self._captured
            if socket is None:raise SessionError('OFFLINE')
            if (issuer,subject)!=(lease.issuer,lease.subject):raise SessionError('UNAUTHORIZED')
            if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}',request_id):raise SessionError('INVALID_MESSAGE')
            if type(expires_at) is not int or expires_at<=self._now() or expires_at>self._now()+60000:raise SessionError('STALE')
            self._seen={k:v for k,v in self._seen.items() if v>self._now()}
            if request_id in self._seen:raise SessionError('REPLAY')
            if len(self._seen)>=256:raise SessionError('CAPACITY')
            self._seen[request_id]=expires_at
        def check():
            with self._lock:
                self._check(epoch)
                if expires_at<=self._now():raise SessionError('STALE')
        try:
            encrypted=socket.recv(timeout=10)
            if not isinstance(encrypted,bytes) or not 1<=len(encrypted)<=8*1024*1024:raise SessionError('INVALID_MESSAGE')
            check();value=decrypt(encrypted);check();result=commit(value,check);check();return result
        except Exception:
            self.invalidate(epoch);raise SessionError('RECEIVE_FAILED') from None


def official_websocket_dial(endpoint, headers):
    """Explicitly called adapter, requires separately installed websockets 17.1.
    Fixed origin, TLS certificate verification, no redirects/reconnect/proxy/logs.
    This function is never called by automated tests against a remote service.
    """
    if endpoint!=ENDPOINT or set(headers)!={'Authorization','X-SaveAsset-Device-Proof'}:raise SessionError('NOT_CONFIGURED')
    from importlib.metadata import version
    from websockets.sync.client import connect
    if version('websockets')!='17.1':raise SessionError('DEPENDENCY_VERSION')
    logger=logging.Logger('save-asset-native-transport',level=logging.CRITICAL+1);logger.propagate=False
    socket=connect(endpoint,additional_headers=headers,proxy=None,compression=None,open_timeout=10,close_timeout=3,
        max_size=8*1024*1024,max_queue=4,logger=logger,legacy=True)
    class TextFrames:
        def send(self,frame):socket.send(frame.decode('utf-8'))
        def recv(self,timeout):
            value=socket.recv(timeout=timeout)
            if not isinstance(value,str):raise SessionError('INVALID_MESSAGE')
            return value.encode('utf-8')
        def close(self):socket.close()
    return TextFrames()
