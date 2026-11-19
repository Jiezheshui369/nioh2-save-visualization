import { Capacitor, registerPlugin } from '@capacitor/core';
import { isSupportedSnapshot } from './snapshotValidation';
import type { SaveSnapshot } from './types';
import type { AccountPlatform } from './nativeAccount';

export type RemoteAction = 'status' | 'initialize' | 'pending' | 'approve' | 'reject' | 'requestJoin' | 'refresh' | 'readCache';
export type RemoteState = 'unconfigured' | 'signed-out' | 'unregistered' | 'awaiting-approval' | 'ready' | 'refreshing' | 'error';
export interface PendingPhone { requestId: string; phrase: string; expiresAt: number }
export interface RemoteMvpStatus { state: RemoteState; enabled: boolean; hasCache: boolean; connected?: boolean; pending: PendingPhone[]; phrase?: string; updatedAt?: number }
const states: RemoteState[] = ['unconfigured', 'signed-out', 'unregistered', 'awaiting-approval', 'ready', 'refreshing', 'error'];
const native = registerPlugin<Record<RemoteAction, (options?: object) => Promise<unknown>>>('SaveAssetRemote');
const phrase = (v: unknown): v is string => typeof v === 'string' && /^[A-F0-9]{4}(?: [A-F0-9]{4}){5}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,160}$/.test(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function remoteStatus(value: unknown): RemoteMvpStatus {
  if (!value || typeof value !== 'object') throw new Error('REMOTE_STATUS_INVALID');
  const row = value as Record<string, unknown>;
  if (!states.includes(row.state as RemoteState)) throw new Error('REMOTE_STATUS_INVALID');
  const enabled = row.state !== 'unconfigured' && (row.enabled === true || row.configured === true);
  const pending = Array.isArray(row.pending) ? row.pending.slice(0, 1).map((p: unknown) => {
    const r = p as Record<string, unknown>;
    if (!r || !id(r.requestId) || !phrase(r.phrase) || !time(r.expiresAt)) throw new Error('REMOTE_STATUS_INVALID');
    return { requestId: r.requestId, phrase: r.phrase, expiresAt: r.expiresAt };
  }) : [];
  const p = row.verificationPhrase ?? row.phrase;
  return { state: enabled ? row.state as RemoteState : 'unconfigured', enabled, hasCache: row.hasCache === true, pending,
    ...(typeof row.connected === 'boolean' ? { connected: row.connected } : {}),
    ...(phrase(p) ? { phrase: p } : {}), ...(time(row.updatedAt) ? { updatedAt: row.updatedAt } : {}) };
}
export function cachedSnapshot(value: unknown): SaveSnapshot | null {
  if (!value || typeof value !== 'object') throw new Error('REMOTE_CACHE_INVALID');
  const snapshot = (value as Record<string, unknown>).snapshot;
  if (snapshot == null) return null;
  if (!isSupportedSnapshot(snapshot)) throw new Error('REMOTE_CACHE_INVALID');
  return structuredClone(snapshot);
}
export async function remoteMvp(action: RemoteAction, platform: AccountPlatform, options: object = {}): Promise<unknown> {
  if (platform === 'android' || platform === 'ios') {
    if (!['status', 'requestJoin', 'refresh', 'readCache'].includes(action) || Capacitor.getPlatform() !== platform || !Capacitor.isNativePlatform()) throw new Error('REMOTE_UNAVAILABLE');
    return native[action](options);
  }
  if (!['status', 'initialize', 'pending', 'approve', 'reject'].includes(action)) throw new Error('REMOTE_UNAVAILABLE');
  const response = await fetch(`/api/native-remote/${action}`, { method: action === 'status' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nioh2-Desktop-Sync': '1' },
    ...(action === 'status' ? {} : { body: JSON.stringify(options) }),
    cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('REMOTE_UNAVAILABLE');
  return response.json();
}
