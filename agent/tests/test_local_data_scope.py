"""Synthetic local-context tests. No OAuth provider or personal save is accessed."""
import base64,json,http.client,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from agent.native_auth import NativeAuth,ISSUER
from agent.nioh2_agent import ApiHandler
A='a'*64;B='b'*64;S1='1'*64;S2='2'*64
class LocalContextTests(unittest.TestCase):
    def identity(self,subject):
        auth=NativeAuth()
        payload=base64.urlsafe_b64encode(json.dumps({'iss':ISSUER,'sub':subject}).encode()).rstrip(b'=').decode()
        # Existing native injection seam; no signature or real-login success claimed.
        auth._tokens={'id_token':'header.'+payload+'.synthetic','access_token':'not-a-real-token'}
        auth._state='signed-in';auth._expires=time.time()+1000
        return auth
    def test_opaque_context_is_subject_scoped_session_bound_and_credential_free(self):
        a=self.identity('synthetic-subject-A');c=a.local_data_context()
        self.assertEqual(c,a.local_data_context())
        self.assertNotIn('synthetic-subject-A',json.dumps(a.status()))
        self.assertNotIn('not-a-real-token',json.dumps(a.status()))
        self.assertTrue(all(len(x)==64 and set(x)<=set('0123456789abcdef') for x in c.values()))
        a._generation+=1;d=a.local_data_context()
        self.assertEqual(c['localDataScope'],d['localDataScope']);self.assertNotEqual(c['localDataSessionId'],d['localDataSessionId'])
        another=self.identity('synthetic-subject-A').local_data_context()
        self.assertEqual(c['localDataScope'],another['localDataScope']);self.assertNotEqual(c['localDataSessionId'],another['localDataSessionId'])
        self.assertNotEqual(c['localDataScope'],self.identity('synthetic-subject-B').local_data_context()['localDataScope'])
    def test_scope_absent_after_cancel_expiry_or_unusable_identity(self):
        a=self.identity('synthetic-A');a.cancel();self.assertIsNone(a.local_data_context())
        a=self.identity('synthetic-A');a._expires=0;self.assertIsNone(a.local_data_context())
        a=self.identity('synthetic-A');a._tokens['id_token']='opaque';self.assertIsNone(a.local_data_context())
        a=self.identity('');self.assertIsNone(a.local_data_context())
class ScopedStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='saveasset-account-scope-');self.root=Path(self.temp.name)
        class FakeAuth:
            context={'localDataScope':A,'localDataSessionId':S1}
            def local_data_context(self):return self.context
        self.auth=FakeAuth()
        self.handler=type('ScopedTestHandler',(ApiHandler,),{'store':self.root/'store','pipeline_defaults':{'snapshot_workspace':self.root/'copies'},'pipeline_config':{'source':self.root/'slot','snapshot_workspace':self.root/'copies'},'source_options':{'source-1':self.root/'slot'},'native_auth':self.auth,'refresh_lock':threading.Lock(),'log_message':lambda *args:None})
        for scope,identity in [('', 'legacy'),(A,'account-A'),(B,'account-B')]:
            p=self.root/'store';p=p/'accounts'/scope if scope else p;p.mkdir(parents=True)
            (p/'sample.json').write_text(json.dumps({'snapshotId':identity,'character':{'level':1}}),'utf8')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),self.handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=5);self.temp.cleanup()
    def request(self,scope=None,session=None,path='/api/snapshots/latest',method='GET',body=None,extra=()):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        try:
            c.putrequest(method,path);c.putheader('X-Nioh2-Desktop-Sync','1')
            if scope is not None:c.putheader('X-SaveAsset-Local-Scope',scope)
            if session is not None:c.putheader('X-SaveAsset-Local-Session',session)
            for k,v in extra:c.putheader(k,v)
            if body is not None:c.putheader('Content-Length',str(len(body)))
            c.endheaders(body);r=c.getresponse();return r.status,json.loads(r.read())
        finally:c.close()
    def test_each_active_identity_reads_only_its_account_store_without_legacy_adoption(self):
        self.assertEqual(self.request(A,S1)[1]['snapshotId'],'account-A')
        self.auth.context={'localDataScope':B,'localDataSessionId':S2}
        self.assertEqual(self.request(A,S1)[0],403)
        self.assertEqual(self.request(B,S2)[1]['snapshotId'],'account-B')
        self.assertEqual(self.request()[1]['snapshotId'],'legacy')
    def test_partial_duplicate_malformed_or_stale_context_is_rejected_without_fallback(self):
        for scope,session,extra,expected in [(A,None,(),400),('../outside',S1,(),400),(A,S1,(('X-SaveAsset-Local-Scope',A),),400),(B,S1,(),403),(A,S2,(),403)]:
            with self.subTest(scope=scope,session=session):
                self.assertEqual(self.request(scope,session,extra=extra)[0],expected)
        self.handler.native_auth=None
        self.assertEqual(self.request(A,S1)[0],403)
        self.assertFalse((self.root/'outside').exists())
    def test_scoped_empty_store_never_reads_legacy_and_revoked_session_cannot_read(self):
        self.auth.context={'localDataScope':'c'*64,'localDataSessionId':S1}
        self.assertEqual(self.request('c'*64,S1)[0],404)
        self.auth.context=None
        self.assertEqual(self.request(A,S1)[0],403)
    def test_scoped_refresh_uses_private_copy_and_publication_root_without_global_selection_mutation(self):
        initial=self.handler.pipeline_config;defaults=dict(self.handler.pipeline_defaults)
        captured=[]
        def pipeline(**kwargs):
            captured.append(kwargs);store=kwargs['store'];store.mkdir(parents=True,exist_ok=True)
            target=store/'new.json';target.write_text(json.dumps({'snapshotId':'new','character':{'level':2}}),'utf8');return target
        body=b'{"sourceId":"source-1"}'
        with patch('agent.nioh2_agent.run_pipeline',side_effect=pipeline):
            status,_=self.request(A,S1,'/api/refresh','POST',body)
        self.assertEqual(status,200);self.assertEqual(captured[0]['store'],self.root/'store/accounts'/A)
        self.assertEqual(captured[0]['snapshot_workspace'],self.root/'copies/accounts'/A)
        self.assertIs(self.handler.pipeline_config,initial);self.assertEqual(self.handler.pipeline_defaults,defaults)
        self.auth.context={'localDataScope':B,'localDataSessionId':S2}
        self.assertEqual(self.request(B,S2)[1]['snapshotId'],'account-B')
        self.assertEqual(self.request()[1]['snapshotId'],'legacy')
    def test_scope_headers_cannot_be_used_to_call_unrelated_mobile_control(self):
        self.assertEqual(self.request(A,S1,'/api/mobile-sync/status','POST',b'{}')[0],400)
