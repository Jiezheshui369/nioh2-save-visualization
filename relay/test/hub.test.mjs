import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountHub } from '../src/hub.js';
import { context, frame, issuer } from './fixture.mjs';

async function setup() {
  const auth = await issuer(), c = await context(auth), hub = new AccountHub(c.ctx, c.env, c.options);
  assert.equal((await hub.fetch(await auth.request('app-1'))).status, 101);
  assert.equal((await hub.fetch(await auth.request('pc-1'))).status, 101);
  return { auth, ...c, hub, app: c.sockets[0], pc: c.sockets[1] };
}
test('forwards only matching app requests/PC results; never stores token or ciphertext', async () => {
  const s = await setup();
  await s.hub.webSocketMessage(s.app, frame());
  assert.deepEqual(JSON.parse(s.pc.sent[0]), JSON.parse(frame()));
  await s.hub.webSocketMessage(s.pc, frame('pc-1', 'app-1'));
  assert.deepEqual(JSON.parse(s.app.sent[0]), JSON.parse(frame('pc-1','app-1')));
  const stored = JSON.stringify([...s.storage.values]);
  for (const forbidden of ['ciphertext','Authorization','Bearer ','snapshot','canonicalSnapshot']) assert.equal(stored.includes(forbidden), false);
  assert.equal(JSON.stringify(s.app.deserializeAttachment()).includes('Bearer'), false);
});
test('DO independently verifies JWT and account namespace, rejecting client identity headers', async () => {
  const s = await setup();
  const other = await s.auth.request('app-1', { ...s.auth.claims(), sub: 'other-account' });
  other.headers.set('X-Account-Subject', 'unit-account');
  assert.equal((await s.hub.fetch(other)).status, 401);
  const unsigned = new Request('https://relay.internal/v1/connect', { headers: { Upgrade: 'websocket', 'X-Account-Subject': 'unit-account' } });
  assert.equal((await s.hub.fetch(unsigned)).status, 401);
});
test('missing directory, revoked state and registered version changes reject connection proof', async () => {
  const s = await setup();
  assert.equal((await s.hub.fetch(await s.auth.request('app-9'))).status, 403);
  const stale=await s.auth.request('app-1'),changed=await s.storage.get('device:app-1');
  changed.version++;await s.storage.put('device:app-1',changed);
  assert.equal((await s.hub.fetch(stale)).status,403);
  const record = await s.storage.get('device:app-1'); record.state = 'revoked'; await s.storage.put('device:app-1', record);
  assert.equal((await s.hub.fetch(await s.auth.request())).status, 403);
});

test('registered proof is one-use, token-bound, role-bound and never replaced by a legacy claim',async()=>{
  const s=await setup(),valid=await s.auth.request();
  assert.equal((await s.hub.fetch(valid.clone())).status,101);
  assert.equal((await s.hub.fetch(valid.clone())).status,403);
  const tampered=await s.auth.request();tampered.headers.set('X-Save-Asset-Proof',Buffer.alloc(64).toString('base64url'));
  assert.equal((await s.hub.fetch(tampered)).status,403);
  const swapped=await s.auth.request();swapped.headers.set('Authorization','Bearer '+await s.auth.token({...s.auth.claims(),iat:s.auth.now()/1000-1}));
  assert.equal((await s.hub.fetch(swapped)).status,403);
  assert.equal((await s.hub.fetch(await s.auth.request('app-1',{...s.auth.claims(),azp:'windows-client'}))).status,403);
  const noProof=await s.auth.request();noProof.headers.delete('X-Save-Asset-Proof');
  assert.equal((await s.hub.fetch(noProof)).status,403);
  const forgedClaims={...s.auth.claims(),[s.env.AUTH0_DEVICE_CLAIM]:{id:'pc-1',role:'pc',version:99,keyId:'attacker'}};
  assert.equal((await s.hub.fetch(await s.auth.request('app-1',forgedClaims))).status,101);
  assert.equal(s.sockets.at(-1).deserializeAttachment().device.id,'app-1');
});

