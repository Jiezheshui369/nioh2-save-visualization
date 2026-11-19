import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function DesktopDialog({ label, onClose, children, open = true }: { open?: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => { if (before?.isConnected) queueMicrotask(() => before.focus({ preventScroll: true })); };
  }, [open]);
  return <div hidden={!open} className="df-dialog-backdrop"><section ref={root} className="df-dialog df-panel" role="dialog" aria-modal="true" aria-label={label}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const elements = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
        const at = elements.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); elements[(at + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus();
      }
    }}>{children}</section></div>;
}
