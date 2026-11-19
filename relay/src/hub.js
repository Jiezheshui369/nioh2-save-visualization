import { accountKey, requireAllowedAccount, decodeBase64Url, deviceId, errorResponse, fail, productionVerifier } from './auth.js';
import { requireConfigured, requireUpgrade } from './worker.js';
import { EnrollmentRouter } from './enrollment-routes.js';
import {consumeConnection} from './connect-proof.js';

const MINUTE = 60_000, MAX_WIRE = 8 * 1024 * 1024 + 2048;
const MAX_CONNECTIONS = 16, MAX_PENDING = 256;
const attachment = ws => { try { return ws.deserializeAttachment(); } catch { return null; } };
const pendingKey = (app, request) => 'pending:' + JSON.stringify([app, request]);
const sameDevice = (a, b) => a.id === b.id && a.role === b.role && a.version === b.version && a.keyId === b.keyId;

export function parseFrame(message, identity) {
  if (typeof message !== 'string' || message.length > MAX_WIRE || new TextEncoder().encode(message).length > MAX_WIRE) fail('MESSAGE_TOO_LARGE', 413);
  let frame; try { frame = JSON.parse(message); } catch { fail('INVALID_MESSAGE', 400); }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).length !== 5
    || frame.protocol !== 'nioh-relay/1' || !deviceId(frame.requestId) || !deviceId(frame.fromDeviceId) || !deviceId(frame.toDeviceId)
    || frame.fromDeviceId !== identity.device.id || frame.fromDeviceId === frame.toDeviceId) fail('INVALID_MESSAGE', 400);
  const bytes = decodeBase64Url(frame.ciphertext, identity.device.role === 'app' ? 64 * 1024 : 6 * 1024 * 1024);
  // The existing Uint8Array protocol core is represented as canonical base64url on the wire.
  return { frame: { protocol: frame.protocol, requestId: frame.requestId, fromDeviceId: frame.fromDeviceId,
    toDeviceId: frame.toDeviceId, ciphertext: frame.ciphertext }, bytes: bytes.length };
}

/** DO runtime adapter. Storage contains ONLY authorization/session/rate/replay metadata.
 * Enrollment routes use independently verified account JWTs; legacy connect still
 * requires its signed device claim. Missing directory entries fail closed.
 * Tests may supply a real verifier with a local JWKS source; production uses the default.
 */
