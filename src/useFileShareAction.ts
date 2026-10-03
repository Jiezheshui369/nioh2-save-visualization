import { useEffect, useRef, useState } from 'react';
import { isShareCancelled, shareOrDownloadFile } from './fileSharing';

type Result = 'idle' | 'shared' | 'saved' | 'failed';

/** Do not open a delayed share sheet for a screen/record the user has left. */
export function useFileShareAction(identity: unknown) {
  const mounted = useRef(true);
  const currentIdentity = useRef(identity);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ owner: unknown; state: Result } | null>(null);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current !== null) clearTimeout(timer.current); };
  }, []);

  async function run(createBlob: () => Promise<Blob>, filename: string, title: string) {
    if (!mounted.current || lock.current) return;
    lock.current = true;
    if (timer.current !== null) clearTimeout(timer.current);
    setBusy(true); setResult(null);
    let outcome: Result = 'idle';
    try {
      const blob = await createBlob();
      if (!mounted.current || currentIdentity.current !== identity) return;
      outcome = await shareOrDownloadFile(blob, filename, title);
    } catch (reason) { if (!isShareCancelled(reason)) outcome = 'failed'; }
    finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        if (currentIdentity.current === identity) {
          setResult({ owner: identity, state: outcome });
          timer.current = setTimeout(() => { if (mounted.current) setResult(null); }, 2400);
        }
      }
    }
  }
  return { run, busy, state: busy ? 'working' as const : result && result.owner === identity ? result.state : 'idle' as const };
}
