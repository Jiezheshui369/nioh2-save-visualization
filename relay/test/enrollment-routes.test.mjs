import test from 'node:test';
import assert from 'node:assert/strict';
import { routedFixture } from './enrollment-routes.fixture.mjs';
import { EnrollmentStorage } from '../src/enrollment-storage.js';
import { AccountHub } from '../src/hub.js';
import { MemoryStorage,FakeSocket,frame } from './fixture.mjs';
import { verificationPhrase } from '../src/enrollment.js';
import {connectionBytes} from '../src/connect-proof.js';

test('missing auth_time permits account reads and registered-key proof, never enrollment mutations',async()=>{
  const f=await routedFixture();await f.bootstrap();const pending=(await f.join()).record;
  const options={claims:{auth_time:undefined}};
  for(const path of ['state','devices','pending','requests/'+pending.id])assert.equal((await f.call(path,undefined,options)).status,200,path);
  assert.equal((await f.connect('pc',options)).status,101);
  for(const [path,data] of [['first-pc/begin',{candidate:f.material.pc.candidate}],
    ['phone/begin',{candidate:f.material.otherPhone.candidate}],['revoke/begin',{deviceId:'pc-1'}]])
    assert.equal((await f.call(path,data,{...options,role:path==='phone/begin'?'app':'pc'})).status,401,path);
  assert.equal((await f.decide(pending,'approve',options)).status,401);
});

test('valid old-authentication tokens refresh using new private-key proof after five minutes',async()=>{
  const f=await routedFixture();await f.bootstrap();await f.decide((await f.join()).record);
  const old={claims:{auth_time:Math.floor(f.auth.now()/1000)}};
  f.auth.advance(300001);
  for(const path of ['state','devices','pending'])assert.equal((await f.call(path,undefined,old)).status,200,path);
  assert.equal((await f.connect('pc',old)).status,101);assert.equal((await f.connect('app',old)).status,101);
  const pc=f.sockets[0],phone=f.sockets[1];await f.hub.webSocketMessage(phone,frame('phone-1','pc-1','old-auth-refresh'));
  assert.equal(JSON.parse(pc.sent[0]).requestId,'old-auth-refresh');
  assert.equal((await f.call('revoke/begin',{deviceId:'phone-1'},old)).status,401);
  f.auth.advance(3600000);assert.equal((await f.call('state',undefined,old)).status,401);
  assert.equal((await f.connect('app',old)).status,401);
});

test('passive token expiry is rechecked at transaction commit and at signed challenge consumption',async()=>{
  const f=await routedFixture();await f.bootstrap();
  const claims={auth_time:undefined,exp:Math.floor(f.auth.now()/1000)+1};
  const request=await f.request('/v1/enrollment/state',undefined,{claims});
  const capability=await f.hub.enrollment.authority.authenticate(request),before=await f.storage.get('enrollment:rate');
  await assert.rejects(f.hub.enrollment.service.transaction(capability,null,async tx=>{
    await tx.put('enrollment:rate',{start:0,requests:999});f.auth.advance(1001);
  },{fresh:false}),{code:'UNAUTHORIZED'});
  assert.deepEqual(await f.storage.get('enrollment:rate'),before);
  const options={claims:{auth_time:undefined,exp:Math.floor(f.auth.now()/1000)+1}};
  const begin=await f.request('/v1/enrollment/connect/begin',{deviceId:'pc-1'},options);
  const result=await f.worker.fetch(begin,f.env);assert.equal(result.status,200);const challenge=await result.json();
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},f.material.pc.signing.privateKey,connectionBytes(challenge));
  f.auth.advance(1001);
  const connect=new Request('https://relay.example/v1/connect',{headers:{Authorization:begin.headers.get('Authorization'),Upgrade:'websocket',
    'X-Save-Asset-Challenge':challenge.id,'X-Save-Asset-Proof':Buffer.from(signature).toString('base64url')}});
  assert.equal((await f.worker.fetch(connect,f.env)).status,401);assert.equal(f.sockets.length,0);
});

