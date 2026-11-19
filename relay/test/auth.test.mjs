import test from 'node:test';
import assert from 'node:assert/strict';
import { JwtVerifier, accountKey } from '../src/auth.js';
import { createWorker } from '../src/worker.js';
import { CLAIM, NOW, issuer } from './fixture.mjs';

const auth = await issuer();
test('account JWT ignores missing and self-reported legacy device claims', async () => {
  for(const legacy of [undefined,{id:'attacker',role:'admin',version:999,keyId:'forged'}]) {
    const identity=await auth.verifier.verifyAccount(await auth.request('app-1',{...auth.claims(),[CLAIM]:legacy}),auth.env);
    assert.equal(identity.device,undefined);assert.equal(identity.subject,'unit-account');assert.equal(identity.clientId,'android-client');
  }
});
test('real RS256 signature, JWKS cache and issuer/sub account identity', async () => {
  const identity = await auth.verifier.verifyAccount(await auth.request(), auth.env);
  assert.equal(identity.subject, 'unit-account'); assert.equal(identity.clientId, 'android-client'); assert.equal(identity.device, undefined);
  await auth.verifier.verifyAccount(await auth.request(), auth.env); assert.equal(auth.requests(), 1);
  assert.notEqual(await accountKey(identity), await accountKey({ ...identity, subject: 'other-account' }));
  assert.notEqual(await accountKey(identity), await accountKey({ ...identity, issuer: 'https://other.example/' }));
});
for (const [name, change] of [
  ['wrong issuer', { iss: 'https://other.example/' }], ['wrong audience', { aud: 'other' }],
  ['expired token', { exp: NOW/1000 }], ['future nbf', { nbf: NOW/1000 + 6 }], ['future iat', { iat: NOW/1000 + 6 }],
  ['missing scope', { scope: 'openid' }], ['wrong native client', { azp: 'untrusted-client' }],
  ['email identity substitution', { sub: '' }],
]) test('rejects ' + name, async () => {
  await assert.rejects(auth.verifier.verifyAccount(await auth.request('app-1', { ...auth.claims(), ...change }), auth.env),
    e => ['UNAUTHORIZED','DEVICE_NOT_AUTHORIZED'].includes(e.code));
});
test('algorithm confusion, external JWK URL and signature tampering rejected', async () => {
  for (const header of [{ alg: 'HS256', kid: 'unit-key' }, { alg: 'none', kid: 'unit-key' },
    { alg: 'RS256', kid: 'unit-key', jku: 'https://attacker.example/keys' }]) {
    await assert.rejects(auth.verifier.verifyAccount(new Request('https://relay.example/', { headers: {
      Authorization: 'Bearer ' + await auth.token(auth.claims(), header) } }), auth.env), { code: 'UNAUTHORIZED' });
  }
  const token = await auth.token(); const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...auth.claims(), sub: 'attacker' })).toString('base64url');
  await assert.rejects(auth.verifier.verifyAccount(new Request('https://relay.example/', { headers: { Authorization: 'Bearer ' + parts.join('.') } }), auth.env), { code: 'UNAUTHORIZED' });
});
test('accepts RFC9068 at+jwt/client_id and rejects contradictory client identities', async () => {
  const claims={...auth.claims(),azp:undefined,client_id:'android-client'};
  const request=new Request('https://relay.example/',{headers:{Authorization:'Bearer '+await auth.token(claims,{alg:'RS256',typ:'at+jwt',kid:'unit-key'})}});
  assert.equal((await auth.verifier.verifyAccount(request,auth.env)).subject,'unit-account');
  await assert.rejects(auth.verifier.verifyAccount(await auth.request('app-1',{...auth.claims(),client_id:'windows-client'}),auth.env),{code:'UNAUTHORIZED'});
});
test('unknown kids cannot repeatedly fetch JWKS', async () => {
  const local = await issuer();
  const request = new Request('https://relay.example/', { headers: { Authorization: 'Bearer ' + await local.token(local.claims(), { alg: 'RS256', kid: 'missing' }) } });
  for (let i = 0; i < 4; i++) await assert.rejects(local.verifier.verifyAccount(request, local.env));
  assert.equal(local.requests(), 1);
});
test('missing configuration and broken JWKS fail closed, without leaking error details', async () => {
  await assert.rejects(auth.verifier.verifyAccount(await auth.request(), {}), { code: 'NOT_CONFIGURED' });
  const verifier = new JwtVerifier(async () => Response.json({ keys: [] }), () => NOW);
  await assert.rejects(verifier.verifyAccount(await auth.request(), auth.env));
  const broken = await issuer(); broken.failJwks();
  await assert.rejects(broken.verifier.verifyAccount(await broken.request(), broken.env), { code: 'AUTH_UNAVAILABLE' });
});

