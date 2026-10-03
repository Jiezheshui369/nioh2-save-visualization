import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAgentStatus } from './api';
import type { AgentStatus } from './types';

/** Status is transient: a failed/current read must not leave a stale "connected" badge. */
export function useAgentStatus(nativeApp: boolean) {
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const refreshAgentStatus = useCallback(async () => {
    if (nativeApp || !mounted.current) return;
    const currentEpoch = ++epoch.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const status = await loadAgentStatus(controller.signal);
      if (mounted.current && currentEpoch === epoch.current && !controller.signal.aborted) setAgentStatus(status);
    } catch {
      if (mounted.current && currentEpoch === epoch.current) setAgentStatus(null);
    } finally {
      window.clearTimeout(timeout);
      if (currentEpoch === epoch.current) request.current = null;
    }
  }, [nativeApp]);
  useEffect(() => {
    mounted.current = true;
    if (nativeApp) setAgentStatus(null);
    else void refreshAgentStatus();
    const poll = () => {
      if (!nativeApp && !request.current && document.visibilityState !== 'hidden') void refreshAgentStatus();
    };
    const timer = window.setInterval(poll, 20000);
    return () => {
      mounted.current = false; epoch.current++;
      request.current?.abort(); request.current = null;
      window.clearInterval(timer);
    };
  }, [nativeApp, refreshAgentStatus]);
  return { agentStatus, refreshAgentStatus };
}
