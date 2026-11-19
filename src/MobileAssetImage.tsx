import { useState } from 'react';
import type { ReactNode } from 'react';

/** Failed art must not hide the record or invent a replacement game image. */
export function MobileAssetImage({ src, className, fallback = null }: { src?: string; className?: string; fallback?: ReactNode }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!src || failedSource === src) return <>{fallback}</>;
  return <img className={className} src={src} alt="" onError={() => setFailedSource(src)} />;
}
