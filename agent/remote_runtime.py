"""Native application boundary: production enrollment/network stays disabled.
Imports the standard native crypto adapter without generating any key or traffic.
The HTTP/WebView API never receives this object or a session/token/private key.
"""
import threading


class NativeRemoteRuntime:
    def __init__(self, *, test_only=False, mvp_backend=None):
        self._test_only=test_only;self._lock=threading.RLock();self._sessions=[]
        from agent.mvp_remote import MvpPcBackend
        self._mvp = mvp_backend if mvp_backend is not None else MvpPcBackend()

    def attach_test_session(self, session):
        if not self._test_only:raise RuntimeError('DEVICE_ENROLLMENT_REQUIRED')
        with self._lock:self._sessions.append(session)

    def take_invalidations(self):
        # No I/O or callbacks while NativeAuth owns its credential lock.
        with self._lock:sessions=tuple(self._sessions)+(self._mvp,);self._sessions.clear();return sessions

    @staticmethod
    def cancel_detached(sessions):
        for session in sessions:
            try:session.invalidate()
            except Exception:pass

    def connect(self):
        raise RuntimeError('DEVICE_ENROLLMENT_REQUIRED')

    def load_test_crypto(self):
        if not self._test_only:raise RuntimeError('DEVICE_ENROLLMENT_REQUIRED')
        from agent import remote_hpke
        return remote_hpke

    def status(self):
        return self._mvp.status()

    def mvp_action(self, action, value=None):
        value = value or {}
        if action in ('status','initialize','pending') and not value:
            return getattr(self._mvp, action)()
        if action in ('approve','reject') and set(value)=={'requestId','phrase'}:
            return self._mvp.decide(value['requestId'], value['phrase'], action)
        raise ValueError('INVALID_REQUEST')