test('pending discovery requires PC client and active root and lists only proved phones',async()=>{
  const f=await routedFixture();assert.equal((await f.call('pending')).status,403);
  await f.bootstrap();assert.deepEqual((await f.call('pending')).body,{requests:[]});
  const {body:r}=await f.call('phone/begin',{candidate:f.material.phone.candidate},{role:'app'});
  assert.deepEqual((await f.call('pending')).body,{requests:[]});
  await f.call('phone/prove',{id:r.id,signature:await f.sign(r,'phone-proof',f.material.phone)},{role:'app'});
  const pending=await f.call('pending');assert.equal(pending.status,200);
  assert.deepEqual(pending.body.requests.map(r=>r.id),[r.id]);
  assert.equal(pending.body.requests[0].candidate.id,'phone-1');
  assert.equal((await f.call('pending',undefined,{role:'app'})).status,401);
  const {body:revoke}=await f.call('revoke/begin',{deviceId:'pc-1'});
  await f.call('revoke/finish',{id:revoke.id,signature:await f.sign(revoke,'device-revoke')});
  assert.equal((await f.call('pending')).status,403);
});

test('pending discovery isolates accounts even with identical root and candidate IDs and public keys',async()=>{
  const f=await routedFixture();await f.bootstrap();const own=(await f.join()).record;
  const options={sub:'other-account'};
  f.env.AUTH0_ALLOWED_SUBJECT='other-account';
  const {body:root}=await f.call('first-pc/begin',{candidate:f.material.pc.candidate},options);
  assert.equal((await f.call('first-pc/finish',{id:root.id,signature:await f.sign(root,'first-pc')},options)).status,200);
  assert.deepEqual((await f.call('pending',undefined,options)).body,{requests:[]});
  const {body:other}=await f.call('phone/begin',{candidate:f.material.phone.candidate},{...options,role:'app'});
  assert.equal((await f.call('phone/prove',{id:other.id,signature:await f.sign(other,'phone-proof',f.material.phone)},{...options,role:'app'})).status,200);
  f.env.AUTH0_ALLOWED_SUBJECT='unit-account';
  assert.deepEqual((await f.call('pending')).body.requests.map(r=>r.id),[own.id]);
  f.env.AUTH0_ALLOWED_SUBJECT='other-account';
  assert.deepEqual((await f.call('pending',undefined,options)).body.requests.map(r=>r.id),[other.id]);
  assert.equal((await f.hub.fetch(await f.request('/v1/enrollment/pending',undefined,options))).status,401);
});

test('pending discovery excludes rejected and expired applications',async()=>{
  const f=await routedFixture();await f.bootstrap();const rejected=(await f.join()).record;
  assert.equal((await f.decide(rejected,'reject')).status,200);
  assert.deepEqual((await f.call('pending')).body,{requests:[]});
  const {body:expired}=await f.call('phone/begin',{candidate:f.material.otherPhone.candidate},{role:'app'});
  await f.call('phone/prove',{id:expired.id,signature:await f.sign(expired,'phone-proof',f.material.otherPhone)},{role:'app'});
  assert.deepEqual((await f.call('pending')).body.requests.map(r=>r.id),[expired.id]);
  f.auth.advance(120001);
  assert.deepEqual((await f.call('pending')).body,{requests:[]});
});

