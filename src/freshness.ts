export function isSourceNewer(sourceLastWriteLocal?: string | null, snapshotLastWriteLocal?: string | null): boolean {
  if (!sourceLastWriteLocal || !snapshotLastWriteLocal) return false;
  const sourceTime = Date.parse(sourceLastWriteLocal);
  const snapshotTime = Date.parse(snapshotLastWriteLocal);
  return Number.isFinite(sourceTime) && Number.isFinite(snapshotTime) && sourceTime > snapshotTime + 1000;
}
