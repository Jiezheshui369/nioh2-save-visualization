/** Real RS256 verification through WebCrypto. No token/profile decoding fallback. */
export class RelayError extends Error {
  constructor(code, status = 401) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new RelayError(code, status); };
export const FRESH_AUTH_CLAIM = 'https://review-relay.invalid/claims/authenticated_at';
// Single-account pilot. This is an exact issuer/sub restriction, not a client or email allowlist.
export function requireAccountPolicy(env) {
  if (typeof env.AUTH0_ALLOWED_SUBJECT !== 'string' || !/^[^\s]{1,255}$/.test(env.AUTH0_ALLOWED_SUBJECT)) fail('NOT_CONFIGURED', 503);
}
export function requireAllowedAccount(identity, env) {
  requireAccountPolicy(env);
  if (!identity || identity.issuer !== env.AUTH0_ISSUER || identity.subject !== env.AUTH0_ALLOWED_SUBJECT) fail('UNAUTHORIZED');
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const deviceId = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
export function authConfig(env, requireDevice = true) {
  requireAccountPolicy(env);
  let url;
  try { url = new URL(env.AUTH0_ISSUER); } catch { fail('NOT_CONFIGURED', 503); }
  const clients = typeof env.AUTH0_CLIENT_IDS === 'string' ? env.AUTH0_CLIENT_IDS.split(',').map(v => v.trim()).filter(Boolean) : [];
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || env.AUTH0_ISSUER !== url.href || !env.AUTH0_AUDIENCE || !clients.length || clients.length > 16
    || requireDevice && (typeof env.AUTH0_DEVICE_CLAIM !== 'string' || !env.AUTH0_DEVICE_CLAIM.startsWith('https://'))) fail('NOT_CONFIGURED', 503);
  return { issuer: url.href, audience: env.AUTH0_AUDIENCE, clients, claim: env.AUTH0_DEVICE_CLAIM,
    jwks: new URL('.well-known/jwks.json', url).href };
}
export function decodeBase64Url(value, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail('INVALID_MESSAGE', 400);
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  if (raw.length > maximum || btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') !== value) fail('INVALID_MESSAGE', 400);
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}
async function limitedJson(response, maximum) {
  if (!response.ok || !response.body) fail('AUTH_UNAVAILABLE', 503);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) fail('AUTH_UNAVAILABLE', 503); chunks.push(value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const v of chunks) { bytes.set(v, offset); offset += v.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export class JwtVerifier {
  constructor(fetcher = (...args) => globalThis.fetch(...args), now = () => Date.now()) { this.fetcher = fetcher; this.now = now; this.cache = new Map(); }
  async keys(config, kid) {
    let entry = this.cache.get(config.issuer); const now = this.now();
    if (entry?.expires > now && entry.keys.some(k => k.kid === kid)) return entry.keys;
    // Unknown kids cannot trigger an unbounded stream of upstream requests.
    if (entry?.pending) return entry.pending;
    if (entry && now - entry.attempt < 5_000) fail('UNAUTHORIZED');
    entry = { ...entry, attempt: now }; this.cache.set(config.issuer, entry);
    entry.pending = (async () => {
      try {
        // workerd supports manual/follow, not redirect:error. limitedJson rejects
        // non-2xx responses, so manual preserves the no-redirect trust boundary.
        const response = await this.fetcher(config.jwks, { redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
        const jwks = await limitedJson(response, 64 * 1024);
        if (!object(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length > 32) fail('AUTH_UNAVAILABLE', 503);
        const keys = jwks.keys.filter(k => object(k) && k.kty === 'RSA' && typeof k.kid === 'string'
          && typeof k.n === 'string' && typeof k.e === 'string' && !k.d
          && (k.alg === undefined || k.alg === 'RS256') && (k.use === undefined || k.use === 'sig')
          && (k.key_ops === undefined || Array.isArray(k.key_ops) && k.key_ops.includes('verify')));
        entry.keys = keys; entry.expires = this.now() + 300_000; return keys;
      } catch { fail('AUTH_UNAVAILABLE', 503); }
      finally { entry.pending = undefined; }
    })();
    return entry.pending;
  }
  async verifyAccount(request, env) { return this.verify(request, env, { requireDevice:false }); }
  async verify(request, env, { requireDevice = true } = {}) {
    const config = authConfig(env, requireDevice), authorization = request.headers.get('Authorization');
    if (!authorization || authorization.length > 16_384 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) fail('UNAUTHORIZED');
    const token = authorization.slice(7), parts = token.split('.');
    if (parts.length !== 3) fail('UNAUTHORIZED');
    let header, claims, signature;
    try {
      const decode = text => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(text, 12_288)));
      header = decode(parts[0]); claims = decode(parts[1]); signature = decodeBase64Url(parts[2], 512);
    } catch { fail('UNAUTHORIZED'); }
    if (!object(header) || header.alg !== 'RS256' || !deviceId(header.kid)
      || header.typ !== undefined && !['JWT','at+jwt'].includes(header.typ) || Object.keys(header).some(k => !['alg','kid','typ'].includes(k)) || !object(claims)) fail('UNAUTHORIZED');
    const keys = (await this.keys(config, header.kid)).filter(k => k.kid === header.kid);
    if (keys.length !== 1) fail('UNAUTHORIZED');
    try {
      const key = await crypto.subtle.importKey('jwk', keys[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (key.algorithm.modulusLength < 2048 || !await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature,
        new TextEncoder().encode(parts[0] + '.' + parts[1]))) fail('UNAUTHORIZED');
    } catch { fail('UNAUTHORIZED'); }
    const now = Math.floor(this.now() / 1000);
    const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    const client = claims.azp ?? claims.client_id; // Auth0 legacy and RFC9068 access-token profiles.
    if (claims.iss !== config.issuer || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 255
      || !Array.isArray(audience) || !audience.every(v => typeof v === 'string') || !audience.includes(config.audience)
      || !Number.isSafeInteger(claims.exp) || claims.exp <= now || !Number.isSafeInteger(claims.exp * 1000)
      || claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 5)
      || claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 5)
      || claims.azp !== undefined && claims.client_id !== undefined && claims.azp !== claims.client_id
      || !config.clients.includes(client)
      || typeof claims.scope !== 'string' || !claims.scope.split(' ').includes('relay:connect')) fail('UNAUTHORIZED');
    requireAllowedAccount({issuer:claims.iss,subject:claims.sub},env);
    if (!requireDevice) return { issuer:claims.iss, subject:claims.sub, clientId:client, expiresAt:claims.exp*1000,
      // iat is token issuance, not evidence of recent human authentication.
      authenticatedAt: (() => {
        // Issuer-signed configured evidence only; never infer human authentication
        // from iat, an ID token or client-controlled request values.
        const value=claims[env.AUTH0_FRESH_AUTH_CLAIM || FRESH_AUTH_CLAIM];
        return Number.isSafeInteger(value) && Number.isSafeInteger(value*1000)
          && value>=0 && value<=now ? value*1000 : null;
      })() };
    const device = claims[config.claim];
    if (!object(device) || Object.keys(device).length !== 4 || !deviceId(device.id) || !deviceId(device.keyId)
      || !Number.isSafeInteger(device.version) || device.version < 1 || !['pc','app'].includes(device.role)) fail('DEVICE_NOT_AUTHORIZED', 403);
    return { issuer: claims.iss, subject: claims.sub, expiresAt: claims.exp * 1000,
      device: { id: device.id, keyId: device.keyId, version: device.version, role: device.role } };
  }
}
export const productionVerifier = new JwtVerifier();
export async function accountKey(identity) {
  const bytes = new TextEncoder().encode(JSON.stringify([identity.issuer, identity.subject]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function errorResponse(error) {
  const e = error instanceof RelayError ? error : new RelayError('UNAVAILABLE', 503);
  return Response.json({ error: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
