import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FRESH_AUTH_CLAIM } from '../src/auth.js';
import { issuer,NOW } from './fixture.mjs';
import { routedFixture } from './enrollment-routes.fixture.mjs';
const action=createRequire(import.meta.url)('../auth0/fresh-auth-action.cjs');
test('namespaced proof drives the full first-PC/phone approval flow; missing proof never writes registration',async()=>{
 const f=await routedFixture(FRESH_AUTH_CLAIM);
 const missing=await f.call('first-pc/begin',{candidate:f.material.pc.candidate},{claims:{[FRESH_AUTH_CLAIM]:undefined,auth_time:Math.floor(f.auth.now()/1000)}});
 assert.equal(missing.status,401);assert.equal(await f.storage.get('account'),undefined);
 assert.equal((await f.bootstrap()).status,200);
 assert.equal((await f.decide((await f.join()).record)).status,200);
 assert.equal((await f.connect('app')).status,101);
});
test('service trusts only selected issuer-signed authentication claim, never token issuance',async()=>{
 const a=await issuer(),env={...a.env,AUTH0_FRESH_AUTH_CLAIM:FRESH_AUTH_CLAIM};
 for(const value of [undefined,true,'1800000000',NOW/1000+1,1.5,-1,Number.MAX_SAFE_INTEGER]){
  const p={...a.claims(),iat:NOW/1000,auth_time:NOW/1000,[FRESH_AUTH_CLAIM]:value};
  assert.equal((await a.verifier.verifyAccount(await a.request('app-1',p),env)).authenticatedAt,null);
 }
 assert.equal((await a.verifier.verifyAccount(await a.request('app-1',{...a.claims(),[FRESH_AUTH_CLAIM]:NOW/1000}),env)).authenticatedAt,NOW);
});
test('review-only Action restricts client, audience, protocol and primary method; keeps original auth time',async()=>{
 const timestamp=new Date(Date.now()-600000).toISOString();
 const base={client:{client_id:'SYNC_EXAMPLE_WINDOWS_CLIENT'},resource_server:{identifier:'https://review-relay.invalid'},connection:{strategy:'google-oauth2'},transaction:{protocol:'oidc-basic-profile'},authentication:{methods:[{name:'federated',timestamp}]}};
 const run=async e=>{const out=[];await action.onExecutePostLogin(e,{accessToken:{setCustomClaim:(...x)=>out.push(x)}});return out;};
 assert.deepEqual(await run(base),[[FRESH_AUTH_CLAIM,Math.floor(Date.parse(timestamp)/1000)]]);
 for(const delta of [{client:{client_id:'other'}},{resource_server:{identifier:'other'}},{connection:{strategy:'auth0'}},{connection:{strategy:'github'}},{transaction:{protocol:'oauth2-refresh-token'}},{authentication:{}},{authentication:{methods:[{name:'federated',timestamp:'invalid'}]}},{authentication:{methods:[{name:'pwd',timestamp}]}},{authentication:{methods:[{name:'mfa',timestamp}]}}])assert.deepEqual(await run({...base,...delta}),[]);
});

test('Google Action preserves stale federation time and never upgrades it using newer MFA, iat or request time',async()=>{
 const old=new Date(Date.now()-600000).toISOString(),fresh=new Date().toISOString();
 const e={client:{client_id:'SYNC_EXAMPLE_ANDROID_CLIENT'},resource_server:{identifier:'https://review-relay.invalid'},connection:{strategy:'google-oauth2'},transaction:{protocol:'oidc-basic-profile'},request:{query:{auth_time:Math.floor(Date.now()/1000),iat:Math.floor(Date.now()/1000)}},authentication:{methods:[{name:'federated',timestamp:old},{name:'federated',timestamp:fresh},{name:'mfa',timestamp:fresh}]}};
 const out=[];await action.onExecutePostLogin(e,{accessToken:{setCustomClaim:(...x)=>out.push(x)}});
 assert.deepEqual(out,[[FRESH_AUTH_CLAIM,Math.floor(Date.parse(old)/1000)]]);
 const f=await routedFixture(FRESH_AUTH_CLAIM);
 assert.equal((await f.call('first-pc/begin',{candidate:f.material.pc.candidate},{claims:{[FRESH_AUTH_CLAIM]:Math.floor(f.auth.now()/1000)-301}})).status,401);
 assert.equal(await f.storage.get('account'),undefined);
});

test('three-client Action accepts iOS only within exact Google/audience/code-flow restrictions',async()=>{
 const timestamp=new Date(Date.now()-5000).toISOString();
 const base={client:{client_id:'SYNC_EXAMPLE_IOS_CLIENT'},resource_server:{identifier:'https://review-relay.invalid'},connection:{strategy:'google-oauth2'},transaction:{protocol:'oidc-basic-profile'},authentication:{methods:[{name:'federated',timestamp}]}};
 const run=async e=>{const out=[];await action.onExecutePostLogin(e,{accessToken:{setCustomClaim:(...v)=>out.push(v)}});return out;};
 assert.deepEqual(await run(base),[[FRESH_AUTH_CLAIM,Math.floor(Date.parse(timestamp)/1000)]]);
 for(const patch of [{client:{client_id:'other'}},{resource_server:{identifier:'other'}},{connection:{strategy:'auth0'}},{transaction:{protocol:'oauth2-refresh-token'}},{authentication:{methods:[{name:'mfa',timestamp}]}},{authentication:{methods:[{name:'federated',timestamp:new Date(Date.now()+60000).toISOString()}]}}])assert.deepEqual(await run({...base,...patch}),[]);
});
