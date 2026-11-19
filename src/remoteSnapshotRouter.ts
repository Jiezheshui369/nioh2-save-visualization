import type { SaveSnapshot } from './types';
import { createShareSnapshot } from './privacy';
import { CLOCK_SKEW_MS, REMOTE_PROTOCOL, RemoteSyncError, isRemoteAccount, parseRemoteSnapshotRequest, remoteSnapshotBytes, sameRemoteAccount } from './remoteSyncProtocol';
import type { RemoteAccount, RemoteSnapshotRequest, RemoteSnapshotResult } from './remoteSyncProtocol';

export interface RemoteDevice {
  id: string;
  account: RemoteAccount;
  role: 'pc' | 'app';
  version: number;
  keyId: string;
  state: 'active' | 'revoked';
}
export interface RelayCiphertext {
  protocol: typeof REMOTE_PROTOCOL;
  requestId: string;
  fromDeviceId: string;
  toDeviceId: string;
  ciphertext: Uint8Array;
}
export interface VerifiedRemoteSender {
  account: RemoteAccount;
  deviceId: string;
  deviceVersion: number;
  keyId: string;
  authorizationExpiresAt: number;
}
/** Production implementation MUST verify OIDC issuer/audience/subject/expiry,
 * authenticated device-directory membership AND encrypted header/body integrity.
 * No implementation, plaintext fallback or mock is supplied by this module. */
export interface RemoteSecurityBoundary {
  openAuthenticated(frame: RelayCiphertext): Promise<{ sender: VerifiedRemoteSender; message: unknown }>;
  sealAuthenticated(message: RemoteSnapshotResult, recipient: RemoteDevice): Promise<RelayCiphertext>;
}
export interface RemoteRouterOptions {
  enabled: boolean;
  issuer: string;
  pcDeviceId: string;
  directory: { get(deviceId: string): RemoteDevice | null }; // Authenticated directory mirror, not discovery metadata.
  security: RemoteSecurityBoundary;
  readLatestSnapshot(): Promise<RemotePublication | null>; // Atomic snapshot+PC-local monotonic publication version.
  sha256(bytes: Uint8Array): Promise<string>; // Mature crypto implementation supplied separately.
  now(): number;
}
export interface RemotePublication { snapshot: SaveSnapshot; publicationVersion: number }
export type RemoteConnectionState = 'unconfigured' | 'offline' | 'connecting' | 'online' | 'revoked';
export type RemoteRequestState = 'reading' | 'sealing' | 'completed' | 'failed';