test('registered public key replacement invalidates outstanding signatures',async()=>{
  const s=await setup(),pending=await s.auth.request();
  const d=await s.storage.get('device:app-1'),other=await s.storage.get('device:app-2');
  d.signingKey=other.signingKey;await s.storage.put('device:app-1',d);
  assert.equal((await s.hub.fetch(pending)).status,403);
});
test('rejects cross-account recipients and forged sender before forwarding', async () => {
  const s = await setup();
  await s.hub.webSocketMessage(s.app, frame('app-2','pc-1'));
  assert.equal(s.pc.sent.length, 0); assert.ok(s.app.closed);
  const t = await setup();
  const d = await t.storage.get('device:pc-1'); d.account.subject = 'other'; await t.storage.put('device:pc-1', d);
  await t.hub.webSocketMessage(t.app, frame());
  assert.equal(t.pc.sent.length, 0);
});
test('unsolicited results, duplicate requests and response replay never forward', async () => {
  const s = await setup();
  await s.hub.webSocketMessage(s.pc, frame('pc-1','app-1'));
  assert.equal(s.app.sent.length, 0);
  await s.hub.webSocketMessage(s.app, frame());
  const sent = s.pc.sent.length;
  await s.hub.webSocketMessage(s.app, frame()); assert.equal(s.pc.sent.length, sent);
  await s.hub.webSocketMessage(s.pc, frame('pc-1','app-1'));
  const received = s.app.sent.length;
  await s.hub.webSocketMessage(s.pc, frame('pc-1','app-1'));
  assert.equal(s.app.sent.length, received);
});
test('hibernation reconstructs authorization, rate and replay state from metadata', async () => {
  const s = await setup(); await s.hub.webSocketMessage(s.app, frame());
  const resumed = new AccountHub(s.ctx, s.env, s.options); // New instance, same DO storage+attachments.
  await resumed.webSocketMessage(s.pc, frame('pc-1','app-1'));
  assert.equal(JSON.parse(s.app.sent[0]).fromDeviceId, 'pc-1');
  const delivered = s.pc.sent.length;
  await resumed.webSocketMessage(s.app, frame()); assert.equal(s.pc.sent.length, delivered);
});
test('reconnect replaces prior session and rejects late replies across generations', async () => {
  const s = await setup(); await s.hub.webSocketMessage(s.app, frame());
  assert.equal((await s.hub.fetch(await s.auth.request())).status, 101);
  assert.equal(s.app.closed.reason, 'REPLACED'); const replacement = s.sockets.at(-1);
  await s.hub.webSocketMessage(s.pc, frame('pc-1','app-1'));
  assert.equal(replacement.sent.length, 0);
  await s.hub.webSocketMessage(replacement, frame('app-1','pc-1','new-request'));
  assert.equal(JSON.parse(s.pc.sent.at(-1)).requestId, 'new-request');
});
test('token expiry alarm closes idle sockets and cleans expired request metadata', async () => {
  const s = await setup(); await s.hub.webSocketMessage(s.app, frame());
  assert.ok(s.storage.alarm > s.auth.now()); s.auth.advance(3_600_001);
  await new AccountHub(s.ctx, s.env, s.options).alarm();
  assert.ok(s.app.closed); assert.ok(s.pc.closed);
  assert.equal((await s.storage.list({ prefix: 'pending:' })).size, 0); assert.equal(s.storage.alarm, null);
});
test('directory revocation and deployment disablement close existing sockets', async () => {
  const s = await setup(); const d = await s.storage.get('device:app-1');
  d.state = 'revoked'; await s.storage.put('device:app-1',d); await s.hub.alarm(); assert.ok(s.app.closed);
  s.env.RELAY_ENABLED = 'false'; await s.hub.alarm(); assert.ok(s.pc.closed);
});
test('rechecks authorization after async ledger work, before send', async () => {
  const s = await setup(), original = s.hub.ledger.bind(s.hub);
  s.hub.ledger = async (...args) => {
    await original(...args); const d = await s.storage.get('device:pc-1'); d.state = 'revoked'; await s.storage.put('device:pc-1',d);
  };
  await s.hub.webSocketMessage(s.app, frame()); assert.equal(s.pc.sent.length, 0);
});
test('message and reconnect limits survive new instances and sessions', async () => {
  const s = await setup();
  for (let i=0; i<30; i++) await s.hub.webSocketMessage(s.app,'ping');
  assert.equal(s.app.sent.filter(v => v === 'pong').length, 30);
  assert.equal((await s.hub.fetch(await s.auth.request())).status, 101); const fresh = s.sockets.at(-1);
  await new AccountHub(s.ctx,s.env,s.options).webSocketMessage(fresh,'ping');
  assert.equal(fresh.closed.reason,'RATE_LIMITED');
  const t = await setup();
  for (let i=0;i<5;i++) assert.equal((await t.hub.fetch(await t.auth.request())).status,101);
  assert.equal((await t.hub.fetch(await t.auth.request())).status,429);
});
test('strict frame structure, canonical base64url, body limits and opposite roles', async () => {
  for (const message of [frame('app-1','pc-1','req','AB'), frame('app-1','pc-1','req','AQ=='),
    JSON.stringify({ ...JSON.parse(frame()), snapshot: { private: true } }), new ArrayBuffer(1),
    frame('app-1','pc-1','req',Buffer.alloc(64*1024+1).toString('base64url')), frame('app-1','app-2')]) {
    const s = await setup(); await s.hub.webSocketMessage(s.app,message); assert.equal(s.pc.sent.length,0); assert.ok(s.app.closed);
  }
});
test('offline peer errors, close and error lifecycle preserve no queued payload', async () => {
  const s = await setup(); await s.hub.webSocketClose(s.pc,1000);
  await s.hub.webSocketMessage(s.app,frame()); assert.equal(JSON.parse(s.app.sent[0]).error,'PEER_OFFLINE');
  assert.equal((await s.storage.list({prefix:'pending:'})).size,0);
  await s.hub.webSocketError(s.app); assert.ok(s.app.closed); assert.equal(s.storage.alarm,null);
});
test('aggregate byte limits are transactional and survive hibernation', async () => {
  const s=await setup(),identity=s.app.deserializeAttachment();
  await s.hub.consume(identity,32*1024*1024);
  const before=await s.storage.get('limits:device:app-1');
  await assert.rejects(new AccountHub(s.ctx,s.env,s.options).consume(identity,1),{code:'RATE_LIMITED'});
  assert.deepEqual(await s.storage.get('limits:device:app-1'),before);
});
test('full replay ledger rejects new requests without evicting active entries', async () => {
  const s=await setup();
  for(let i=0;i<256;i++) await s.storage.put('pending:synthetic-'+i,{expiresAt:s.auth.now()+60000,state:'pending'});
  await s.hub.webSocketMessage(s.app,frame());
  assert.equal(JSON.parse(s.app.sent[0]).error,'CAPACITY'); assert.equal(s.pc.sent.length,0);
  assert.equal((await s.storage.list({prefix:'pending:'})).size,256);
});
for (const reconnect of ['sender', 'recipient', 'expiry']) test('final synchronous gate blocks interleaved ' + reconnect, async () => {
  const s = await setup(); await s.hub.webSocketMessage(s.app, frame());
  const original = s.hub.live.bind(s.hub); let checks = 0, release, reached;
  const barrier = new Promise(resolve => { reached = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  s.hub.live = async ws => {
    const identity = await original(ws);
    if (ws === s.app && ++checks === 2) { reached(); await held; }
    return identity;
  };
  const inFlight = s.hub.webSocketMessage(s.pc, frame('pc-1', 'app-1'));
  await barrier;
  if (reconnect === 'expiry') s.auth.advance(3_600_001);
  else {
    assert.equal((await s.hub.fetch(await s.auth.request(reconnect === 'sender' ? 'pc-1' : 'app-1'))).status, 101);
    assert.equal((reconnect === 'sender' ? s.pc : s.app).closed.reason, 'REPLACED');
  }
  release(); await inFlight;
  assert.equal(s.app.sent.filter(text => { try { return JSON.parse(text).protocol === 'nioh-relay/1'; } catch { return false; } }).length, 0);
  if (reconnect !== 'expiry') assert.equal(s.sockets.at(-1).sent.filter(text => { try { return JSON.parse(text).protocol === 'nioh-relay/1'; } catch { return false; } }).length, 0);
});
test('device id account has an independent six-connection limit across reconstruction', async () => {
  const auth = await issuer(), c = await context(auth), hub = new AccountHub(c.ctx, c.env, c.options);
  await auth.register(c.storage,'account');
  for (let i = 0; i < 6; i++) assert.equal((await hub.fetch(await auth.request('account'))).status, 101);
  assert.equal((await new AccountHub(c.ctx, c.env, c.options).fetch(await auth.request('account'))).status, 429);
  assert.equal((await c.storage.get('limits:device:account')).connections, 6);
  assert.equal((await c.storage.get('limits:account')).connections, 6);
});
