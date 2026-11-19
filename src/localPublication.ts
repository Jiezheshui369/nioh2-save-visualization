import { record } from './dataValidation';
import { isSupportedSnapshot } from './snapshotValidation';
import { PUBLICATION_ENCODING, publicationBytes } from './publicationEncoding';
import type { RemotePublication } from './remoteSnapshotRouter';
import type { SaveSnapshot } from './types';
import { createShareSnapshot } from './privacy';

/** Desktop loopback only. This validates a local publication, NOT a remote identity. */
export async function validateLocalPublication(value: unknown,
  sha256: (bytes: Uint8Array) => Promise<string>): Promise<RemotePublication> {
  if (!record(value) || Object.keys(value).length !== 4 || value.revisionContract !== PUBLICATION_ENCODING
    || typeof value.publicationVersion !== 'number' || !Number.isSafeInteger(value.publicationVersion) || value.publicationVersion < 1
    || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || !isSupportedSnapshot(value.snapshot)
    || value.snapshot.privacy?.redactedForSharing !== true || value.snapshot.safety.originalMainSaveSha256 !== '已隐藏'
    || value.snapshot.characterStatus !== undefined) throw new Error('INVALID_LOCAL_PUBLICATION');
  const snapshot = JSON.parse(JSON.stringify(value.snapshot)) as SaveSnapshot;
  const publicationVersion = value.publicationVersion, revision = value.revision;
  const bytes = publicationBytes(snapshot);
  const projected = publicationBytes(createShareSnapshot(snapshot));
  if (bytes.length > 5 * 1024 * 1024 || bytes.length !== projected.length || bytes.some((b, i) => b !== projected[i])
    || await sha256(bytes) !== revision) throw new Error('INVALID_LOCAL_PUBLICATION');
  return { snapshot, publicationVersion };
}

export async function readLocalPublication(signal?: AbortSignal): Promise<RemotePublication> {
  const response = await fetch('/api/publications/latest', { signal, cache: 'no-store',
    headers: { 'X-Nioh2-Desktop-Sync': '1' } });
  if (!response.ok) throw new Error('LOCAL_PUBLICATION_UNAVAILABLE');
  // Bound the actual stream, not just its optional Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('LOCAL_PUBLICATION_UNAVAILABLE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 6 * 1024 * 1024) throw new Error('LOCAL_PUBLICATION_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return validateLocalPublication(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), async input => {
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(input));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  });
}
