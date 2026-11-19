import { openSnapshotCacheDatabase } from './snapshotCache';
import { isSupportedSnapshot } from './snapshotValidation';
import { REMOTE_PROTOCOL, isRemoteAccount, isRevision, parseRemoteSnapshotRequest, RemoteSyncError, sameRemoteAccount, verifyRemoteSnapshotResult } from './remoteSyncProtocol';
import type { RemoteAccount, RemoteCacheReceipt, RemoteSnapshotRequest, RemoteSnapshotResult } from './remoteSyncProtocol';
import type { RelayCiphertext, RemoteDevice, RemoteSecurityBoundary, VerifiedRemoteSender } from './remoteSnapshotRouter';
import type { SaveSnapshot } from './types';

export interface RemoteCacheScope { account: RemoteAccount; appDeviceId: string; pcDeviceId: string }
export interface RemoteCachedSnapshot { snapshot: SaveSnapshot; receipt: RemoteCacheReceipt }
export interface RemoteCommitResult { status: 'saved' | 'confirmed' | 'duplicate' | 'ignored-stale'; receipt: RemoteCacheReceipt }
interface Guard { check(): void; subscribe(abort: () => void): () => void; deadline: number; now(): number }
interface VerifiedCommit { scope: RemoteCacheScope; request: RemoteSnapshotRequest; result: RemoteSnapshotResult; guard: Guard }
// Private capabilities: callers cannot turn an arbitrary schema-valid object into trusted input.
const verifiedCommits = new WeakMap<object, VerifiedCommit>();
const clone = <T,>(v: T): T => structuredClone(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const deviceId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
function scopeKey(scope: RemoteCacheScope): string {
  if (!isRemoteAccount(scope.account) || !deviceId(scope.appDeviceId) || !deviceId(scope.pcDeviceId)) throw new RemoteSyncError('UNAUTHORIZED');
  return 'remote-source:' + JSON.stringify([scope.account.issuer, scope.account.subject, scope.appDeviceId, scope.pcDeviceId]);
}
function stored(value: unknown, scope: RemoteCacheScope): RemoteCachedSnapshot | null {
  if (value === undefined) return null;
  const v = value as Partial<RemoteCachedSnapshot> | null, r = v?.receipt;
  if (!v || !isSupportedSnapshot(v.snapshot) || !r || r.source !== 'remote-relay' || !isRemoteAccount(r.account)
    || !sameRemoteAccount(r.account, scope.account) || r.pcDeviceId !== scope.pcDeviceId || r.appDeviceId !== scope.appDeviceId
    || r.snapshotId !== v.snapshot.snapshotId || !isRevision(r.revision) || !positive(r.pcDeviceVersion)
    || !positive(r.publicationVersion) || !Number.isSafeInteger(r.lastRequestIssuedAt) || r.lastRequestIssuedAt < 0
    || !Number.isSafeInteger(r.lastSyncedAt) || r.lastSyncedAt < 0 || !deviceId(r.requestId)
    || v.snapshot.privacy?.redactedForSharing !== true || v.snapshot.safety.originalMainSaveSha256 !== '已隐藏') throw new RemoteSyncError('STORAGE');
  return clone(v as RemoteCachedSnapshot);
}

/** Real IndexedDB adapter in the existing cache DB; remote keys never write legacy latest/history/index. */
export class IndexedDbRemoteSnapshotCache {
  async load(scope: RemoteCacheScope): Promise<RemoteCachedSnapshot | null> {
    const key = scopeKey(scope), capturedScope = clone(scope);
    const db = await openSnapshotCacheDatabase().catch(() => { throw new RemoteSyncError('STORAGE'); });
    if (!db) throw new RemoteSyncError('STORAGE');
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly'); let value: unknown;
        const req = tx.objectStore('snapshots').get(key); req.onsuccess = () => { value = req.result; };
        tx.oncomplete = () => { try { resolve(stored(value, capturedScope)); } catch (e) { reject(e); } };
        tx.onabort = tx.onerror = () => reject(new RemoteSyncError('STORAGE'));
      });
    } catch (e) { throw e instanceof RemoteSyncError ? e : new RemoteSyncError('STORAGE'); }
    finally { db.close(); }
  }
  /** Only RemoteSnapshotReceiver can mint a one-use capability after authenticated decryption. */
  async commit(capability: object): Promise<RemoteCommitResult> {
    const trusted = verifiedCommits.get(capability); verifiedCommits.delete(capability);
    if (!trusted) throw new RemoteSyncError('UNAUTHORIZED');
    const { scope, request, result, guard } = trusted, key = scopeKey(scope);
    guard.check();
    const db = await openSnapshotCacheDatabase().catch(() => { throw new RemoteSyncError('STORAGE'); });
    if (!db) throw new RemoteSyncError('STORAGE');
    try {
      guard.check();
      return await new Promise<RemoteCommitResult>((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        let failure: unknown, outcome: RemoteCommitResult | undefined;
        const abort = (reason: unknown) => { failure ??= reason; try { tx.abort(); } catch { /* already finished */ } };
        const unsubscribe = guard.subscribe(() => abort(new RemoteSyncError('UNAUTHORIZED')));
        const deadline = setTimeout(() => abort(new RemoteSyncError('STALE')), Math.max(0, guard.deadline - guard.now()));
        const cleanup = () => { clearTimeout(deadline); unsubscribe(); };
        tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? new RemoteSyncError('STORAGE')); };
        tx.oncomplete = () => { cleanup(); outcome ? resolve(outcome) : reject(new RemoteSyncError('STORAGE')); };
        try {
          guard.check();
          const store = tx.objectStore('snapshots'), current = store.get(key);
          current.onsuccess = () => {
            try {
              guard.check();
              const old = stored(current.result, scope), r = old?.receipt;
              if (r && result.fromDeviceVersion === r.pcDeviceVersion && r.requestId === request.requestId
                && (result.publicationVersion !== r.publicationVersion || result.snapshotId !== r.snapshotId || result.revision !== r.revision)) {
                throw new RemoteSyncError('INVALID_MESSAGE');
              }
              if (r && (result.fromDeviceVersion < r.pcDeviceVersion
                || result.fromDeviceVersion === r.pcDeviceVersion && (result.publicationVersion < r.publicationVersion
                  || request.issuedAt < r.lastRequestIssuedAt || request.issuedAt === r.lastRequestIssuedAt && request.requestId !== r.requestId))) {
                outcome = { status: 'ignored-stale', receipt: r }; return;
              }
              if (r && result.fromDeviceVersion === r.pcDeviceVersion && result.publicationVersion === r.publicationVersion) {
                if (result.snapshotId !== r.snapshotId || result.revision !== r.revision) throw new RemoteSyncError('INVALID_MESSAGE');
                if (r.requestId === request.requestId) { outcome = { status: 'duplicate', receipt: r }; return; }
              }
              if (result.outcome === 'not-modified' && (!old || result.snapshotId !== old.receipt.snapshotId || result.revision !== old.receipt.revision)) {
                throw new RemoteSyncError('UNAVAILABLE');
              }
              const receipt: RemoteCacheReceipt = { source: 'remote-relay', account: clone(scope.account),
                appDeviceId: scope.appDeviceId, pcDeviceId: scope.pcDeviceId, pcDeviceVersion: result.fromDeviceVersion,
                publicationVersion: result.publicationVersion, lastRequestIssuedAt: request.issuedAt,
                requestId: request.requestId, snapshotId: result.snapshotId, revision: result.revision, lastSyncedAt: guard.now() };
              const record: RemoteCachedSnapshot = { snapshot: clone(result.snapshot ?? old!.snapshot), receipt };
              guard.check();
              const write = store.put(record, key); // Snapshot+receipt are one atomic record.
              write.onsuccess = () => { try { guard.check(); } catch (e) { abort(e); } };
              outcome = { status: result.outcome === 'not-modified' ? 'confirmed' : 'saved', receipt: clone(receipt) };
            } catch (e) { abort(e); }
          };
        } catch (e) { abort(e); }
      });
    } catch (e) { throw e instanceof RemoteSyncError ? e : new RemoteSyncError('STORAGE'); }
    finally { db.close(); }
  }
}