test('enrollment remains independently disabled and account auth needs no old device claim',async()=>{
  const f=await routedFixture(),request=await f.request('/v1/enrollment/state');
  assert.equal((await f.worker.fetch(request,{...f.env,ENROLLMENT_ENABLED:'false'})).status,503);
  const noClaim={...f.env,AUTH0_DEVICE_CLAIM:''};
  assert.equal((await f.worker.fetch(await f.request('/v1/enrollment/state'),noClaim)).status,200);
  assert.equal((await f.call('state')).body.state,'no-pc');
  assert.equal((await f.worker.fetch(await f.request('/v1/enrollment/state'),{...f.env,AUTH0_PC_CLIENT_ID:'android-client'})).status,503);
});
test('signed auth_time is mandatory; iat, token refresh and forged client fields cannot replace it',async()=>{
  const f=await routedFixture();
  for(const claims of [{auth_time:undefined},{auth_time:Math.floor(f.auth.now()/1000)-301},{auth_time:Math.floor(f.auth.now()/1000)+1}])
    assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate},{claims})).status,401);
  assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate},{role:'app'})).status,401);
  assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate,accountId:'other'})).status,400);
  const token=await f.auth.token({...f.auth.claims(),auth_time:Math.floor(f.auth.now()/1000)}),parts=token.split('.');
  const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.sub='attacker';parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal((await f.call('state',undefined,{token:parts.join('.')})).status,401);
});
test('Worker and DO each verify the real RS256 signature and strip client account headers',async()=>{
  const f=await routedFixture(),original=f.auth.verifier.verifyAccount.bind(f.auth.verifier);let calls=0;
  f.auth.verifier.verifyAccount=async(...args)=>{calls++;return original(...args);};
  const request=await f.request('/v1/enrollment/state');request.headers.set('X-Account-Subject','attacker');
  assert.equal((await f.worker.fetch(request,f.env)).status,200);assert.equal(calls,2);
  const direct=await f.request('/v1/enrollment/state',undefined,{sub:'other-account'});
  assert.equal((await f.hub.fetch(direct)).status,401);
  assert.equal((await f.hub.fetch(new Request('https://relay.internal/v1/enrollment/state',{headers:{'X-Account-Subject':'unit-account'}}))).status,401);
});
test('concurrent first-device enrollment has one root, one proof commit and durable replay denial',async()=>{
  const f=await routedFixture();
  const attempts=await Promise.all([f.call('first-pc/begin',{candidate:f.material.pc.candidate}),f.call('first-pc/begin',{candidate:f.material.otherPhone.candidate})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  const r=attempts.find(r=>r.status===200).body,who=r.candidate.id==='pc-1'?f.material.pc:f.material.otherPhone;
  const finish={id:r.id,signature:await f.sign(r,'first-pc',who)};
  const results=await Promise.all([f.call('first-pc/finish',finish),f.call('first-pc/finish',finish)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.storage.list({prefix:'device:'})).size,1);
  assert.equal((await f.call('first-pc/finish',finish)).status,409);
});
test('phone registration, approval and replay metadata survive reconstruction from persisted mock bytes',async()=>{
  const f=await routedFixture();assert.equal((await f.bootstrap()).status,200);const {record:r}=await f.join();
  const saved=structuredClone(f.storage.values),replacement=new MemoryStorage();replacement.values=saved;
  const ctx={...f.ctx,storage:replacement},hub=new AccountHub(ctx,f.env,f.options);
  const decision={id:r.id,decision:'approve',phrase:await verificationPhrase(r),signature:await f.sign(r,'phone-approve')};
  const request=await f.request('/v1/enrollment/phone/decision',decision);
  assert.equal((await hub.fetch(request)).status,200);
  assert.equal((await replacement.get('device:phone-1')).state,'active');
  const resumed=new AccountHub(ctx,f.env,f.options);
  assert.equal((await resumed.fetch(await f.request('/v1/enrollment/phone/decision',decision))).status,409);
  const stored=JSON.stringify([...replacement.values]);
  for(const text of ['Bearer ','privateKey','ciphertext','canonicalSnapshot'])assert.equal(stored.includes(text),false);
});
test('expired requests cannot be read, approved or replayed after adapter recovery',async()=>{
  const f=await routedFixture();await f.bootstrap();const {record:r}=await f.join();f.auth.advance(120001);
  assert.equal((await f.call('requests/'+r.id)).status,410);
  assert.equal((await f.decide(r)).status,410);
  assert.equal(await f.storage.get('device:phone-1'),undefined);
});
test('cross-account request reads, approval and revocation cannot mutate the target partition',async()=>{
  const f=await routedFixture();await f.bootstrap();const {record:r}=await f.join();
  assert.equal((await f.call('requests/'+r.id,undefined,{sub:'other-account'})).status,401);
  assert.equal((await f.decide(r,'approve',{sub:'other-account'})).status,401);
  assert.equal((await f.call('revoke/begin',{deviceId:'pc-1'},{sub:'other-account'})).status,401);
  for(const [path,data] of [['requests/'+r.id,undefined],['phone/decision',{id:r.id,decision:'approve',phrase:'x',signature:await f.sign(r,'phone-approve')}],['revoke/begin',{deviceId:'pc-1'}]])
    assert.equal((await f.hub.fetch(await f.request('/v1/enrollment/'+path,data,{sub:'other-account'}))).status,401);
  assert.equal((await f.storage.get('join:'+r.id)).state,'pending-approval');
  assert.equal((await f.storage.get('device:pc-1')).state,'active');
});
test('rejection invalidates any old candidate attachment and cannot later approve or connect',async()=>{
  const f=await routedFixture();await f.bootstrap();const {record:r}=await f.join();
  assert.equal((await f.connect('app')).status,403);
  // Defensive stale/hibernated attachment; pending phone never received a live session.
  const old=new FakeSocket();old.serializeAttachment({active:true,device:{id:'phone-1'}});f.sockets.push(old);
  assert.equal((await f.decide(r,'reject')).status,200);assert.ok(old.closed);
  assert.equal((await f.decide(r)).status,409);assert.equal((await f.connect('app')).status,403);
});
test('three rejected phrase attempts close old candidate attachment, including error responses',async()=>{
  const f=await routedFixture();await f.bootstrap();const {record:r}=await f.join();
  const old=new FakeSocket();old.serializeAttachment({active:true,device:{id:'phone-1'}});f.sockets.push(old);
  for(let i=0;i<3;i++)assert.equal((await f.call('phone/decision',{id:r.id,decision:'approve',phrase:'bad',signature:await f.sign(r,'phone-approve')})).status,403);
  assert.equal((await f.storage.get('join:'+r.id)).state,'rejected');assert.ok(old.closed);
});
test('signed revocation immediately closes connected phone and blocks old claims and proof replay',async()=>{
  const f=await routedFixture();await f.bootstrap();await f.decide((await f.join()).record);
  assert.equal((await f.connect('pc')).status,101);assert.equal((await f.connect('app')).status,101);
  f.auth.advance(180001); // Registration challenge expiry must not prevent later revocation.
  const old=f.sockets.at(-1),{body:r}=await f.call('revoke/begin',{deviceId:'phone-1'});
  const payload={id:r.id,signature:await f.sign(r,'device-revoke')};
  assert.equal((await f.call('revoke/finish',payload)).status,200);assert.ok(old.closed);
  const received=f.sockets[0].sent.length;await f.hub.webSocketMessage(old,frame('phone-1','pc-1','after-revoke'));
  assert.equal(f.sockets[0].sent.length,received);assert.equal((await f.connect('app')).status,403);
  assert.equal((await f.call('revoke/finish',payload)).status,409);
  assert.equal((await f.storage.get('device:phone-1')).version,2);
});
test('root revocation closes descendants and survives new hub instance and late approval',async()=>{
  const f=await routedFixture();await f.bootstrap();await f.decide((await f.join()).record);await f.connect('pc');await f.connect('app');
  const {body:r}=await f.call('revoke/begin',{deviceId:'pc-1'});
  assert.equal((await f.call('revoke/finish',{id:r.id,signature:await f.sign(r,'device-revoke')})).status,200);
  assert.ok(f.sockets.every(ws=>ws.closed));
  const hub=new AccountHub(f.ctx,f.env,f.options),state=await hub.fetch(await f.request('/v1/enrollment/state'));
  assert.equal((await state.json()).state,'pc-revoked');assert.equal((await f.storage.get('account')).accountEpoch,2);
  assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate})).status,409);
});
test('revocation during a verified handshake prevents a new stale socket from attaching',async()=>{
  const f=await routedFixture();await f.bootstrap();await f.decide((await f.join()).record);
  const {body:r}=await f.call('revoke/begin',{deviceId:'phone-1'}),proof=await f.sign(r,'device-revoke');
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const consume=f.hub.consume.bind(f.hub);f.hub.consume=async(...args)=>{await consume(...args);started();await gate;};
  const connecting=f.connect('app');await ready;
  assert.equal((await f.call('revoke/finish',{id:r.id,signature:proof})).status,200);
  release();assert.equal((await connecting).status,403);assert.equal(f.sockets.length,0);
});
test('revocation during an in-flight message invalidates captured attachments before forwarding',async()=>{
  const f=await routedFixture();await f.bootstrap();await f.decide((await f.join()).record);await f.connect('pc');await f.connect('app');
  const pc=f.sockets[0],phone=f.sockets[1],{body:r}=await f.call('revoke/begin',{deviceId:'phone-1'});
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const ledger=f.hub.ledger.bind(f.hub);f.hub.ledger=async(...args)=>{await ledger(...args);started();await gate;};
  const sending=f.hub.webSocketMessage(phone,frame('phone-1','pc-1','race-revoke'));await ready;
  assert.equal((await f.call('revoke/finish',{id:r.id,signature:await f.sign(r,'device-revoke')})).status,200);
  release();await sending;assert.equal(pc.sent.length,0);assert.ok(phone.closed);
});
test('root revoke and phone approval racing cannot leave an active descendant',async()=>{
  const f=await routedFixture();await f.bootstrap();const {record:phone}=await f.join(),{body:r}=await f.call('revoke/begin',{deviceId:'pc-1'});
  const results=await Promise.all([f.decide(phone),f.call('revoke/finish',{id:r.id,signature:await f.sign(r,'device-revoke')})]);
  assert.equal(results[1].status,200);assert.notEqual((await f.storage.get('device:phone-1'))?.state,'active');
  assert.equal((await f.storage.get('device:pc-1')).state,'revoked');
});
test('DO adapter executes the operation outside storage transactions and retries stale snapshots',async()=>{
  const raw=new MemoryStorage();let inside=false,callbacks=0,release,started;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const storage={transaction:callback=>raw.transaction(async tx=>{inside=true;try{return await callback(tx);}finally{inside=false;}})};
  const adapter=new EnrollmentStorage(storage);
  const first=adapter.transaction(async tx=>{callbacks++;assert.equal(inside,false);if(callbacks===1){started();await gate;}
    await tx.put('account',{value:((await tx.get('account'))?.value??0)+1});});
  await ready;await adapter.transaction(async tx=>tx.put('account',{value:10}));release();await first;
  assert.equal(callbacks,2);assert.equal((await raw.get('account')).value,11);
});
test('real RSA and ECDSA verification never execute inside mock DO storage transactions',async t=>{
  const f=await routedFixture();let inside=false,verified=0;
  const transaction=f.storage.transaction.bind(f.storage),verify=crypto.subtle.verify.bind(crypto.subtle);
  t.mock.method(f.storage,'transaction',callback=>transaction(async tx=>{inside=true;try{return await callback(tx);}finally{inside=false;}}));
  t.mock.method(crypto.subtle,'verify',async(...args)=>{assert.equal(inside,false);verified++;return verify(...args);});
  assert.equal((await f.bootstrap()).status,200);assert.equal((await f.decide((await f.join()).record)).status,200);
  assert.ok(verified>=10);
});
test('mock persistence commit failure rolls back registration and preserves retry safety',async()=>{
  const f=await routedFixture(),{body:r}=await f.call('first-pc/begin',{candidate:f.material.pc.candidate});
  const transaction=f.storage.transaction.bind(f.storage);let injected=false;
  f.storage.transaction=callback=>transaction(async tx=>{
    const result=await callback(tx);
    if(!injected&&await tx.get('device:pc-1')){injected=true;throw new Error('synthetic commit failure');}
    return result;
  });
  const finish={id:r.id,signature:await f.sign(r,'first-pc')};
  assert.equal((await f.call('first-pc/finish',finish)).status,503);
  assert.equal(await f.storage.get('device:pc-1'),undefined);assert.equal((await f.storage.get('bootstrap')).state,'awaiting-proof');
  assert.equal((await f.call('first-pc/finish',finish)).status,200);
});
test('expiry at CAS commit and lost persistent commit cannot authorize or leave active records',async()=>{
  const raw=new MemoryStorage();let now=100,validateCalls=0;
  const adapter=new EnrollmentStorage(raw,{now:()=>now});
  await assert.rejects(adapter.transaction(async tx=>{await tx.put('join:test',{expiresAt:101});now=102;},{validate:()=>{validateCalls++;}}),{code:'EXPIRED'});
  assert.equal(validateCalls,1);assert.equal(await raw.get('join:test'),undefined);
  await assert.rejects(adapter.transaction(async tx=>{await tx.put('account',{rootId:'fake'});},{validate:()=>{throw new Error('account expired');}}));
  assert.equal(await raw.get('account'),undefined);
});
test('native-only routes reject query identity, browser origin, unknown keys and oversized JSON',async()=>{
  const f=await routedFixture();
  assert.equal((await f.call('state?accountId=target')).status,404);
  assert.equal((await f.call('state',undefined,{origin:'https://example.com'})).status,403);
  assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate,accountId:'target'})).status,400);
  assert.equal((await f.call('first-pc/begin',{candidate:'x'.repeat(16384)})).status,413);
});
