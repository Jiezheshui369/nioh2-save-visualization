import type { SnapshotSummary } from './types';
import { finite, record, text } from './dataValidation';

// Older agents emit null for absent optional metadata. Normalize it before UI use.
export function normalizeSnapshotSummary(value: unknown): SnapshotSummary | null {
  if (!record(value) || !text(value.snapshotId, 160) || !value.snapshotId.trim()) return null;
  const result: SnapshotSummary = { snapshotId: value.snapshotId };
  for (const key of ['researchLabel', 'createdAt', 'parserVersion'] as const) {
    const field = value[key];
    if (field == null) continue;
    if (!text(field, key === 'createdAt' ? 80 : 1024)) return null;
    result[key] = field;
  }
  if (value.level != null) {
    if (!finite(value.level)) return null;
    result.level = value.level;
  }
  return result;
}

// Network lists are all-or-nothing: never download a partially understood index.
export function validateSnapshotIndex(value: unknown): SnapshotSummary[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('电脑返回的档案列表无效，未下载历史档案。');
  const seen = new Set<string>();
  return value.map(item => {
    const summary = normalizeSnapshotSummary(item);
    if (!summary || seen.has(summary.snapshotId)) throw new Error('电脑返回的档案列表无效，未下载历史档案。');
    seen.add(summary.snapshotId);
    return summary;
  });
}

// Reading an old cache must neither crash the page nor destructively repair data.
export function readableSnapshotIndex(value: unknown): SnapshotSummary[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: SnapshotSummary[] = [];
  for (const item of value.slice(0, 10000)) {
    const summary = normalizeSnapshotSummary(item);
    if (summary && !seen.has(summary.snapshotId)) {
      seen.add(summary.snapshotId);
      result.push(summary);
    }
  }
  return result;
}
