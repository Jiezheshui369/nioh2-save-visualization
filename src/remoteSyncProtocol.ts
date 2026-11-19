import { record } from './dataValidation';
import { isSupportedSnapshot } from './snapshotValidation';
import type { SaveSnapshot } from './types';
import { publicationBytes } from './publicationEncoding';

export const REMOTE_PROTOCOL = 'nioh-relay/1' as const;
export const MAX_REQUEST_LIFETIME_MS = 60_000;
export const CLOCK_SKEW_MS = 5_000;
export interface RemoteAccount { issuer: string; subject: string }
export interface RemoteBinding {
  protocol: typeof REMOTE_PROTOCOL;
  account: RemoteAccount;
  requestId: string;
  fromDeviceId: string;
  toDeviceId: string;
  fromDeviceVersion: number;
  toDeviceVersion: number;
  issuedAt: number;
  expiresAt: number;
}
export interface RemoteSnapshotRequest extends RemoteBinding {
  type: 'snapshot.read';
  gameId: 'nioh2';
  knownSnapshotId: string | null;
  knownRevision: string | null;
}
export interface RemoteSnapshotResult extends RemoteBinding {
  type: 'snapshot.result';
  gameId: 'nioh2';
  snapshotId: string;
  revision: string;
  publicationVersion: number;
  outcome: 'snapshot' | 'not-modified';
  snapshot: SaveSnapshot | null;
}
/** Cache this receipt WITH a successful snapshot commit, never on network read alone. */
export interface RemoteCacheReceipt {
  source: 'remote-relay';
  account: RemoteAccount;
  pcDeviceId: string;
  appDeviceId: string;
  pcDeviceVersion: number;
  publicationVersion: number;
  lastRequestIssuedAt: number;
  requestId: string;
  snapshotId: string;
  revision: string;
  lastSyncedAt: number;
}
export type RemoteErrorCode = 'NOT_CONFIGURED' | 'OFFLINE' | 'INVALID_MESSAGE' | 'STALE'
  | 'UNAUTHORIZED' | 'REVOKED' | 'REPLAY' | 'CAPACITY' | 'UNAVAILABLE' | 'STORAGE';
