import test from 'node:test';
import assert from 'node:assert/strict';
import {issuer,context,frame} from './fixture.mjs';
import {routedFixture} from './enrollment-routes.fixture.mjs';
import {AccountHub} from '../src/hub.js';

test('pilot requires one exact issuer/sub after real signature verification',async()=>{
  const a=await issuer();
  for(const subject of [undefined,'',' ','unit-account other','unit-account\n',[], 'x'.repeat(256)]){
    await assert.rejects(a.verifier.verifyAccount(await a.request(),{...a.env,AUTH0_ALLOWED_SUBJECT:subject}),{code:'NOT_CONFIGURED'});
  }
  for(const claim of [{sub:'other-account',email:'owner@example.test'},{iss:'https://other.example/'},{sub:'Unit-account'}]){
    await assert.rejects(a.verifier.verifyAccount(await a.request('app-1',{...a.claims(),...claim}),a.env),{code:'UNAUTHORIZED'});
  }
  assert.equal((await a.verifier.verifyAccount(await a.request(),a.env)).subject,'unit-account');
});
test('other account cannot create DO partitions or write enrollment through Worker or direct DO',async()=>{
  const f=await routedFixture();
  for(const path of ['state','devices','pending']){
    const r=await f.call(path,undefined,{sub:'other-account'});assert.equal(r.status,401);
  }
  const r=await f.call('first-pc/begin',{candidate:f.material.pc.candidate},{sub:'other-account'});
  assert.equal(r.status,401);assert.equal(f.partitions.size,1);assert.equal(f.storage.values.size,0);
  const direct=await f.hub.fetch(await f.request('/v1/enrollment/first-pc/begin',{candidate:f.material.pc.candidate},{sub:'other-account'}));
  assert.equal(direct.status,401);assert.equal(f.storage.values.size,0);
  const connect=await f.hub.fetch(await f.auth.request('app-1',{...f.auth.claims(),sub:'other-account'}));
  assert.equal(connect.status,401);assert.equal(f.sockets.length,0);
  assert.equal((await f.bootstrap()).status,200);
});
test('absent policy blocks enabled entry points and produces no writes',async()=>{
  const f=await routedFixture();delete f.env.AUTH0_ALLOWED_SUBJECT;
  assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate})).status,503);
  assert.equal((await f.hub.fetch(await f.request('/v1/enrollment/state'))).status,503);
  assert.equal((await f.worker.fetch(await f.auth.request(),f.env)).status,503);
  assert.equal(f.storage.values.size,0);assert.equal(f.sockets.length,0);
});
async function sockets(){
 const a=await issuer(),c=await context(a),hub=new AccountHub(c.ctx,c.env,c.options);
 assert.equal((await hub.fetch(await a.request('app-1'))).status,101);
 assert.equal((await hub.fetch(await a.request('pc-1'))).status,101);
 return {a,...c,hub,app:c.sockets[0],pc:c.sockets[1]};
}
test('changed policy rejects hibernation-restored sockets and sends no ping or frame',async()=>{
 for(const missing of [false,true]){
  const f=await sockets();const restored=new AccountHub(f.ctx,f.env,f.options);if(missing)delete f.env.AUTH0_ALLOWED_SUBJECT;else f.env.AUTH0_ALLOWED_SUBJECT='other-account';
  await restored.webSocketMessage(f.app,'ping');await restored.webSocketMessage(f.pc,frame('pc-1','app-1'));
  for(const ws of [f.app,f.pc]){assert.ok(ws.closed);assert.equal(ws.sent.length,1);assert.deepEqual(JSON.parse(ws.sent[0]),{type:'relay.error',error:missing?'NOT_CONFIGURED':'UNAUTHORIZED'});}
 }
});
test('policy change during async forwarding cannot release an earlier authorized frame',async()=>{
 const f=await sockets();const original=f.hub.ledger.bind(f.hub);
 f.hub.ledger=async(...args)=>{await original(...args);f.env.AUTH0_ALLOWED_SUBJECT='other-account';};
 await f.hub.webSocketMessage(f.app,frame());assert.equal(f.pc.sent.length,0);assert.ok(f.app.closed);
});
