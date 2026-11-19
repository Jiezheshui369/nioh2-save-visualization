"""Deterministic logout/login interleaving; no network or browser."""
import threading
import types
import unittest
from unittest.mock import patch
from agent.native_auth import NativeAuth


class LogoutRaceTests(unittest.TestCase):
    def test_login_at_first_logout_unlock_cannot_share_its_generation(self):
        auth = NativeAuth()
        auth._tokens = {'access_token': 'synthetic-old'}
        auth._state, auth._expires = 'signed-in', 9999999999
        first_unlock = threading.Event()
        login_finished = threading.Event()
        failures = []
        launched = []
        real_thread = threading.Thread

        class InterleavedLock:
            def __init__(self):
                self.lock = threading.RLock()
                self.triggered = False
            def __enter__(self):
                self.lock.acquire()
                return self
            def __exit__(self, *args):
                trigger = threading.current_thread().name == 'test-logout' and not self.triggered
                if trigger:
                    self.triggered = True
                self.lock.release()
                if trigger:
                    first_unlock.set()
                    if not login_finished.wait(3):
                        failures.append('login did not finish at controlled interleaving')

        class CapturedFlow:
            def __init__(self, **options):
                launched.append(options['args'])
            def start(self):
                pass

        def competing_login():
            if not first_unlock.wait(3):
                failures.append('logout did not release its lock')
            try:
                auth.start_login()
            except Exception as exc:
                failures.append(type(exc).__name__)
            finally:
                login_finished.set()

        auth._lock = InterleavedLock()
        jose = types.ModuleType('authlib.jose')
        package = types.ModuleType('authlib')
        package.jose = jose
        with patch.dict('sys.modules', {'authlib': package, 'authlib.jose': jose}), \
                patch('agent.native_auth.threading.Thread', CapturedFlow):
            login = real_thread(target=competing_login, name='test-login')
            logout = real_thread(target=auth.logout, name='test-logout')
            login.start()
            logout.start()
            logout.join(5)
            login.join(5)
            self.assertFalse(logout.is_alive())
            self.assertFalse(login.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(launched, [(1, True)])
        self.assertEqual(auth._generation, 1)
        self.assertIsNone(auth._tokens)
        self.assertEqual(auth.status(), {'state': 'signing-in'})


if __name__ == '__main__':
    unittest.main()