/** Isolated protocol core: no socket, fetch, credentials, storage or product integration. */
export class RemoteSnapshotRouter {
  private nativeAuthorization?: () => void;
  private connection: RemoteConnectionState = 'unconfigured';
  private epoch = 0;
  private readonly requests = new Map<string, { state: RemoteRequestState; expiresAt: number }>();
  private readonly options: RemoteRouterOptions | null;
  constructor(options?: RemoteRouterOptions) {
    const valid = options?.enabled === true && isRemoteAccount({ issuer: options.issuer, subject: 'configuration-check' })
      && typeof options.security?.openAuthenticated === 'function' && typeof options.security?.sealAuthenticated === 'function'
      && typeof options.directory?.get === 'function' && typeof options.readLatestSnapshot === 'function'
      && typeof options.sha256 === 'function' && typeof options.now === 'function';
    this.options = valid ? { ...options! } : null;
    if (this.options) this.connection = 'offline';
  }
  get state(): RemoteConnectionState { return this.connection; }
  /** Installed only by a native connector; cannot be replaced or silently removed. */
  bindNativeAuthorizationGuard(check: () => void): void {
    if (this.nativeAuthorization) throw new RemoteSyncError('UNAUTHORIZED');
    this.nativeAuthorization = check;
  }
  /** Events from a future authenticated transport. These methods open no connections. */
  beginConnect(): void {
    if (this.connection !== 'offline') throw new RemoteSyncError(this.connection === 'unconfigured' ? 'NOT_CONFIGURED' : 'OFFLINE');
    this.connection = 'connecting';
  }
  connected(): void {
    if (this.connection !== 'connecting') throw new RemoteSyncError('OFFLINE');
    this.connection = 'online';
  }
  disconnected(): void {
    if (this.connection === 'unconfigured' || this.connection === 'revoked') return;
    this.epoch++; this.connection = 'offline';
  }
  revoke(): void { this.epoch++; this.connection = 'revoked'; }
  requestState(senderDeviceId: string, requestId: string): RemoteRequestState | null {
    return this.requests.get(JSON.stringify([senderDeviceId, requestId]))?.state ?? null;
  }
  private live(epoch: number): RemoteRouterOptions {
    if (!this.options) throw new RemoteSyncError('NOT_CONFIGURED');
    this.nativeAuthorization?.();
    if (this.connection === 'revoked') throw new RemoteSyncError('REVOKED');
    if (this.connection !== 'online' || this.epoch !== epoch) throw new RemoteSyncError('OFFLINE');
    return this.options;
  }
  private device(id: string, role: RemoteDevice['role'], version: number, account: RemoteAccount, keyId?: string): RemoteDevice {
    const options = this.options!;
    const d = options.directory.get(id);
    if (!d || d.state !== 'active') throw new RemoteSyncError('REVOKED');
    if (d.id !== id || d.role !== role || d.version !== version || !d.keyId
      || !isRemoteAccount(d.account) || d.account.issuer !== options.issuer || !sameRemoteAccount(d.account, account)
      || keyId !== undefined && d.keyId !== keyId) throw new RemoteSyncError('UNAUTHORIZED');
    return { ...d, account: { ...d.account } };
  }
  async handle(frame: RelayCiphertext): Promise<RelayCiphertext> {
    const epoch = this.epoch, options = this.live(epoch);
    let key: string | undefined;
    let ownsRequest = false;
    try {
      if (frame.protocol !== REMOTE_PROTOCOL || !(frame.ciphertext instanceof Uint8Array)
        || frame.ciphertext.length < 1 || frame.ciphertext.length > 64 * 1024) throw new RemoteSyncError('INVALID_MESSAGE');
      const captured = { ...frame, ciphertext: frame.ciphertext.slice() };
      const opened = await options.security.openAuthenticated(captured);
      this.live(epoch);
      const sender: VerifiedRemoteSender = { ...opened.sender, account: { ...opened.sender.account } };
      const request: RemoteSnapshotRequest = parseRemoteSnapshotRequest(opened.message, options.now());
      if (!isRemoteAccount(sender.account) || sender.account.issuer !== options.issuer
        || !sameRemoteAccount(sender.account, request.account) || sender.deviceId !== request.fromDeviceId
        || sender.deviceVersion !== request.fromDeviceVersion || request.toDeviceId !== options.pcDeviceId
        || captured.fromDeviceId !== request.fromDeviceId || captured.toDeviceId !== request.toDeviceId
        || captured.requestId !== request.requestId) throw new RemoteSyncError('UNAUTHORIZED');
      let pcKeyId: string | undefined;
      const authorize = () => {
        this.live(epoch);
        if (!Number.isSafeInteger(sender.authorizationExpiresAt) || sender.authorizationExpiresAt <= options.now()
          || request.expiresAt <= options.now()) throw new RemoteSyncError('STALE');
        const pc = this.device(request.toDeviceId, 'pc', request.toDeviceVersion, sender.account, pcKeyId);
        pcKeyId ??= pc.keyId;
        return this.device(request.fromDeviceId, 'app', request.fromDeviceVersion, sender.account, sender.keyId);
      };
      authorize();
      const now = options.now();
      for (const [id, v] of this.requests) if (v.expiresAt + CLOCK_SKEW_MS < now) this.requests.delete(id);
      key = JSON.stringify([request.fromDeviceId, request.requestId]);
      if (this.requests.has(key)) throw new RemoteSyncError('REPLAY');
      if (this.requests.size >= 1000) throw new RemoteSyncError('CAPACITY');
      this.requests.set(key, { state: 'reading', expiresAt: request.expiresAt });
      ownsRequest = true;
      const latest = await options.readLatestSnapshot();
      authorize();
      if (!latest || !Number.isSafeInteger(latest.publicationVersion) || latest.publicationVersion < 1) throw new RemoteSyncError('UNAVAILABLE');
      // Snapshot/projection and bytes are detached before asynchronous hashing/sealing.
      const publicationVersion = latest.publicationVersion;
      const snapshot = JSON.parse(JSON.stringify(createShareSnapshot(latest.snapshot))) as SaveSnapshot;
      const bytes = remoteSnapshotBytes(snapshot);
      if (bytes.length > 5 * 1024 * 1024) throw new RemoteSyncError('UNAVAILABLE');
      const revision = await options.sha256(bytes.slice());
      const recipient = authorize();
      if (!/^[a-f0-9]{64}$/.test(revision)) throw new RemoteSyncError('UNAVAILABLE');
      const unchanged = request.knownSnapshotId === snapshot.snapshotId && request.knownRevision === revision;
      const message: RemoteSnapshotResult = {
        protocol: REMOTE_PROTOCOL, account: { ...sender.account }, type: 'snapshot.result', gameId: 'nioh2',
        requestId: request.requestId, fromDeviceId: request.toDeviceId, toDeviceId: request.fromDeviceId,
        fromDeviceVersion: request.toDeviceVersion, toDeviceVersion: request.fromDeviceVersion,
        issuedAt: options.now(), expiresAt: request.expiresAt, snapshotId: snapshot.snapshotId, revision, publicationVersion,
        outcome: unchanged ? 'not-modified' : 'snapshot', snapshot: unchanged ? null : snapshot,
      };
      this.requests.get(key)!.state = 'sealing';
      const sealed = await options.security.sealAuthenticated(message, recipient);
      authorize();
      if (sealed.protocol !== REMOTE_PROTOCOL || sealed.requestId !== request.requestId
        || sealed.fromDeviceId !== request.toDeviceId || sealed.toDeviceId !== request.fromDeviceId
        || !(sealed.ciphertext instanceof Uint8Array) || !sealed.ciphertext.length
        || sealed.ciphertext.length > 6 * 1024 * 1024) throw new RemoteSyncError('UNAVAILABLE');
      this.requests.get(key)!.state = 'completed';
      return { ...sealed, ciphertext: sealed.ciphertext.slice() };
    } catch (error) {
      if (ownsRequest && key && this.requests.has(key) && this.requests.get(key)!.state !== 'completed') this.requests.get(key)!.state = 'failed';
      // Never leak provider errors, tokens, paths or snapshot contents to future transport.
      throw error instanceof RemoteSyncError ? error : new RemoteSyncError('UNAVAILABLE');
    }
  }
}
