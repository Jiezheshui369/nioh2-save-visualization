import test from 'node:test';
import assert from 'node:assert/strict';
import { EnrollmentAuthority,EnrollmentService,verificationPhrase } from '../src/enrollment.js';
import { enrollmentFixture } from './enrollment.fixture.mjs';
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('production default cannot enroll and account capabilities cannot be fabricated',async()=>{
  const f=await enrollmentFixture();await rejects(new EnrollmentService().state(f.pcAccount),'NOT_CONFIGURED');
  await rejects(f.service.beginFirstPc({},f.pc.candidate),'UNAUTHORIZED');
  await rejects(f.service.beginFirstPc(JSON.parse(JSON.stringify(f.pcAccount)),f.pc.candidate),'UNAUTHORIZED');
  const foreign=new EnrollmentAuthority({verify:async()=>({}),clients:{}});
  assert.throws(()=>foreign.resolve(f.pcAccount),e=>e.code==='UNAUTHORIZED');
});
test('first computer requires fresh authentication, correct client and private-key proof',async()=>{
  const f=await enrollmentFixture();assert.deepEqual(await f.service.state(f.pcAccount),{state:'no-pc'});
  await rejects(f.service.beginFirstPc(f.phoneAccount,f.pc.candidate),'UNAUTHORIZED');
  await rejects(f.service.beginFirstPc(await f.authority.authenticate('pc-old'),f.pc.candidate),'UNAUTHORIZED');
  const r=await f.service.beginFirstPc(f.pcAccount,f.pc.candidate);assert.equal((await f.service.state(f.pcAccount)).state,'pc-awaiting-proof');
  assert.equal(await f.store.get('device:pc-1'),undefined);
  await rejects(f.service.finishFirstPc(f.pcAccount,r.id,await f.sign(r,'first-pc',f.phone)),'INVALID_PROOF');
  await f.service.finishFirstPc(f.pcAccount,r.id,await f.sign(r,'first-pc'));assert.equal((await f.service.state(f.pcAccount)).state,'pc-ready');
  await rejects(f.service.finishFirstPc(f.pcAccount,r.id,await f.sign(r,'first-pc')),'REPLAY');
});
test('concurrent first-computer requests cannot create two roots',async()=>{
  const f=await enrollmentFixture();const results=await Promise.allSettled([f.service.beginFirstPc(f.pcAccount,f.pc.candidate),f.service.beginFirstPc(f.pcAccount,f.otherPhone.candidate)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUSY');
});
test('first-computer challenge expires without creating a device',async()=>{
  const f=await enrollmentFixture(),r=await f.service.beginFirstPc(f.pcAccount,f.pc.candidate);f.advance(120001);
  await rejects(f.service.finishFirstPc(f.pcAccount,r.id,await f.sign(r,'first-pc')),'EXPIRED');assert.equal(await f.store.get('device:pc-1'),undefined);
});
test('no trusted computer means phone cannot request admission',async()=>{
  const f=await enrollmentFixture();await rejects(f.service.beginPhoneJoin(f.phoneAccount,f.phone.candidate),'PC_NOT_AUTHORIZED');
});
test('phone proof does not enroll; only the trusted computer decision activates it',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join();
  assert.equal(await f.store.get('device:phone-1'),undefined);assert.equal((await f.store.get('join:'+r.id)).state,'pending-approval');
  assert.match(await verificationPhrase(r),/^[A-F0-9]{4}( [A-F0-9]{4}){5}$/);
  await f.approve(r);const d=await f.store.get('device:phone-1');assert.equal(d.state,'active');assert.equal(d.registration.purpose,'phone-approve');
});
test('phrase commits to exact account, both signing/encryption keys, nonce and request',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join(),phrase=await verificationPhrase(r);
  const variants=[];
  for(const mutate of [v=>{v.account.subject='different';},v=>{v.id='different';},v=>{v.nonce='different';},
    v=>{v.root.agreementKey=f.otherPhone.candidate.agreementKey;},v=>{v.root.signingKey=f.otherPhone.candidate.signingKey;},
    v=>{v.candidate.agreementKey=f.otherPhone.candidate.agreementKey;},v=>{v.candidate.signingKey=f.otherPhone.candidate.signingKey;}]){
    const copy=structuredClone(r);mutate(copy);variants.push(copy);
  }
  for(const v of variants)assert.notEqual(await verificationPhrase(v),phrase);
});
test('app signature and a login capability cannot substitute computer approval',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join(),phrase=await verificationPhrase(r);
  await rejects(f.service.decidePhone(f.phoneAccount,r.id,'approve',phrase,await f.sign(r,'phone-approve',f.phone)),'UNAUTHORIZED');
  await rejects(f.service.decidePhone(f.pcAccount,r.id,'approve',phrase,await f.sign(r,'phone-proof',f.phone)),'INVALID_PROOF');
  assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('three phrase mismatches close the request without authorization',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join(),proof=await f.sign(r,'phone-approve');
  for(let i=0;i<3;i++)await rejects(f.service.decidePhone(f.pcAccount,r.id,'approve','WRONG',proof),'PHRASE_MISMATCH');
  await rejects(f.approve(r),'REPLAY');assert.equal((await f.store.get('join:'+r.id)).state,'rejected');assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('explicit computer rejection and phone withdrawal both prevent later approval',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const first=await f.join();
  await f.service.decidePhone(f.pcAccount,first.id,'reject',await verificationPhrase(first),await f.sign(first,'phone-reject'));
  await rejects(f.approve(first),'REPLAY');const second=await f.join();
  await f.service.withdrawPhone(f.phoneAccount,second.id,await f.sign(second,'phone-withdraw',f.phone));await rejects(f.approve(second),'REPLAY');
  assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('another account cannot prove, approve or revoke through this account partition',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join();
  await rejects(f.service.decidePhone(await f.authority.authenticate('pc-other'),r.id,'approve',await verificationPhrase(r),await f.sign(r,'phone-approve')),'UNAUTHORIZED');
  await rejects(f.service.provePhoneJoin(await f.authority.authenticate('app-other'),r.id,await f.sign(r,'phone-proof',f.phone)),'REPLAY');
  await rejects(f.service.beginDeviceRevoke(await f.authority.authenticate('pc-other'),'pc-1'),'UNAUTHORIZED');
  assert.equal(await f.store.get('device:phone-1'),undefined);
});

test('cross-account proof and modified key transcript cannot advance a fresh request',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();
  const r=await f.service.beginPhoneJoin(f.phoneAccount,f.phone.candidate);
  await rejects(f.service.provePhoneJoin(await f.authority.authenticate('app-other'),r.id,await f.sign(r,'phone-proof',f.phone)),'UNAUTHORIZED');
  const changed=structuredClone(r);changed.candidate.agreementKey=f.otherPhone.candidate.agreementKey;
  await rejects(f.service.provePhoneJoin(f.phoneAccount,r.id,await f.sign(changed,'phone-proof',f.phone)),'INVALID_PROOF');
  assert.equal((await f.store.get('join:'+r.id)).state,'awaiting-proof');
  assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('duplicated approvals and competing approve/reject are atomic and one-shot',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join();
  const results=await Promise.allSettled([f.approve(r),f.approve(r)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await f.store.get('account')).revision,2);
  const g=await enrollmentFixture();await g.bootstrap();const s=await g.join(),phrase=await verificationPhrase(s);
  const approveProof=await g.sign(s,'phone-approve'),rejectProof=await g.sign(s,'phone-reject');
  const race=await Promise.allSettled([
    g.service.decidePhone(g.pcAccount,s.id,'approve',phrase,approveProof),
    g.service.decidePhone(g.pcAccount,s.id,'reject',phrase,rejectProof)
  ]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const terminal=(await g.store.get('join:'+s.id)).state;
  assert.ok(['approved','rejected'].includes(terminal));
  assert.equal((await g.store.get('device:phone-1'))?.state==='active',terminal==='approved');
});
test('timeout before approval and principal expiry cannot activate a phone',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join();f.advance(120001);await rejects(f.approve(r),'EXPIRED');assert.equal(await f.store.get('device:phone-1'),undefined);
  const g=await enrollmentFixture();const short=await g.authority.authenticate('pc-short');const c=await g.service.beginFirstPc(short,g.pc.candidate);g.advance(11);
  await rejects(g.service.finishFirstPc(short,c.id,await g.sign(c,'first-pc')),'UNAUTHORIZED');assert.equal(await g.store.get('device:pc-1'),undefined);
});
test('time elapsing during real signature verification is rechecked before commit',async t=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join(),sig=await f.sign(r,'phone-approve');
  const verify=crypto.subtle.verify.bind(crypto.subtle);
  t.mock.method(crypto.subtle,'verify',async(...args)=>{const result=await verify(...args);f.advance(120001);return result;});
  await rejects(f.service.decidePhone(f.pcAccount,r.id,'approve',await verificationPhrase(r),sig),'EXPIRED');assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('computer key rotation invalidates a pending phone binding',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join();const root=await f.store.get('device:pc-1');await f.store.put('device:pc-1',{...root,version:2});
  await rejects(f.approve(r),'STALE');assert.equal(await f.store.get('device:phone-1'),undefined);
});
test('signed phone revocation advances its version and cannot replay',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();await f.approve(await f.join());const r=await f.service.beginDeviceRevoke(f.pcAccount,'phone-1');
  await f.service.revokeDevice(f.pcAccount,r.id,await f.sign(r,'device-revoke'));const phone=await f.store.get('device:phone-1');assert.equal(phone.state,'revoked');assert.equal(phone.version,2);
  await rejects(f.service.revokeDevice(f.pcAccount,r.id,await f.sign(r,'device-revoke')),'REPLAY');await rejects(f.service.beginPhoneJoin(f.phoneAccount,f.phone.candidate),'DEVICE_ID_USED');
});
test('revoking first computer disables descendants and blocks delayed approvals',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();const r=await f.join(),revoke=await f.service.beginDeviceRevoke(f.pcAccount,'pc-1');
  const results=await Promise.allSettled([f.service.revokeDevice(f.pcAccount,revoke.id,await f.sign(revoke,'device-revoke')),f.approve(r)]);
  assert.equal(results[0].status,'fulfilled');assert.equal((await f.service.state(f.pcAccount)).state,'pc-revoked');
  assert.notEqual((await f.store.get('device:phone-1'))?.state,'active');assert.equal((await f.store.get('account')).accountEpoch,2);
  await rejects(f.service.beginFirstPc(f.pcAccount,f.pc.candidate),'ALREADY_ENROLLED');
});
test('private or self-asserted-role fields are rejected and caller mutation cannot change a stored request',async()=>{
  const f=await enrollmentFixture();await f.bootstrap();await rejects(f.service.beginPhoneJoin(f.phoneAccount,{...f.phone.candidate,role:'pc'}),'INVALID_DEVICE');
  await rejects(f.service.beginPhoneJoin(f.phoneAccount,{...f.phone.candidate,signingKey:{...f.phone.candidate.signingKey,d:'secret'}}),'INVALID_PUBLIC_KEY');
  const r=await f.join();r.candidate.keyId='changed';assert.equal((await f.store.get('join:'+r.id)).candidate.keyId,'key-phone-1');
  assert.equal(JSON.stringify([...f.store.values.values()]).includes('privateKey'),false);
});