export class AccountHub {
  constructor(ctx, env, { verifier = productionVerifier, now = () => Date.now(),
    pair = () => Object.values(new WebSocketPair()), upgrade = client => new Response(null, { status: 101, webSocket: client }) } = {}) {
    this.ctx = ctx; this.env = env; this.verifier = verifier; this.now = now; this.pair = pair; this.upgrade = upgrade;
    this.authorizationEpoch=0;
    this.enrollment=new EnrollmentRouter(ctx,env,{verifier,now,invalidate:ids=>{
      this.authorizationEpoch++;
      for(const ws of ctx.getWebSockets())if(ids.includes(attachment(ws)?.device?.id))this.close(ws,1008,'AUTHORIZATION_CHANGED');
    }});
  }
  close(ws, code = 1008, reason = 'UNAUTHORIZED') {
    try { const a = attachment(ws); if (a) ws.serializeAttachment({ ...a, active: false }); ws.close(code, reason); } catch { /* no provider error logging */ }
  }
  assertCurrent(ws, expected) {
    requireConfigured(this.env);
    const current = attachment(ws);
    requireAllowedAccount(current,this.env);
    if (!current || current.active !== true || current.session !== expected.session
      || current.accountKey !== expected.accountKey || current.issuer !== expected.issuer || current.subject !== expected.subject
      || !sameDevice(current.device, expected.device) || current.expiresAt !== expected.expiresAt
      || current.expiresAt <= this.now()) fail('STALE_SESSION', 403);
    // This final gate is synchronous: a reconnect/close during another endpoint's
    // async verification must not release the previously captured generation.
    for (const other of this.ctx.getWebSockets()) {
      const latest = attachment(other);
      if (other !== ws && latest?.active === true && latest.device.id === expected.device.id
        && latest.session >= expected.session) fail('STALE_SESSION', 403);
    }
  }
  async directory(identity, id, expected) {
    const d = await this.ctx.storage.get('device:' + id);
    if (!d || d.state !== 'active' || d.account?.issuer !== identity.issuer || d.account?.subject !== identity.subject
      || d.id !== id || !deviceId(d.keyId) || !Number.isSafeInteger(d.version) || d.version < 1 || !['pc','app'].includes(d.role)
      || expected && !sameDevice(d, expected)) fail('DEVICE_NOT_AUTHORIZED', 403);
    return d;
  }
  async live(ws) {
    requireConfigured(this.env);
    const a = attachment(ws);
    requireAllowedAccount(a,this.env);
    if (!a || a.active !== true || a.issuer !== this.env.AUTH0_ISSUER || !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= this.now()
      || !a.device || a.accountKey !== await accountKey(a)) fail('UNAUTHORIZED');
    const current = await this.ctx.storage.get('session:' + a.device.id);
    if (current !== a.session) fail('STALE_SESSION', 403);
    await this.directory(a, a.device.id, a.device);
    // Identity/expiry are checked again after asynchronous directory access.
    if (attachment(ws)?.active !== true || a.expiresAt <= this.now()) fail('UNAUTHORIZED');
    return a;
  }
  async consume(identity, bytes, connect = false) {
    const now = this.now();
    await this.ctx.storage.transaction(async tx => {
      for (const key of ['limits:account', 'limits:device:' + identity.device.id]) {
        const old = await tx.get(key);
        const rate = old && now >= old.start && now - old.start < MINUTE ? old : { start: now, messages: 0, bytes: 0, connections: 0 };
        const account = key === 'limits:account';
        if (connect) rate.connections++;
        else { rate.messages++; rate.bytes += bytes; }
        if (rate.connections > (account ? 30 : 6) || rate.messages > (account ? 60 : 30)
          || rate.bytes > (account ? 64 : 32) * 1024 * 1024) fail('RATE_LIMITED', 429);
        await tx.put(key, rate);
      }
    });
  }
  async fetch(request) {
    if(new URL(request.url).pathname.startsWith('/v1/enrollment/'))return this.enrollment.fetch(request);
    try {
      requireConfigured(this.env); requireUpgrade(request);
      let identity = await this.verifier.verifyAccount(request, this.env);
      requireAllowedAccount(identity,this.env);
      const key = await accountKey(identity);
      if (this.ctx.id.toString() !== this.env.ACCOUNT_RELAYS.idFromName(key).toString()) fail('UNAUTHORIZED');
      const authorizationEpoch=this.authorizationEpoch;
      identity=await consumeConnection(this.enrollment.store,request,identity,this.env,this.now);
      await this.directory(identity, identity.device.id, identity.device);
      await this.consume(identity, 0, true);
      const sockets = this.ctx.getWebSockets().filter(ws => attachment(ws)?.active === true);
      if (sockets.filter(ws => attachment(ws).device.id !== identity.device.id).length >= MAX_CONNECTIONS) fail('CAPACITY', 429);
      const session = await this.ctx.storage.transaction(async tx => {
        const current = (await tx.get('session:' + identity.device.id)) ?? 0;
        if (!Number.isSafeInteger(current) || current >= Number.MAX_SAFE_INTEGER) fail('CAPACITY', 429);
        await tx.put('session:' + identity.device.id, current + 1); return current + 1;
      });
      requireAllowedAccount(identity,this.env);
      if (identity.expiresAt <= this.now()) fail('UNAUTHORIZED');
      if(authorizationEpoch!==this.authorizationEpoch)fail('STALE_SESSION',403);
      for (const ws of sockets) if (attachment(ws).device.id === identity.device.id) this.close(ws, 4001, 'REPLACED');
      const [client, server] = this.pair();
      server.serializeAttachment({ ...identity, accountKey: key, session, active: true });
      this.ctx.acceptWebSocket(server);
      await this.schedule();
      return this.upgrade(client);
    } catch (e) { return errorResponse(e); }
  }
  async ledger(sender, recipient, requestId) {
    const now = this.now();
    await this.ctx.storage.transaction(async tx => {
      const entries = await tx.list({ prefix: 'pending:' });
      for (const [key, entry] of entries) if (entry.expiresAt <= now) { await tx.delete(key); entries.delete(key); }
      const app = sender.device.role === 'app' ? sender : recipient;
      const pc = sender.device.role === 'pc' ? sender : recipient;
      const key = pendingKey(app.device.id, requestId), old = entries.get(key);
      if (sender.device.role === 'app') {
        if (old) fail('REPLAY', 409);
        if (entries.size >= MAX_PENDING) fail('CAPACITY', 429);
        await tx.put(key, { app: app.device, pc: pc.device, appSession: app.session, pcSession: pc.session,
          expiresAt: now + MINUTE, state: 'pending' });
      } else {
        if (!old || old.state !== 'pending' || !sameDevice(old.app, app.device) || !sameDevice(old.pc, pc.device)
          || old.appSession !== app.session || old.pcSession !== pc.session) fail('UNSOLICITED_RESULT', 403);
        await tx.put(key, { ...old, state: 'completed' });
      }
    });
  }
  async webSocketMessage(ws, message) {
    try {
      const sender = await this.live(ws);
      if (typeof message !== 'string' || message.length > MAX_WIRE) fail('MESSAGE_TOO_LARGE', 413);
      await this.consume(sender, new TextEncoder().encode(message).length);
      if (message === 'ping') { await this.live(ws); this.assertCurrent(ws, sender); ws.send('pong'); return; }
      const { frame } = parseFrame(message, sender);
      const target = await this.directory(sender, frame.toDeviceId);
      if (target.role === sender.device.role) fail('INVALID_ROUTE', 403);
      const candidates = this.ctx.getWebSockets().filter(s => attachment(s)?.active === true
        && attachment(s)?.device.id === target.id);
      let peer, recipient;
      for (const candidate of candidates) {
        try { const current = await this.live(candidate); if (sameDevice(current.device, target)) { peer = candidate; recipient = current; break; } }
        catch { this.close(candidate); }
      }
      if (!peer) fail('PEER_OFFLINE', 409);
      await this.ledger(sender, recipient, frame.requestId);
      // Recheck after all async work; never forward an old connection's in-flight result.
      await this.live(ws); await this.live(peer);
      this.assertCurrent(ws, sender); this.assertCurrent(peer, recipient);
      peer.send(JSON.stringify(frame));
      await this.schedule();
    } catch (e) {
      const code = typeof e?.code === 'string' ? e.code : 'UNAVAILABLE';
      // Fixed error codes only; never include tokens, ciphertext, account names or provider errors.
      try { ws.send(JSON.stringify({ type: 'relay.error', error: code })); } catch { /* disconnected */ }
      if (!['PEER_OFFLINE', 'REPLAY', 'UNSOLICITED_RESULT'].includes(code)) this.close(ws, 1008, code);
    }
  }
  async webSocketClose(ws, code) { this.close(ws, code === 1000 ? 1000 : 1001, 'CLOSED'); await this.schedule(); }
  async webSocketError(ws) { this.close(ws, 1011, 'CONNECTION_ERROR'); await this.schedule(); }
  async schedule() {
    const times = this.ctx.getWebSockets().map(attachment).filter(a => a?.active === true).map(a => a.expiresAt);
    const entries = await this.ctx.storage.list({ prefix: 'pending:' });
    for (const value of entries.values()) times.push(value.expiresAt);
    if (times.length) await this.ctx.storage.setAlarm(Math.max(this.now() + 1, Math.min(this.now() + 30_000, ...times)));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      if (attachment(ws)?.active !== true) continue;
      try { await this.live(ws); } catch { this.close(ws); }
    }
    await this.ctx.storage.transaction(async tx => {
      const entries = await tx.list({ prefix: 'pending:' });
      for (const [key, value] of entries) if (value.expiresAt <= this.now()) await tx.delete(key);
    });
    await this.schedule();
  }
}
