import { JwtVerifier, accountKey } from '../src/auth.js';
import { beginConnection, connectionBytes } from '../src/connect-proof.js';
import { EnrollmentStorage } from '../src/enrollment-storage.js';
export const CLAIM = 'https://save-asset.example/device';
export const NOW = 1_800_000_000_000;
const b64 = bytes => Buffer.from(bytes).toString('base64url');
export async function issuer() {
  // Ephemeral synthetic signing material exists in memory only; no real credentials.
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'unit-key', alg: 'RS256' };
  let now = NOW, requests = 0, failJwks = false;
  const verifier = new JwtVerifier(async (url, options) => {
    requests++; if (failJwks) throw new Error('must-not-leak-provider-detail');
    if (url !== 'https://issuer.example/.well-known/jwks.json' || options.redirect !== 'manual') throw new Error('Untrusted JWKS source');
    return Response.json({ keys: [jwk] });
  }, () => now);
  const env = { RELAY_ENABLED: 'true', DEVICE_DIRECTORY_READY: 'true', ENROLLMENT_ENABLED: 'true', AUTH0_PC_CLIENT_ID:'windows-client', AUTH0_APP_CLIENT_ID:'android-client', AUTH0_ISSUER: 'https://issuer.example/',
    AUTH0_ALLOWED_SUBJECT: 'unit-account', AUTH0_AUDIENCE: 'https://save-asset.example/api', AUTH0_CLIENT_IDS: 'windows-client,android-client', AUTH0_DEVICE_CLAIM: CLAIM };
  env.AUTH0_FRESH_AUTH_CLAIM='auth_time'; // Explicit synthetic issuer profile only.
  const device = (id = 'app-1') => ({ id, keyId: 'key-' + id, version: 1, role: id.startsWith('pc') ? 'pc' : 'app' });
  const claims = (id = 'app-1') => ({ iss: env.AUTH0_ISSUER, sub: 'unit-account', aud: env.AUTH0_AUDIENCE,
    azp: id.startsWith('pc') ? 'windows-client' : 'android-client', scope: 'relay:connect', iat: NOW/1000, exp: NOW/1000 + 3600, [CLAIM]: device(id) });
  async function token(payload = claims(), header = { alg: 'RS256', typ: 'JWT', kid: 'unit-key' }) {
    const input = b64(JSON.stringify(header)) + '.' + b64(JSON.stringify(payload));
    return input + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input)));
  }
  let bound;
  const keys=new Map();
  async function register(storage,id,subject='unit-account') {
    let material=keys.get(id);
    if(!material){const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
      const agreement=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
      const pub=async key=>{const j=await crypto.subtle.exportKey('jwk',key);return {kty:j.kty,crv:j.crv,x:j.x,y:j.y};};
      material={privateKey:signing.privateKey,signingKey:await pub(signing.publicKey),agreementKey:await pub(agreement.publicKey)};keys.set(id,material);}
    await storage.put('device:'+id,{...device(id),signingKey:material.signingKey,agreementKey:material.agreementKey,state:'active',account:{issuer:env.AUTH0_ISSUER,subject}});
  }
  async function request(id = 'app-1', payload) {
    const request=new Request('https://relay.example/v1/connect', {headers: { Authorization: 'Bearer ' + await token(payload ?? claims(id)), Upgrade: 'websocket' }});
    if(bound){try{const identity=await verifier.verifyAccount(request,env);
      const challenge=await beginConnection(new EnrollmentStorage(bound.storage,{now:()=>now}),identity,id,request.headers.get('Authorization'),env,()=>now);
      request.headers.set('X-Save-Asset-Challenge',challenge.id);
      request.headers.set('X-Save-Asset-Proof',b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.get(id).privateKey,connectionBytes(challenge))));
    }catch{/* Negative requests still reach the real admission boundary without proof. */}}
    return request;
  }
  return { verifier, env, device, claims, token, request, jwk, register, bind:context=>{bound=context;}, requests: () => requests,
    now: () => now, advance: ms => { now += ms; }, failJwks: () => { failJwks = true; } };
}
export class MemoryStorage {
  constructor() { this.values = new Map(); this.queue = Promise.resolve(); this.alarm = null; }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix }) { return new Map([...this.values].filter(([k]) => k.startsWith(prefix)).map(([k,v]) => [k, structuredClone(v)])); }
  async transaction(callback) {
    const run = this.queue.then(async () => {
      const copy = new MemoryStorage(); copy.values = structuredClone(this.values);
      const result = await callback(copy); this.values = copy.values; return result;
    });
    this.queue = run.catch(() => {}); return run;
  }
  async setAlarm(time) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}
export class FakeSocket {
  constructor() { this.sent = []; this.closed = null; }
  serializeAttachment(v) { this.value = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.value); }
  send(v) { if (this.closed) throw new Error('closed'); this.sent.push(v); }
  close(code, reason) { this.closed = { code, reason }; }
}
export async function context(auth, subject = 'unit-account') {
  const key = await accountKey({ issuer: auth.env.AUTH0_ISSUER, subject });
  const sockets = [], storage = new MemoryStorage();
  const ctx = { id: { toString: () => key }, storage, getWebSockets: () => sockets,
    acceptWebSocket: ws => sockets.push(ws) };
  const env = { ...auth.env, ACCOUNT_RELAYS: { idFromName: name => ({ toString: () => name }) } };
  for (const id of ['app-1','app-2','pc-1','pc-2']) await auth.register(storage,id,subject);
  await storage.put('account',{accountKey:key,account:{issuer:env.AUTH0_ISSUER,subject},rootId:'pc-1',accountEpoch:1,revision:1});
  auth.bind({storage});
  return { ctx, env, sockets, storage, options: { verifier: auth.verifier, now: auth.now,
    pair: () => [new FakeSocket(), new FakeSocket()], upgrade: () => ({ status: 101 }) } };
}
export const frame = (from = 'app-1', to = 'pc-1', requestId = 'request-1', ciphertext = 'AQ') =>
  JSON.stringify({ protocol: 'nioh-relay/1', requestId, fromDeviceId: from, toDeviceId: to, ciphertext });
