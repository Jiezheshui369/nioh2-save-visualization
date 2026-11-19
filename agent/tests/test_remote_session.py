import unittest
from dataclasses import replace
from agent.remote_session import NativeLease,NativeRelaySession,SessionError


class Socket:
    def __init__(self):self.sent=[];self.closed=False;self.before_send=lambda:None
    def send(self,data):self.before_send();self.sent.append(data)
    def recv(self,timeout):return b'synthetic-encrypted-frame'
    def close(self):self.closed=True


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.now=1000;self.lease=NativeLease('https://issuer.example/','synthetic-account','pc-1',1,'key-1','pc',61000,'synthetic-token')
        self.session=NativeRelaySession(lambda:self.lease,lambda:self.now,enabled=True);self.socket=Socket()
        self.handshake={}
        def dial(url,headers):self.handshake.update(url=url,headers=headers);return self.socket
        self.session.connect(dial,'a.b.c');self.saved=[]
    def tearDown(self):self.session.invalidate()
    def commit(self,value,check):check();self.saved.append(value);return True
    def receive(self,decrypt=lambda v:b'synthetic-publication',commit=None):
        return self.session.receive_and_commit('request-1','https://issuer.example/','synthetic-account',31000,decrypt,commit or self.commit)
    def test_default_disabled_and_missing_proof(self):
        s=NativeRelaySession(lambda:self.lease,lambda:self.now)
        with self.assertRaisesRegex(SessionError,'NOT_CONFIGURED'):s.connect(lambda *_:self.socket,'a.b.c')
        with self.assertRaisesRegex(SessionError,'DEVICE_PROOF_REQUIRED'):s.connect(lambda *_:self.socket,'')
    def test_transport_handshake_uses_fixed_native_headers_only(self):
        self.assertNotIn('synthetic-token',repr(self.lease));self.session.send(b'encrypted');self.assertEqual(self.socket.sent,[b'encrypted'])
        self.assertEqual(self.handshake['url'],'wss://review-relay.invalid/v1/connect')
        self.assertEqual(set(self.handshake['headers']),{'Authorization','X-SaveAsset-Device-Proof'})
        self.assertNotIn('synthetic-token',self.handshake['url'])
    def test_expiry_and_account_switch_block_send(self):
        self.now=61001
        with self.assertRaisesRegex(SessionError,'UNAUTHORIZED'):self.session.send(b'encrypted')
        self.now=1000;self.lease=replace(self.lease,subject='other-account')
        with self.assertRaisesRegex(SessionError,'UNAUTHORIZED'):self.session.send(b'encrypted')
        self.assertEqual(self.socket.sent,[])
    def test_device_rotation_blocks_old_connection(self):
        self.lease=replace(self.lease,version=2,key_id='key-2')
        with self.assertRaisesRegex(SessionError,'UNAUTHORIZED'):self.session.send(b'encrypted')
    def test_logout_during_decrypt_prevents_commit(self):
        def decrypt(_):self.session.invalidate();return b'late-publication'
        with self.assertRaisesRegex(SessionError,'RECEIVE_FAILED'):self.receive(decrypt)
        self.assertEqual(self.saved,[]);self.assertTrue(self.socket.closed)
    def test_expiry_during_commit_prevents_write(self):
        def commit(value,check):self.now=61001;check();self.saved.append(value)
        with self.assertRaisesRegex(SessionError,'RECEIVE_FAILED'):self.receive(commit=commit)
        self.assertEqual(self.saved,[])
    def test_replay_and_cross_account_refused(self):
        self.assertTrue(self.receive())
        with self.assertRaisesRegex(SessionError,'REPLAY'):self.receive()
        with self.assertRaisesRegex(SessionError,'UNAUTHORIZED'):
            self.session.receive_and_commit('request-2',self.lease.issuer,'other-account',31000,lambda _:b'x',self.commit)
        self.assertEqual(len(self.saved),1)
    def test_logout_interrupts_open_handshake(self):
        self.session.invalidate()
        def dial(*_):self.session.invalidate();return self.socket
        with self.assertRaisesRegex(SessionError,'CONNECT_FAILED'):self.session.connect(dial,'a.b.c')
        self.assertTrue(self.socket.closed)
    def test_late_handshake_cannot_cancel_a_newer_session(self):
        self.session.invalidate();new=Socket();old=Socket()
        def dial(*_):
            self.session.invalidate();self.session.connect(lambda *_:new,'a.b.c');return old
        with self.assertRaisesRegex(SessionError,'CONNECT_FAILED'):self.session.connect(dial,'a.b.c')
        self.assertTrue(old.closed);self.assertFalse(new.closed);self.session.send(b'new-epoch')
        self.assertEqual(new.sent,[b'new-epoch'])


if __name__=='__main__':unittest.main()
