import type { AttributeKey, LoadoutItem, SaveSnapshot } from "./types";
import { attributes, finite, list, loadout, record, text } from "./dataValidation";
import { createShareBuild } from './privacy';

const LEGACY_STORAGE_KEY = "nioh2-build-library-v1";
const DATABASE_NAME = "nioh2-build-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "builds";
const ALL_BUILDS_KEY = "all";
const MAX_SAVED_BUILDS = 50;
export const BUILD_LIBRARY_UPDATED_EVENT = "nioh2-build-library-updated";

export interface SavedBuild {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  sourceSnapshotId: string;
  sourceLastWriteLocal: string;
  level: number;
  attributes: Record<AttributeKey, number>;
  equipment: LoadoutItem[];
}

export function isSavedBuild(value: unknown): value is SavedBuild {
  if (!record(value)) return false;
  return value.schemaVersion === "1.0.0" && text(value.id, 160) && !!value.id.trim()
    && text(value.title, 160) && text(value.note, 10000)
    && text(value.createdAt, 80) && Number.isFinite(Date.parse(value.createdAt))
    && text(value.updatedAt, 80) && Number.isFinite(Date.parse(value.updatedAt))
    && text(value.sourceSnapshotId, 160) && text(value.sourceLastWriteLocal, 80)
    && finite(value.level) && attributes(value.attributes) && list(value.equipment, 64, loadout);
}

export function isSavedBuildList(value: unknown): value is SavedBuild[] {
  return Array.isArray(value) && value.every(isSavedBuild)
    && new Set(value.map(build => build.id)).size === value.length;
}

function normalize(builds: unknown[]): SavedBuild[] {
  if (!isSavedBuildList(builds)) throw new Error("配装册包含无效时间、重复编号或无法识别的记录，已保留原数据，请先备份再恢复。");
  return builds
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function decodeBuilds(value: unknown): SavedBuild[] {
  if (!Array.isArray(value)) throw new Error("配装册数据无法读取，已保留原数据，请勿清除应用数据。");
  return normalize(value);
}

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
    request.onblocked = () => {
      blocked = true;
      reject(new Error("配装册升级被其他窗口占用，请关闭旧窗口后重试。"));
    };
  });
}

function storageError(reason: unknown): Error {
  if (reason instanceof SyntaxError) return new Error("配装册数据无法读取，已保留原数据，请勿清除应用数据。", { cause: reason });
  return reason instanceof Error && !(reason instanceof DOMException)
    ? reason
    : new Error("无法读写配装册，原记录未被替换。请检查存储空间或隐私设置后重试。", { cause: reason });
}

type Mutation = (builds: SavedBuild[]) => SavedBuild[];

async function accessBuilds(mutate?: Mutation): Promise<SavedBuild[]> {
  let database: IDBDatabase | null = null;
  // Capture migration data only if the primary database has never stored a library.
  // An intentional [] must not resurrect stale localStorage data.
  let migratedRaw: string | null = null;
  const legacy = () => {
    migratedRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return migratedRaw === null ? [] : decodeBuilds(JSON.parse(migratedRaw));
  };
  const apply = (current: SavedBuild[]) => {
    if (!mutate) return current;
    const next = normalize(mutate(current));
    if (next.length > MAX_SAVED_BUILDS && next.length >= current.length) {
      throw new Error("配装册最多保存 50 套；请先移除不需要的配装再重试。现有配装未被覆盖。");
    }
    return next;
  };
  try {
    database = await openDatabase();
    if (!database) {
      const next = apply(legacy());
      if (mutate) window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(next));
      return next;
    }
    const next = await new Promise<SavedBuild[]>((resolve, reject) => {
      // One transaction serializes read-modify-write across tabs as well as callers.
      const transaction = database!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(ALL_BUILDS_KEY);
      let result: SavedBuild[] = [];
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const missing = request.result === undefined;
          result = apply(missing ? legacy() : decodeBuilds(request.result));
          if (mutate || missing) store.put(result, ALL_BUILDS_KEY);
        } catch (reason) {
          failure = reason;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.onerror = () => { failure ??= transaction.error; };
    });
    // A failed IDB write never switches to a second backend. Remove a migrated
    // legacy copy only after commit, and only if another writer hasn't changed it.
    try {
      if (migratedRaw !== null && window.localStorage.getItem(LEGACY_STORAGE_KEY) === migratedRaw) {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch { /* Committed database is authoritative; retain the legacy copy. */ }
    return next;
  } catch (reason) {
    throw storageError(reason);
  } finally {
    database?.close();
  }
}

function buildId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `build-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function loadSavedBuilds(): Promise<SavedBuild[]> {
  return accessBuilds();
}

export async function saveCurrentBuild(snapshot: SaveSnapshot, title: string, note = ""): Promise<SavedBuild[]> {
  const normalizedTitle = title.trim().slice(0, 40);
  if (!normalizedTitle) throw new Error("请先填写配装名称。");
  const now = new Date().toISOString();
  const next: SavedBuild = {
    schemaVersion: "1.0.0",
    id: buildId(),
    title: normalizedTitle,
    note: note.trim().slice(0, 240),
    createdAt: now,
    updatedAt: now,
    sourceSnapshotId: snapshot.snapshotId,
    sourceLastWriteLocal: snapshot.sourceLastWriteLocal,
    level: snapshot.character.level,
    attributes: { ...snapshot.character.attributes },
    equipment: snapshot.currentLoadout.map((item) => ({
      ...item,
      effects: item.effects ? [...item.effects] : undefined,
      effectsZh: item.effectsZh ? [...item.effectsZh] : undefined,
      effectIds: item.effectIds ? [...item.effectIds] : undefined,
      effectMagnitudes: item.effectMagnitudes ? [...item.effectMagnitudes] : undefined,
      effectValueDetails: item.effectValueDetails?.map(detail => ({ ...detail })),
    })),
  };
  if (!isSavedBuild(next)) throw new Error("当前配装记录不完整，未修改已收藏的配装。");
  const builds = await accessBuilds(current => [next, ...current]);
  window.dispatchEvent(new Event(BUILD_LIBRARY_UPDATED_EVENT));
  return builds;
}

export async function importSavedBuilds(imported: unknown[]): Promise<SavedBuild[]> {
  // Detach before waiting for storage; callers must not mutate a pending import.
  const incoming = normalize(imported).map(createShareBuild);
  const builds = await accessBuilds(current => {
    const byId = new Map(current.map((build) => [build.id, build]));
    for (const build of incoming) {
      const existing = byId.get(build.id);
      if (!existing || Date.parse(build.updatedAt) > Date.parse(existing.updatedAt)) byId.set(build.id, build);
    }
    return [...byId.values()];
  });
  window.dispatchEvent(new Event(BUILD_LIBRARY_UPDATED_EVENT));
  return builds;
}

export async function deleteSavedBuild(id: string): Promise<SavedBuild[]> {
  const builds = await accessBuilds(current => current.filter((build) => build.id !== id));
  window.dispatchEvent(new Event(BUILD_LIBRARY_UPDATED_EVENT));
  return builds;
}
