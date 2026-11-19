"""Native account -> remote cancellation integration, no browser/socket/files."""
import threading
import time
import unittest
from unittest.mock import patch
from agent.native_auth import NativeAuth
from agent.remote_runtime import NativeRemoteRuntime


class Session:
    def __init__(self):self.closed=False
    def invalidate(self):self.closed=True


class BoundaryTests(unittest.TestCase):
    def setup_auth(self):
        runtime=NativeRemoteRuntime(test_only=True);session=Session();runtime.attach_test_session(session)
        auth=NativeAuth(remote_runtime=runtime);auth._state='signed-in';auth._expires=time.time()+60;auth._tokens={'access_token':'synthetic','id_token':'synthetic'}
        return auth,runtime,session
    def test_production_boundary_cannot_attach_or_connect(self):
        auth=NativeAuth()
        with self.assertRaisesRegex(RuntimeError,'DEVICE_ENROLLMENT_REQUIRED'):auth._remote.attach_test_session(Session())
        with self.assertRaisesRegex(RuntimeError,'DEVICE_ENROLLMENT_REQUIRED'):auth._remote.connect()
        self.assertEqual(auth.status(),{'state':'signed-out'})
    def test_cancel_clears_credentials_and_remote_session(self):
        auth,_,session=self.setup_auth();auth.cancel();self.assertTrue(session.closed);self.assertIsNone(auth._tokens)
        self.assertEqual(auth.status(),{'state':'signed-out'})
    def test_logout_invalidates_before_browser_work(self):
        auth,_,session=self.setup_auth()
        with patch('agent.native_auth.threading.Thread') as thread:
            auth.logout();self.assertTrue(session.closed);self.assertIsNone(auth._tokens);thread.return_value.start.assert_called_once()
    def test_new_login_invalidates_old_remote_session(self):
        auth,_,session=self.setup_auth()
        with patch('agent.native_auth.threading.Thread'):
            auth.start_login()
        self.assertTrue(session.closed);self.assertIsNone(auth._tokens)
    def test_expired_status_invalidates_remote(self):
        auth,_,session=self.setup_auth();auth._expires=time.time()-1
        self.assertEqual(auth.status(),{'state':'signed-out'});self.assertTrue(session.closed)
    def test_callbacks_do_not_run_under_account_lock(self):
        auth,runtime,session=self.setup_auth();observed=[]
        def invalidation():
            done=threading.Event();worker=threading.Thread(target=lambda:(auth.status(),done.set()))
            worker.start();observed.append(done.wait(1));worker.join(1);session.closed=True
        session.invalidate=invalidation;auth.cancel();self.assertEqual(observed,[True])
    def test_old_timer_cannot_invalidate_new_generation(self):
        auth,runtime,_=self.setup_auth()
        with patch('agent.native_auth.threading.Timer') as timer:
            auth._arm_expiry_locked(auth._generation);callback=timer.call_args.args[1]
        auth.cancel();new=Session();runtime.attach_test_session(new);callback();self.assertFalse(new.closed)
    def test_expiry_timer_cancels_registered_session(self):
        auth,_,session=self.setup_auth()
        with patch('agent.native_auth.threading.Timer') as timer:
            auth._arm_expiry_locked(auth._generation);callback=timer.call_args.args[1]
        auth._expires=time.time()-1;callback();self.assertTrue(session.closed);self.assertIsNone(auth._tokens)


if __name__=='__main__':unittest.main()
