import type { AgentStatus, SaveSourceOption } from './types';
import { list, optional, record, text } from './dataValidation';

const boolean = (v: unknown) => typeof v === 'boolean';
const timestamp = (v: unknown) => v === null || text(v, 80) && Number.isFinite(Date.parse(v));
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const hint = (v: unknown) => v === null || text(v, 160);

export function validateAgentStatus(value: unknown): AgentStatus {
  if (!record(value) || value.status !== 'ok' || value.writeBackSupported !== false
    || !optional(value.refreshAvailable, boolean) || !optional(value.lanMode, boolean)
    || !optional(value.apiVersion, v => text(v, 80))) throw new Error('电脑服务状态无效，请确认正在使用存档伴侣。');
  const source = value.source;
  const copies = value.backupCopies;
  const cloud = value.steamCloud;
  if (source !== undefined && (!record(source) || !boolean(source.configured) || !hint(source.accountHint)
    || !list(source.saveSlots, 1024, v => text(v, 80)) || !timestamp(source.latestWriteLocal))) {
    throw new Error('电脑返回的存档来源状态无效，未采用旧的连接状态。');
  }
  if (copies !== undefined && (!record(copies) || !count(copies.completeCopies)
    || !count(copies.incompleteCopies) || !timestamp(copies.latestCreatedAtUtc))) throw new Error('电脑副本状态无效。');
  if (cloud !== undefined && (!record(cloud) || !boolean(cloud.detected) || typeof cloud.state !== 'string'
    || !['synchronized', 'local-newer', 'cloud-newer', 'unknown', 'unavailable'].includes(cloud.state)
    || !timestamp(cloud.lastRemoteWriteLocal) || !timestamp(cloud.metadataLastWriteLocal)
    || !optional(cloud.sizeMatches, boolean) || !optional(cloud.contentMatches, v => v === null || boolean(v))
    || !optional(cloud.localMetadataTime, timestamp))) throw new Error('电脑云存档元数据状态无效。');
  // Older health endpoints omitted these capability flags. Absence grants none.
  return { ...value, refreshAvailable: value.refreshAvailable ?? false, lanMode: value.lanMode ?? false } as unknown as AgentStatus;
}

export function validateSaveSources(value: unknown): SaveSourceOption[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error('电脑返回的存档来源列表无效。');
  const seen = new Set<string>();
  return value.map(row => {
    if (!record(row) || !text(row.id, 160) || !row.id.trim() || seen.has(row.id)
      || !hint(row.accountHint) || !text(row.slot, 80) || !timestamp(row.latestWriteLocal) || !boolean(row.active)) {
      throw new Error('电脑返回的存档来源列表无效。');
    }
    seen.add(row.id);
    return { id: row.id, accountHint: row.accountHint, slot: row.slot,
      latestWriteLocal: row.latestWriteLocal, active: row.active } as SaveSourceOption;
  });
}
