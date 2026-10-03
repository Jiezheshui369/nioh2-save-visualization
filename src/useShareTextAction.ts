import { useEffect, useRef, useState } from 'react';
import { isShareCancelled, shareText } from './fileSharing';

/** Share sheets are user-controlled; cancel is neutral and never triggers a fallback send. */
export function useShareTextAction() {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(title: string, text: string) {
    if (lock.current || !mounted.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await shareText(title, text); }
    catch (reason) { if (mounted.current && !isShareCancelled(reason)) setError('分享未完成，可重试。'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { run, busy, error };
}