export class RemoteSyncError extends Error {
  constructor(readonly code: RemoteErrorCode) { super(code); this.name = 'RemoteSyncError'; }
}
export const sameRemoteAccount = (a: RemoteAccount, b: RemoteAccount): boolean =>
  a.issuer === b.issuer && a.subject === b.subject; // Never match by email/display name.
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const isRevision = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Stable shared JS wire encoding; key order from a native bridge is not identity. */
export function remoteSnapshotBytes(snapshot: SaveSnapshot): Uint8Array {
  return publicationBytes(snapshot);
}
export function isRemoteAccount(v: unknown): v is RemoteAccount {
  if (!record(v) || Object.keys(v).length !== 2 || typeof v.issuer !== 'string' || typeof v.subject !== 'string'
    || v.issuer.length > 2048 || !v.subject.trim() || v.subject.length > 255) return false;
  try { const u = new URL(v.issuer); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}
const bindingKeys = ['protocol', 'account', 'requestId', 'fromDeviceId', 'toDeviceId', 'fromDeviceVersion', 'toDeviceVersion', 'issuedAt', 'expiresAt'];
function binding(v: Record<string, unknown>, now: number, keys: string[]): void {
  if (Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))
    || v.protocol !== REMOTE_PROTOCOL || !isRemoteAccount(v.account) || !id(v.requestId)
    || !id(v.fromDeviceId) || !id(v.toDeviceId) || v.fromDeviceId === v.toDeviceId
    || !integer(v.fromDeviceVersion) || v.fromDeviceVersion < 1 || !integer(v.toDeviceVersion) || v.toDeviceVersion < 1
    || !integer(v.issuedAt) || !integer(v.expiresAt) || !integer(now)
    || v.expiresAt <= v.issuedAt || v.expiresAt - v.issuedAt > MAX_REQUEST_LIFETIME_MS) throw new RemoteSyncError('INVALID_MESSAGE');
  if (v.issuedAt > now + CLOCK_SKEW_MS || v.expiresAt <= now) throw new RemoteSyncError('STALE');
}
export function parseRemoteSnapshotRequest(v: unknown, now: number): RemoteSnapshotRequest {
  if (!record(v)) throw new RemoteSyncError('INVALID_MESSAGE');
  binding(v, now, [...bindingKeys, 'type', 'gameId', 'knownSnapshotId', 'knownRevision']);
  if (v.type !== 'snapshot.read' || v.gameId !== 'nioh2'
    || !(v.knownSnapshotId === null || id(v.knownSnapshotId)) || !(v.knownRevision === null || isRevision(v.knownRevision))
    || (v.knownSnapshotId === null) !== (v.knownRevision === null)) throw new RemoteSyncError('INVALID_MESSAGE');
  // Independent capture before any async adapter can mutate its input.
  return JSON.parse(JSON.stringify(v)) as RemoteSnapshotRequest;
}
/** Validate a decrypted response against the exact pending request; no cache write. */
export function parseRemoteSnapshotResult(v: unknown, request: RemoteSnapshotRequest, now: number): RemoteSnapshotResult {
  if (!record(v)) throw new RemoteSyncError('INVALID_MESSAGE');
  binding(v, now, [...bindingKeys, 'type', 'gameId', 'snapshotId', 'revision', 'publicationVersion', 'outcome', 'snapshot']);
  if (v.type !== 'snapshot.result' || v.gameId !== request.gameId || !id(v.snapshotId) || !isRevision(v.revision)
    || !integer(v.publicationVersion) || v.publicationVersion < 1
    || !sameRemoteAccount(v.account as RemoteAccount, request.account) || v.requestId !== request.requestId
    || v.fromDeviceId !== request.toDeviceId || v.toDeviceId !== request.fromDeviceId
    || v.fromDeviceVersion !== request.toDeviceVersion || v.toDeviceVersion !== request.fromDeviceVersion
    || (v.issuedAt as number) < request.issuedAt - CLOCK_SKEW_MS || (v.expiresAt as number) > request.expiresAt || request.expiresAt <= now)
    throw new RemoteSyncError('UNAUTHORIZED');
  if (v.outcome === 'snapshot') {
    if (!isSupportedSnapshot(v.snapshot) || v.snapshot.snapshotId !== v.snapshotId
      || v.snapshot.privacy?.redactedForSharing !== true || v.snapshot.safety.originalMainSaveSha256 !== '已隐藏')
      throw new RemoteSyncError('INVALID_MESSAGE');
  } else if (v.outcome !== 'not-modified' || v.snapshot !== null || request.knownSnapshotId !== v.snapshotId || request.knownRevision !== v.revision) {
    throw new RemoteSyncError('INVALID_MESSAGE');
  }
  return JSON.parse(JSON.stringify(v)) as RemoteSnapshotResult;
}

/** Call after authenticated decryption, before an atomic cache commit. No crypto fallback. */
export async function verifyRemoteSnapshotResult(v: unknown, request: RemoteSnapshotRequest, now: () => number,
  sha256?: (bytes: Uint8Array) => Promise<string>): Promise<RemoteSnapshotResult> {
  if (!sha256) throw new RemoteSyncError('NOT_CONFIGURED');
  const result = parseRemoteSnapshotResult(v, request, now());
  if (result.snapshot) {
    const bytes = remoteSnapshotBytes(result.snapshot);
    if (bytes.length > 5 * 1024 * 1024) throw new RemoteSyncError('INVALID_MESSAGE');
    let digest: string;
    try { digest = await sha256(bytes); } catch { throw new RemoteSyncError('UNAVAILABLE'); }
    if (digest !== result.revision) throw new RemoteSyncError('INVALID_MESSAGE');
  }
  return parseRemoteSnapshotResult(result, request, now());
}
