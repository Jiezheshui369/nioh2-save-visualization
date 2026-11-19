import type { NativeAccountStatus } from './nativeAccount';
export interface DesktopDataContext { accountScope: string; sessionId: string }
const opaque = /^[0-9a-f]{64}$/;
export function validDesktopContext(value: DesktopDataContext | null | undefined): value is DesktopDataContext {
  return !!value && opaque.test(value.accountScope) && opaque.test(value.sessionId);
}
export function desktopContextFromStatus(status: NativeAccountStatus | null): DesktopDataContext | null {
  const value = { accountScope: status?.localDataScope ?? '', sessionId: status?.localDataSessionId ?? '' };
  return status?.state === 'signed-in' && validDesktopContext(value) ? value : null;
}
export function sameDesktopContext(a: DesktopDataContext | null, b: DesktopDataContext | null): boolean {
  return a === b || !!a && !!b && a.accountScope === b.accountScope && a.sessionId === b.sessionId;
}
export function desktopContextHeaders(context: DesktopDataContext): Record<string,string> {
  if (!validDesktopContext(context)) throw new Error('LOCAL_DATA_CONTEXT_INVALID');
  return { 'X-Nioh2-Desktop-Sync':'1', 'X-SaveAsset-Local-Scope':context.accountScope, 'X-SaveAsset-Local-Session':context.sessionId };
}
