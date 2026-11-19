/** Offline-reviewed core only. No registration, key generation or network calls.
 * The pinned directory signer must be provisioned by a separate trusted native
 * integration. An OIDC login or client-supplied profile is never this authority.
 */
import { isRemoteAccount, RemoteSyncError, sameRemoteAccount } from './remoteSyncProtocol';
import type { RemoteAccount } from './remoteSyncProtocol';
import type { RemoteDevice } from './remoteSnapshotRouter';

export interface PublicDevice extends RemoteDevice { agreementKey: JsonWebKey; signingKey: JsonWebKey }
export interface DirectorySnapshot { schema: 'save-asset-directory/1'; account: RemoteAccount; revision: number; issuedAt: number; expiresAt: number; devices: PublicDevice[] }
const encoder = new TextEncoder();
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
export function publicP256(value: JsonWebKey): JsonWebKey {
  if (!value || Object.keys(value).some(k => !['kty', 'crv', 'x', 'y'].includes(k)) || value.kty !== 'EC' || value.crv !== 'P-256'
    || ![value.x, value.y].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v))) throw new RemoteSyncError('UNAUTHORIZED');
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}
/** Explicit ordered arrays define signed bytes; JSON object insertion order is irrelevant. */
export function directoryBytes(s: DirectorySnapshot): Uint8Array {
  return encoder.encode(JSON.stringify([s.schema, s.account.issuer, s.account.subject, s.revision, s.issuedAt, s.expiresAt,
    s.devices.map(d => [d.id, d.role, d.version, d.keyId, d.state, d.account.issuer, d.account.subject,
      d.agreementKey.kty, d.agreementKey.crv, d.agreementKey.x, d.agreementKey.y,
      d.signingKey.kty, d.signingKey.crv, d.signingKey.x, d.signingKey.y])]));
}
export class RemoteDeviceDirectory {
  private snapshot: DirectorySnapshot | null = null;
  private generation = 0;
  private revision = 0;
  private history = new Map<string, PublicDevice>();
  constructor(private readonly authority?: { account: RemoteAccount; signer: CryptoKey; now(): number }) {}
  async accept(value: DirectorySnapshot, signature: Uint8Array): Promise<void> {
    const a = this.authority;
    if (!a) throw new RemoteSyncError('NOT_CONFIGURED');
    const s = structuredClone(value), epoch = this.generation;
    try {
      if (Object.keys(s).sort().join() !== ['schema','account','revision','issuedAt','expiresAt','devices'].sort().join()
        || s.schema !== 'save-asset-directory/1' || !isRemoteAccount(s.account) || !sameRemoteAccount(s.account, a.account)
        || !Number.isSafeInteger(s.revision) || s.revision <= this.revision
        || !Number.isSafeInteger(s.issuedAt) || s.issuedAt < 0 || s.issuedAt > a.now()
        || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= a.now() || s.expiresAt - s.issuedAt > 300_000
        || !Array.isArray(s.devices) || s.devices.length > 16 || new Set(s.devices.map(d => d.id)).size !== s.devices.length
        || signature.length !== 64) throw new RemoteSyncError('UNAUTHORIZED');
      for (const d of s.devices) {
        if (Object.keys(d).sort().join() !== ['id','account','role','version','keyId','state','agreementKey','signingKey'].sort().join() || !id(d.id) || !id(d.keyId) || !Number.isSafeInteger(d.version) || d.version < 1
          || !['pc','app'].includes(d.role) || !['active','revoked'].includes(d.state) || !isRemoteAccount(d.account)
          || !sameRemoteAccount(d.account, s.account)) throw new RemoteSyncError('UNAUTHORIZED');
        d.agreementKey = publicP256(d.agreementKey); d.signingKey = publicP256(d.signingKey);
        await crypto.subtle.importKey('jwk', d.agreementKey, { name:'ECDH', namedCurve:'P-256' }, false, []);
        await crypto.subtle.importKey('jwk', d.signingKey, { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
        const old = this.history.get(d.id);
        const fingerprint = (v: PublicDevice) => JSON.stringify([v.role,v.keyId,v.agreementKey.x,v.agreementKey.y,v.signingKey.x,v.signingKey.y]);
        if (old && (d.version < old.version || d.version === old.version && (fingerprint(d) !== fingerprint(old)
          || old.state === 'revoked' && d.state !== 'revoked'))) throw new RemoteSyncError('UNAUTHORIZED');
      }
      if (!await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, a.signer, signature as BufferSource, directoryBytes(s) as BufferSource)
        || epoch !== this.generation || s.expiresAt <= a.now()) throw new RemoteSyncError('UNAUTHORIZED');
      this.snapshot = s; this.revision = s.revision;
      for (const d of s.devices) this.history.set(d.id, structuredClone(d));
      this.generation++;
    } catch { throw new RemoteSyncError('UNAUTHORIZED'); }
  }
  get(id: string): PublicDevice | null {
    if (!this.authority || !this.snapshot || this.snapshot.expiresAt <= this.authority.now()) return null;
    const device = this.snapshot.devices.find(d => d.id === id);
    return device ? structuredClone(device) : null;
  }
  get expiresAt(): number { return this.snapshot?.expiresAt ?? 0; }
  invalidate(): void { this.generation++; this.snapshot = null; }
}
