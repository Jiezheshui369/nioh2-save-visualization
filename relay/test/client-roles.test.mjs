import test from 'node:test';
import assert from 'node:assert/strict';
import {clientRoles,clientRole} from '../src/client-roles.js';
import {routedFixture} from './enrollment-routes.fixture.mjs';
const config={AUTH0_ALLOWED_SUBJECT:'unit-account',AUTH0_ISSUER:'https://issuer.example/',AUTH0_AUDIENCE:'api',AUTH0_CLIENT_IDS:'windows-client,android-client,ios-client',AUTH0_PC_CLIENT_ID:'windows-client',AUTH0_APP_CLIENT_IDS:'android-client,ios-client'};
test('explicit roles preserve Android and add iOS; legacy single-app remains valid',()=>{
 assert.deepEqual(clientRoles(config),{'windows-client':'pc','android-client':'app','ios-client':'app'});
 for(const id of ['android-client','ios-client'])assert.equal(clientRole({clientId:id},config),'app');
 for(const id of ['unknown','__proto__','constructor'])assert.throws(()=>clientRole({clientId:id},config),{code:'UNAUTHORIZED'});
 assert.deepEqual(clientRoles({...config,AUTH0_APP_CLIENT_IDS:undefined,AUTH0_APP_CLIENT_ID:'android-client'}),{'windows-client':'pc','android-client':'app'});
});
test('bad role mapping fails closed; explicit empty list cannot use legacy fallback',()=>{
 for(const list of ['',',','android-client,','android-client,android-client','windows-client,ios-client','other-client','ios-client,constructor'])
  assert.throws(()=>clientRoles({...config,AUTH0_APP_CLIENT_IDS:list,AUTH0_APP_CLIENT_ID:'android-client'}),{code:'NOT_CONFIGURED'});
});
for(const mobile of ['android-client','ios-client'])test(mobile+' JWT enrollment, possession, PC approval and WSS remain mandatory',async()=>{
 const f=await routedFixture('auth_time',{AUTH0_CLIENT_IDS:'windows-client,android-client,ios-client',AUTH0_APP_CLIENT_IDS:'android-client,ios-client'});
 assert.equal((await f.bootstrap()).status,200);
 const options={role:'app',claims:{azp:mobile}},candidate=f.material.phone.candidate;
 const begin=await f.call('phone/begin',{candidate},options);assert.equal(begin.status,200);
 const r=begin.body;
 assert.equal((await f.call('phone/prove',{id:r.id,signature:await f.sign(r,'phone-proof',f.material.phone)},options)).status,200);
 assert.equal((await f.decide(r,'approve',options)).status,401);
 assert.equal((await f.connect('app',{claims:{azp:mobile}})).status,403);
 assert.equal((await f.decide(r)).status,200);
 assert.equal((await f.connect('app',{claims:{azp:mobile}})).status,101);
 assert.equal((await f.call('phone/begin',{candidate:f.material.otherPhone.candidate},{...options,claims:{azp:mobile,auth_time:undefined}})).status,401);
 assert.equal((await f.call('state',undefined,{claims:{azp:'unlisted'}})).status,401);
});
