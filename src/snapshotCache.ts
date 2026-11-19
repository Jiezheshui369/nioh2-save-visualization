import type { DeviceArchiveInfo, SaveSnapshot, SnapshotSummary } from "./types";
import { isSupportedSnapshot } from "./snapshotValidation";
import { readableSnapshotIndex } from "./snapshotSummary";

const DATABASE_NAME = "nioh2-save-companion";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const LATEST_KEY = "latest";
const INDEX_KEY = "index";
const ARCHIVE_INFO_KEY = "archive-info";
const SNAPSHOT_KEY_PREFIX = "snapshot:";
const MAX_CACHED_SNAPSHOTS = 20;
export const SNAPSHOT_CACHE_UPDATED_EVENT = "nioh2-snapshot-cache-updated";

function openDatabase(): Promise<IDBDatabase | null> {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("本机档案库被其他窗口占用，请关闭旧窗口后重试。")); };
  });
}

// Remote records use their own scoped keys in this store; never replace legacy latest/index.
export { openDatabase as openSnapshotCacheDatabase };

function snapshotKey(snapshotId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${snapshotId}`;
}

function snapshotSummary(snapshot: SaveSnapshot): SnapshotSummary {
  return {
    snapshotId: snapshot.snapshotId,
    researchLabel: snapshot.researchLabel,
    createdAt: snapshot.sourceLastWriteLocal,
    level: snapshot.character.level,
    parserVersion: snapshot.parserVersion,
  };
}

function summaryTimestamp(summary: SnapshotSummary): number {
  const value = summary.createdAt ? Date.parse(summary.createdAt) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

export function mergeCachedSnapshotIndex(existing: SnapshotSummary[], snapshot: SaveSnapshot): SnapshotSummary[] {
  return [snapshotSummary(snapshot), ...readableSnapshotIndex(existing).filter((item) => item.snapshotId !== snapshot.snapshotId)]
    .sort((left, right) => summaryTimestamp(right) - summaryTimestamp(left) || right.snapshotId.localeCompare(left.snapshotId))
    .slice(0, MAX_CACHED_SNAPSHOTS);
}

async function persistSnapshot(snapshot: SaveSnapshot, archiveInfo?: DeviceArchiveInfo, makeLatest = true): Promise<void> {
  if (!isSupportedSnapshot(snapshot)) throw new Error("角色档案不完整，未修改本机已有档案。");
  if (archiveInfo && (!validArchiveInfo(archiveInfo) || archiveInfo.sourceSnapshotId !== snapshot.snapshotId)) {
    throw new Error('档案来源记录与角色不一致，未修改本机已有档案。');
  }
  // Capture the validated transaction input before asynchronous database opening.
  // A caller mutation must not split latest/history/index into different records.
  snapshot = structuredClone(snapshot);
  archiveInfo = archiveInfo === undefined ? undefined : structuredClone(archiveInfo);
  const database = await openDatabase();
  if (!database) throw new Error("设备本地存储不可用，请关闭隐私模式并检查存储空间。");
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("本地档案写入失败。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("本地档案写入已取消，旧档案未改变。"));
      try {
      const store = transaction.objectStore(STORE_NAME);
      if (makeLatest) store.put(snapshot, LATEST_KEY);
      store.put(snapshot, snapshotKey(snapshot.snapshotId));
      if (archiveInfo) store.put(archiveInfo, ARCHIVE_INFO_KEY);
      const indexRequest = store.get(INDEX_KEY);
      indexRequest.onsuccess = () => {
        try {
        const existing = readableSnapshotIndex(indexRequest.result);
        const merged = mergeCachedSnapshotIndex(existing, snapshot);
        store.put(merged, INDEX_KEY);
        const retained = new Set(merged.map((item) => snapshotKey(item.snapshotId)));
        if (!retained.has(snapshotKey(snapshot.snapshotId))) store.delete(snapshotKey(snapshot.snapshotId));
        existing.forEach((item) => {
          const key = snapshotKey(item.snapshotId);
          if (!retained.has(key)) store.delete(key);
        });
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
    window.dispatchEvent(new Event(SNAPSHOT_CACHE_UPDATED_EVENT));
  } finally {
    database.close();
  }
}

// Explicit imports must commit before the UI promises offline availability.
export async function saveImportedSnapshot(snapshot: SaveSnapshot, info: DeviceArchiveInfo): Promise<void> {
  await persistSnapshot(snapshot, info);
}

export async function saveCachedSnapshot(snapshot: SaveSnapshot): Promise<void> {
  try {
    await persistSnapshot(snapshot);
  } catch {
    // Offline caching is a convenience. A browser privacy mode must not block live viewing.
  }
}

// An explicit download must report persistence failures. It is history, not a
// request to change the character selected for the next offline launch.
export async function saveHistorySnapshot(snapshot: SaveSnapshot): Promise<void> {
  await persistSnapshot(snapshot, undefined, false);
}

async function readStoredValue(key: string, required = false): Promise<unknown> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) {
      if (required) throw new Error("本机存储暂不可用，请检查隐私设置和存储空间；不要清除应用数据。");
      return undefined;
    }
    return await new Promise((resolve, reject) => {
      const transaction = database!.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      let value: unknown;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (reason) {
    if (required) throw new Error("本机档案读取失败，原数据未删除。请重试；不要卸载应用或清除数据。", { cause: reason });
    return undefined;
  } finally { database?.close(); }
}

export async function loadCachedSnapshotById(snapshotId: string): Promise<SaveSnapshot | null> {
  const snapshot = await loadSnapshotValue(snapshotKey(snapshotId));
  return snapshot?.snapshotId === snapshotId ? snapshot : null;
}

export async function loadCachedSnapshotIndex(): Promise<SnapshotSummary[]> {
  const value = await readStoredValue(INDEX_KEY);
  return readableSnapshotIndex(value);
}

async function loadSnapshotValue(key: string, required = false): Promise<SaveSnapshot | null> {
  const value = await readStoredValue(key, required);
  if (required && value !== undefined && !isSupportedSnapshot(value)) {
    throw new Error("本机角色记录无法识别，原数据仍保留。请保留应用数据，再从电脑重新同步。");
  }
  return isSupportedSnapshot(value) ? value : null;
}

export async function loadCachedSnapshot(options?: { required?: boolean }): Promise<SaveSnapshot | null> {
  return loadSnapshotValue(LATEST_KEY, options?.required);
}

export async function saveDeviceArchiveInfo(info: DeviceArchiveInfo): Promise<void> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(info, ARCHIVE_INFO_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    window.dispatchEvent(new Event(SNAPSHOT_CACHE_UPDATED_EVENT));
  } catch {
    // Metadata is optional; the imported snapshot remains usable without it.
  } finally { database?.close(); }
}

function validArchiveInfo(value: unknown): value is DeviceArchiveInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const info = value as Partial<DeviceArchiveInfo>;
  return info.schemaVersion === "1.0.0" && typeof info.importedAt === "string" && info.importedAt.length <= 80 && Number.isFinite(Date.parse(info.importedAt))
    && typeof info.sourceSnapshotId === "string" && !!info.sourceSnapshotId.trim() && info.sourceSnapshotId.length <= 160
    && typeof info.sourceLastWriteLocal === "string" && info.sourceLastWriteLocal.length <= 80
    && typeof info.buildCount === "number" && Number.isSafeInteger(info.buildCount) && info.buildCount >= 0
    && (info.exportedAt === undefined || typeof info.exportedAt === "string" && info.exportedAt.length <= 80 && Number.isFinite(Date.parse(info.exportedAt)))
    && (info.source === "asset-package" || info.source === "computer-sync" || info.source === "legacy-snapshot");
}

export async function loadDeviceArchiveInfo(): Promise<DeviceArchiveInfo | null> {
  const value = await readStoredValue(ARCHIVE_INFO_KEY);
  return validArchiveInfo(value) ? value : null;
}

export async function clearCachedSnapshot(): Promise<void> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) throw new Error("本机存储不可用，无法确认清理结果。");
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    window.dispatchEvent(new Event(SNAPSHOT_CACHE_UPDATED_EVENT));
  } catch (reason) {
    throw new Error("离线副本未能清除，请重试。不要把此结果视为数据已经删除。", { cause: reason });
  } finally { database?.close(); }
}
