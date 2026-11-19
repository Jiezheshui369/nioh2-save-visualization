import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeAccount } from './nativeAccount';
import type { AccountAction, NativeAccountStatus } from './nativeAccount';
export function useDesktopAccount(onInvalidate?: () => void) {
  const [status, setStatus] = useState<NativeAccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(false), generation = useRef(0), actionLock = useRef(false), pending = useRef(false);
  const update = useCallback(async (action: AccountAction) => {
    if (actionLock.current || (action === 'status' && pending.current)) return;
    const mutation = action !== 'status';
    if (mutation) { actionLock.current = true; onInvalidate?.(); setStatus(null); setError(false); setBusy(true); }
    else pending.current = true;
    const epoch = ++generation.current;
    try {
      const next = await nativeAccount(action, 'windows');
      if (mounted.current && epoch === generation.current) { setStatus(next); setError(false); }
    } catch {
      if (mounted.current && epoch === generation.current) { setStatus(null); setError(true); }
    } finally {
      if (mutation) actionLock.current = false;
      else pending.current = false;
      if (mounted.current && epoch === generation.current) setBusy(false);
    }
  }, [onInvalidate]);
  useEffect(() => {
    mounted.current = true; void update('status');
    const foreground = () => { if (document.visibilityState !== 'hidden') void update('status'); };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => { mounted.current = false; generation.current++; pending.current = false; window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); };
  }, [update]);
  useEffect(() => {
    if (!status || (status.state !== 'signing-in' && !status.browserPending && status.state !== 'signed-in')) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void update('status');
    }, status.state === 'signing-in' || status.browserPending ? 1200 : 30000);
    return () => window.clearInterval(timer);
  }, [status?.state, status?.browserPending, update]);
  return { status, busy, error, update };
}
