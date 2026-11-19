/** Observed game-panel values are evidence, not parser output or a damage formula. */
export interface StatusEntry {
  label: string;
  /** null records absence of a displayed numeric value; it does not prove activation. */
  value: string | null;
  pages: number[];
}

export interface StatusGroup {
  title: string;
  entries: StatusEntry[];
}

export interface CharacterStatus {
  version: 1;
  source: "game-screenshots";
  recordedOn: string;
  captureTime: string | null;
  referenceSnapshotId: string;
  screenshotCount: number;
  groups: StatusGroup[];
  effects: StatusGroup[];
}

/** Presentation only: keep the original observation intact for export and research. */
export function formatPanelValue(entry: StatusEntry): string | null {
  if (!["体力", "精力", "妖力"].includes(entry.label) || entry.value === null) return entry.value;
  const pair = /^\s*\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(entry.value);
  return pair ? pair[1] : entry.value;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function isCharacterStatus(value: unknown): value is CharacterStatus {
  if (!record(value) || value.version !== 1 || value.source !== "game-screenshots") return false;
  if (!text(value.recordedOn, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value.recordedOn) || !Number.isFinite(Date.parse(value.recordedOn))) return false;
  if (value.captureTime !== null && (!text(value.captureTime, 40) || !Number.isFinite(Date.parse(value.captureTime)))) return false;
  if (!text(value.referenceSnapshotId, 160) || !Number.isInteger(value.screenshotCount) || (value.screenshotCount as number) < 1 || (value.screenshotCount as number) > 100) return false;
  const pageCount = value.screenshotCount as number;
  return [value.groups, value.effects].every((groups) => Array.isArray(groups) && groups.length <= 20 && groups.every((group) =>
    record(group) && text(group.title, 80) && Array.isArray(group.entries) && group.entries.length <= 200 && group.entries.every((entry) =>
      record(entry) && text(entry.label, 160) && (entry.value === null || text(entry.value, 80))
      && Array.isArray(entry.pages) && entry.pages.length > 0 && entry.pages.length <= pageCount
      && entry.pages.every((page) => Number.isInteger(page) && page >= 1 && page <= pageCount),
    ),
  ));
}

/** Only identical label AND value merge. Flat and percentage bonuses stay separate. */
export function deduplicateEntries(entries: StatusEntry[]): StatusEntry[] {
  const unique = new Map<string, StatusEntry>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.label, entry.value]);
    const old = unique.get(key);
    unique.set(key, { ...entry, pages: [...new Set([...(old?.pages ?? []), ...entry.pages])].sort((a, b) => a - b) });
  }
  return [...unique.values()];
}
