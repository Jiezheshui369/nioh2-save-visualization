import { Capacitor, registerPlugin } from '@capacitor/core';

export type AccountState = 'signed-out' | 'signing-in' | 'signed-in' | 'error';
export interface NativeAccountStatus { state: AccountState; localDataScope?: string; localDataSessionId?: string; errorCode?: string; browserPending?: boolean; idAuthenticationRecent?: boolean; serviceAuthenticationEvidence?: boolean; serviceAuthenticationRecent?: boolean }
export type AccountAction = 'status' | 'login' | 'logout' | 'cancel';
export type AccountPlatform = 'windows' | 'android' | 'ios';
const states: AccountState[] = ['signed-out', 'signing-in', 'signed-in', 'error'];
const SaveAssetAuth = registerPlugin<Record<AccountAction, () => Promise<unknown>>>('SaveAssetAuth');

// Only the native account state crosses this boundary. Never forward native
// exceptions, tokens, profile objects or authorization URLs into React state.
export function accountStatus(value: unknown): NativeAccountStatus {
  if (!value || typeof value !== 'object') throw new Error('AUTH_STATUS_INVALID');
  const row = value as Record<string, unknown>;
  if (!states.includes(row.state as AccountState)) throw new Error('AUTH_STATUS_INVALID');
  return { state: row.state as AccountState,
    ...(row.state === 'signed-in' && typeof row.localDataScope === 'string' && /^[0-9a-f]{64}$/.test(row.localDataScope)
      && typeof row.localDataSessionId === 'string' && /^[0-9a-f]{64}$/.test(row.localDataSessionId)
      ? { localDataScope: row.localDataScope, localDataSessionId: row.localDataSessionId } : {}),
    ...Object.fromEntries(['idAuthenticationRecent','serviceAuthenticationEvidence','serviceAuthenticationRecent'].filter(k => typeof row[k] === 'boolean').map(k => [k,row[k]])),
    ...(typeof row.browserPending === 'boolean' ? { browserPending: row.browserPending } : {}),
    ...(typeof row.errorCode === 'string' && /^AUTH_[A-Z_]{1,48}$/.test(row.errorCode) ? { errorCode: row.errorCode } : {}) };
}

export async function nativeAccount(action: AccountAction, platform: AccountPlatform): Promise<NativeAccountStatus> {
  try {
    if (platform === 'android' || platform === 'ios') {
      if (Capacitor.getPlatform() !== platform || !Capacitor.isNativePlatform()) throw new Error('AUTH_UNAVAILABLE');
      return accountStatus(await SaveAssetAuth[action]());
    }
    const response = await fetch(`/api/native-auth/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nioh2-Desktop-Sync': '1' },
      cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
    return accountStatus(await response.json());
  } catch { throw new Error('暂时无法读取本机账号状态，请确认正在使用新版原生应用后重试。'); }
}