export interface RemoteReceiverOptions {
  enabled: boolean;
  issuer: string;
  account: RemoteAccount; // Validated local login identity, never unverified profile/email data.
  appDeviceId: string;
  directory: { get(deviceId: string): RemoteDevice | null };
  security: Pick<RemoteSecurityBoundary, 'openAuthenticated'>;
  sha256(bytes: Uint8Array): Promise<string>;
  now(): number;
  cache?: IndexedDbRemoteSnapshotCache;
}
interface Pending { request: RemoteSnapshotRequest; epoch: number; pcKeyId: string; appKeyId: string }
/** No provider/client/network implementation: default constructor cannot receive or commit. */
export class RemoteSnapshotReceiver {
  private nativeAuthorization?: () => void;
  private readonly options: RemoteReceiverOptions | null;
  private readonly cache: IndexedDbRemoteSnapshotCache;
  private online = false;
  private epoch = 0;
  private scope: RemoteCacheScope | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly invalidations = new Set<() => void>();
  constructor(options?: RemoteReceiverOptions) {
    const ready = options?.enabled === true && isRemoteAccount(options.account) && options.account.issuer === options.issuer
      && deviceId(options.appDeviceId) && typeof options.directory?.get === 'function'
      && typeof options.security?.openAuthenticated === 'function' && typeof options.sha256 === 'function' && typeof options.now === 'function';
    this.options = ready ? { ...options!, account: clone(options!.account) } : null;
    this.cache = options?.cache ?? new IndexedDbRemoteSnapshotCache();
  }
  private configured(): RemoteReceiverOptions { if (!this.options) throw new RemoteSyncError('NOT_CONFIGURED'); return this.options; }
  /** The transaction guard rechecks native authorization before writes succeed. */
  bindNativeAuthorizationGuard(check: () => void): void {
    if (this.nativeAuthorization) throw new RemoteSyncError('UNAUTHORIZED');
    this.nativeAuthorization = check;
  }
  /** Local transport/auth lifecycle events; none opens a connection or deletes cached data. */
  invalidate(): void { this.epoch++; this.pending.clear(); for (const cancel of [...this.invalidations]) cancel(); }
  setOnline(online: boolean): void { this.configured(); if (!online) this.invalidate(); this.online = online; }
  deactivate(): void { this.invalidate(); this.online = false; this.scope = null; }
  private device(id: string, role: RemoteDevice['role'], version?: number, keyId?: string): RemoteDevice {
    const o = this.configured(), d = o.directory.get(id);
    if (!d || d.state !== 'active') throw new RemoteSyncError('REVOKED');
    if (d.id !== id || d.role !== role || !positive(d.version) || !d.keyId || !isRemoteAccount(d.account)
      || !sameRemoteAccount(d.account, o.account) || version !== undefined && d.version !== version || keyId !== undefined && d.keyId !== keyId)
      throw new RemoteSyncError('UNAUTHORIZED');
    return clone(d);
  }
  selectPc(pcDeviceId: string): void {
    const o = this.configured(); this.device(pcDeviceId, 'pc'); this.device(o.appDeviceId, 'app');
    this.invalidate(); this.scope = { account: clone(o.account), appDeviceId: o.appDeviceId, pcDeviceId };
  }
  async loadOffline(): Promise<RemoteCachedSnapshot | null> {
    this.configured(); if (!this.scope) return null;
    const scope = clone(this.scope), epoch = this.epoch, result = await this.cache.load(scope);
    if (this.epoch !== epoch || !this.scope || scopeKey(this.scope) !== scopeKey(scope)) throw new RemoteSyncError('UNAUTHORIZED');
    return result;
  }
  beginRequest(value: unknown): void {
    const o = this.configured(); if (!this.online || !this.scope) throw new RemoteSyncError('OFFLINE');
    const request = parseRemoteSnapshotRequest(value, o.now());
    if (!sameRemoteAccount(request.account, o.account) || request.fromDeviceId !== o.appDeviceId || request.toDeviceId !== this.scope.pcDeviceId) throw new RemoteSyncError('UNAUTHORIZED');
    const pc = this.device(request.toDeviceId, 'pc', request.toDeviceVersion), app = this.device(request.fromDeviceId, 'app', request.fromDeviceVersion);
    for (const [id, p] of this.pending) if (p.request.expiresAt < o.now()) this.pending.delete(id);
    if (this.pending.has(request.requestId)) throw new RemoteSyncError('REPLAY');
    if (this.pending.size >= 256) throw new RemoteSyncError('CAPACITY');
    if ([...this.pending.values()].some(p => p.request.issuedAt >= request.issuedAt)) throw new RemoteSyncError('STALE');
    this.pending.set(request.requestId, { request, epoch: this.epoch, pcKeyId: pc.keyId, appKeyId: app.keyId });
  }
  async receive(frame: RelayCiphertext): Promise<RemoteCommitResult> {
    const o = this.configured(), p = this.pending.get(frame.requestId);
    if (!p || !this.scope) throw new RemoteSyncError('UNAUTHORIZED');
    const scope = clone(this.scope);
    let sender: VerifiedRemoteSender | undefined;
    const check = () => {
      this.nativeAuthorization?.();
      if (!this.online) throw new RemoteSyncError('OFFLINE');
      if (p.epoch !== this.epoch || !this.scope || scopeKey(scope) !== scopeKey(this.scope)) throw new RemoteSyncError('UNAUTHORIZED');
      this.device(p.request.fromDeviceId, 'app', p.request.fromDeviceVersion, p.appKeyId);
      this.device(p.request.toDeviceId, 'pc', p.request.toDeviceVersion, p.pcKeyId);
      if (p.request.expiresAt <= o.now() || sender && sender.authorizationExpiresAt <= o.now()) throw new RemoteSyncError('STALE');
    };
    check();
    if (frame.protocol !== REMOTE_PROTOCOL || !(frame.ciphertext instanceof Uint8Array) || !frame.ciphertext.length || frame.ciphertext.length > 6 * 1024 * 1024
      || frame.fromDeviceId !== p.request.toDeviceId || frame.toDeviceId !== p.request.fromDeviceId) throw new RemoteSyncError('UNAUTHORIZED');
    let opened: Awaited<ReturnType<RemoteReceiverOptions['security']['openAuthenticated']>>;
    try { opened = await o.security.openAuthenticated({ ...frame, ciphertext: frame.ciphertext.slice() }); }
    catch { throw new RemoteSyncError('UNAUTHORIZED'); }
    sender = clone(opened.sender);
    if (!isRemoteAccount(sender.account) || !sameRemoteAccount(sender.account, o.account) || sender.deviceId !== p.request.toDeviceId
      || sender.deviceVersion !== p.request.toDeviceVersion || sender.keyId !== p.pcKeyId || !Number.isSafeInteger(sender.authorizationExpiresAt)) throw new RemoteSyncError('UNAUTHORIZED');
    check();
    const result = await verifyRemoteSnapshotResult(opened.message, p.request, o.now, o.sha256);
    check();
    const guard: Guard = { check, now: o.now, deadline: Math.min(p.request.expiresAt, sender.authorizationExpiresAt),
      subscribe: abort => { this.invalidations.add(abort); return () => this.invalidations.delete(abort); } };
    const capability = {};
    verifiedCommits.set(capability, { scope, request: clone(p.request), result, guard });
    return this.cache.commit(capability);
  }
}