test('manual JWKS redirects are rejected without fetching the redirect target', async () => {
  let calls=0;
  const verifier=new JwtVerifier(async(url,options)=>{
    calls++;assert.equal(url,auth.env.AUTH0_ISSUER+'.well-known/jwks.json');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/keys'}});
  },()=>NOW);
  await assert.rejects(verifier.verifyAccount(await auth.request(),auth.env),{code:'AUTH_UNAVAILABLE'});
  assert.equal(calls,1);
});
test('refreshes JWKS on rotated kid after throttle window; bounds upstream body', async () => {
  const first = await issuer(), second = await issuer(); let keys = [first.jwk], requests = 0;
  const verifier = new JwtVerifier(async () => { requests++; return Response.json({keys}); },first.now);
  await verifier.verifyAccount(await first.request(),first.env);
  keys = [{...second.jwk,kid:'rotated-key'}]; first.advance(5001);
  const request = new Request('https://relay.example/',{headers:{Authorization:'Bearer '+await second.token(second.claims(),{alg:'RS256',kid:'rotated-key'})}});
  assert.equal((await verifier.verifyAccount(request,first.env)).subject,'unit-account'); assert.equal(requests,2);
  const oversized = new JwtVerifier(async () => new Response(new Uint8Array(64*1024+1)),first.now);
  await assert.rejects(oversized.verifyAccount(await first.request(),first.env),{code:'AUTH_UNAVAILABLE'});
});
test('worker routes only verified account; strips client identity headers', async () => {
  let routed;
  const namespace = { idFromName: name => name, get: id => ({ fetch: async request => {
    routed = { id, request }; return Response.json({ routed: true }); } }) };
  const request = await auth.request(); request.headers.set('X-Account-Subject', 'attacker');
  const response = await createWorker(auth.verifier).fetch(request, { ...auth.env, ACCOUNT_RELAYS: namespace });
  assert.equal(response.status, 200);
  assert.equal(routed.id, await accountKey({ issuer: auth.env.AUTH0_ISSUER, subject: 'unit-account' }));
  assert.equal(routed.request.headers.get('X-Account-Subject'), null);
});
test('deployment default rejects protected requests; URL tokens and browser origin rejected', async () => {
  const worker = createWorker(auth.verifier), env = { ...auth.env, ACCOUNT_RELAYS: {} };
  assert.equal((await worker.fetch(await auth.request(), {})).status, 503);
  assert.equal((await worker.fetch(new Request('https://relay.example/health'), {})).status, 200);
  const urlToken = new Request('https://relay.example/v1/connect?token=never-log-this', { headers: { Upgrade: 'websocket' } });
  assert.equal((await worker.fetch(urlToken, env)).status, 404);
  const browser = await auth.request(); browser.headers.set('Origin', 'https://example.com');
  assert.equal((await worker.fetch(browser, env)).status, 403);
  assert.equal((await worker.fetch(new Request('http://relay.example/v1/connect'), env)).status, 403);
});
