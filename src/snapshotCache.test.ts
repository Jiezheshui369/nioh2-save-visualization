import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBDatabase, IDBObjectStore } from "fake-indexeddb";
import { clearCachedSnapshot, loadCachedSnapshot, loadCachedSnapshotById, loadCachedSnapshotIndex, loadDeviceArchiveInfo, mergeCachedSnapshotIndex, saveCachedSnapshot, saveDeviceArchiveInfo, saveHistorySnapshot, saveImportedSnapshot, SNAPSHOT_CACHE_UPDATED_EVENT } from "./snapshotCache";
import type { DeviceArchiveInfo, SaveSnapshot, SnapshotSummary } from "./types";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function archiveInfo(id: string): DeviceArchiveInfo {
  return { schemaVersion: "1.0.0", importedAt: "2026-09-21T00:00:00Z", sourceSnapshotId: id, sourceLastWriteLocal: "2026-09-20T00:00:00Z", buildCount: 0, source: "asset-package" };
}

function snapshot(snapshotId: string, sourceLastWriteLocal: string): SaveSnapshot {
  return {
    schemaVersion: "test",
    parserVersion: "test",
    game: "Nioh 2",
    platform: "Steam/Windows",
    snapshotId,
    sourceLastWriteLocal,
    safety: {
      sourceOpenedReadOnly: true,
      parsedFromCopy: true,
      originalMainSaveSha256: "test",
      originalHashUnchangedAfterProcessing: true,
    },
    character: {
      level: 1,
      amrita: 0,
      gold: 0,
      attributes: { constitution: 1, heart: 1, courage: 1, stamina: 1, strength: 1, skill: 1, dexterity: 1, magic: 1 },
      proficiency: {},
    },
    currentLoadout: [],
    inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
    limitations: [],
  };
}

describe("offline snapshot history", () => {
  it('captures independent inputs before database opening so late mutation cannot alter the commit', async () => {
    const data = snapshot('captured', '2026-09-25');
    const info = archiveInfo('captured');
    const pending = saveImportedSnapshot(data, info);
    data.snapshotId = 'changed'; data.character.level = 9999; data.character.attributes.heart = 8888;
    info.sourceSnapshotId = 'changed'; info.buildCount = 42;
    await pending;
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: 'captured', character: { level: 1, attributes: { heart: 1 } } });
    await expect(loadCachedSnapshotById('captured')).resolves.toMatchObject({ snapshotId: 'captured' });
    await expect(loadCachedSnapshotById('changed')).resolves.toBeNull();
    await expect(loadCachedSnapshotIndex()).resolves.toMatchObject([{ snapshotId: 'captured', level: 1 }]);
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: 'captured', buildCount: 0 });
  });
  it.each(['identity', 'date', 'count'])('rejects invalid mandatory receipt %s before touching old data', async kind => {
    await saveImportedSnapshot(snapshot('old', '2026-09-25'), archiveInfo('old'));
    const info = { ...archiveInfo('new'), ...(kind === 'identity' ? { sourceSnapshotId: 'another' } : kind === 'date' ? { importedAt: 'bad-date' } : { buildCount: -1 }) };
    await expect(saveImportedSnapshot(snapshot('new', '2026-09-25'), info)).rejects.toThrow('来源记录与角色不一致');
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: 'old' });
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: 'old' });
  });
  it('treats corrupt optional receipt dates as absent without losing the offline character', async () => {
    await saveImportedSnapshot(snapshot('good', '2026-09-25'), archiveInfo('good'));
    await saveDeviceArchiveInfo({ ...archiveInfo('good'), exportedAt: 'not-a-date' });
    await expect(loadDeviceArchiveInfo()).resolves.toBeNull();
    await expect(loadCachedSnapshot({ required: true })).resolves.toMatchObject({ snapshotId: 'good' });
  });
  it('reads around damaged index rows without rewriting them or accepting a mismatched snapshot key', async () => {
    await saveImportedSnapshot(snapshot('good', '2026-09-25'), archiveInfo('good'));
    const corruptIndex = [{ snapshotId: 'good', researchLabel: null }, { snapshotId: 'bad', level: {} }, null];
    const open = indexedDB.open('nioh2-save-companion', 1);
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put(corruptIndex, 'index');
        tx.objectStore('snapshots').put(snapshot('different', '2026-09-25'), 'snapshot:bad');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      open.onerror = () => reject(open.error);
    });
    const write = vi.spyOn(IDBObjectStore.prototype, 'put');
    await expect(loadCachedSnapshotIndex()).resolves.toEqual([{ snapshotId: 'good' }]);
    await expect(loadCachedSnapshotById('bad')).resolves.toBeNull();
    await expect(loadCachedSnapshot({ required: true })).resolves.toMatchObject({ snapshotId: 'good' });
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects invalid provenance metadata without making the character unreadable", async () => {
    await saveImportedSnapshot(snapshot("good", "2026-09-25"), archiveInfo("good"));
    await saveDeviceArchiveInfo({ ...archiveInfo("good"), buildCount: -1 });
    await expect(loadDeviceArchiveInfo()).resolves.toBeNull();
    await expect(loadCachedSnapshot({ required: true })).resolves.toMatchObject({ snapshotId: "good" });
  });

  it("closes a database after a required read fails", async () => {
    await saveImportedSnapshot(snapshot("good", "2026-09-25"), archiveInfo("good"));
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    const get = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => { throw new DOMException("Unavailable", "InvalidStateError"); });
    await expect(loadCachedSnapshot({ required: true })).rejects.toThrow("读取失败");
    expect(close).toHaveBeenCalled();
    get.mockRestore();
    await expect(loadCachedSnapshot({ required: true })).resolves.toMatchObject({ snapshotId: "good" });
  });
  it("downloads history without changing the selected offline character or its receipt", async () => {
    await saveImportedSnapshot(snapshot("selected", "2026-09-25"), archiveInfo("selected"));
    await saveHistorySnapshot(snapshot("older", "2026-09-19"));
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "selected" });
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: "selected" });
    await expect(loadCachedSnapshotById("older")).resolves.toMatchObject({ snapshotId: "older" });
    await expect(loadCachedSnapshotIndex()).resolves.toHaveLength(2);
  });

  it("does not create a default character just because history was downloaded", async () => {
    await saveHistorySnapshot(snapshot("historical", "2026-09-19"));
    await expect(loadCachedSnapshot()).resolves.toBeNull();
    await expect(loadCachedSnapshotById("historical")).resolves.toMatchObject({ snapshotId: "historical" });
  });

  it("rejects failed explicit writes while optional live-view caching can fail quietly", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(saveHistorySnapshot(snapshot("old", "2026-09-19"))).rejects.toThrow("不可用");
    await expect(saveCachedSnapshot(snapshot("current", "2026-09-25"))).resolves.toBeUndefined();
  });

  it("distinguishes a missing archive from a failed mandatory read", async () => {
    await expect(loadCachedSnapshot({ required: true })).resolves.toBeNull();
    const open = vi.spyOn(window.indexedDB, "open").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    await expect(loadCachedSnapshot({ required: true })).rejects.toThrow("原数据未删除");
    await expect(loadCachedSnapshot()).resolves.toBeNull();
    open.mockRestore();
  });

  it("does not publish a cleared event or lose existing data when clear aborts", async () => {
    await saveImportedSnapshot(snapshot("keep", "2026-09-25"), archiveInfo("keep"));
    const event = vi.fn(); window.addEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, event);
    const original = IDBObjectStore.prototype.clear;
    const clear = vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementationOnce(function (this: IDBObjectStore) {
      const request = original.call(this);
      request.onsuccess = () => this.transaction.abort();
      return request;
    });
    await expect(clearCachedSnapshot()).rejects.toThrow("未能清除");
    clear.mockRestore();
    expect(event).not.toHaveBeenCalled();
    window.removeEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, event);
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "keep" });
    await clearCachedSnapshot();
    await expect(loadCachedSnapshot()).resolves.toBeNull();
    await expect(loadDeviceArchiveInfo()).resolves.toBeNull();
  });

  it("rolls back the entire snapshot when an asynchronous index write cannot be cloned", async () => {
    await saveImportedSnapshot(snapshot("old", "2026-09-19"), archiveInfo("old"));
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === "index") throw new DOMException("index failure", "DataCloneError");
      return original.call(this, value, key);
    });
    await expect(saveImportedSnapshot(snapshot("new", "2026-09-25"), archiveInfo("new"))).rejects.toThrow("index failure");
    put.mockRestore();
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "old" });
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: "old" });
  });

  it("does not leave orphaned history beyond the retention limit", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => saveHistorySnapshot(snapshot(`retained-${index}`, "2026-09-25"))));
    await saveHistorySnapshot(snapshot("too-old", "2020-01-01"));
    await expect(loadCachedSnapshotIndex()).resolves.toHaveLength(20);
    await expect(loadCachedSnapshotById("too-old")).resolves.toBeNull();
  });

  it("refuses incomplete records without overwriting a valid offline character", async () => {
    await saveImportedSnapshot(snapshot("old", "2026-09-19"), archiveInfo("old"));
    const bad = { ...snapshot("broken", "2026-09-20"), currentLoadout: [null] } as unknown as SaveSnapshot;
    await expect(saveImportedSnapshot(bad, archiveInfo("broken"))).rejects.toThrow("角色档案不完整");
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "old" });
  });

  it("does not trust incomplete records already present in an older cache", async () => {
    await saveImportedSnapshot(snapshot("old", "2026-09-19"), archiveInfo("old"));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("nioh2-save-companion", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("snapshots", "readwrite");
        transaction.objectStore("snapshots").put({ schemaVersion: "test", snapshotId: "broken", character: {} }, "latest");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
    await expect(loadCachedSnapshot()).resolves.toBeNull();
    // No destructive "repair": valid history is still retained in the same database.
    await expect(loadCachedSnapshot({ required: true })).rejects.toThrow("原数据仍保留");
    await expect(loadCachedSnapshotIndex()).resolves.toMatchObject([{ snapshotId: "old" }]);
  });
  it("commits character, metadata and index together for reopening offline", async () => {
    const character = snapshot("imported", "2026-09-20T00:00:00Z");
    const info = archiveInfo("imported");
    await saveImportedSnapshot(character, info);
    await expect(loadCachedSnapshot()).resolves.toEqual(character);
    await expect(loadDeviceArchiveInfo()).resolves.toEqual(info);
    await expect(loadCachedSnapshotIndex()).resolves.toMatchObject([{ snapshotId: "imported" }]);
  });

  it("rejects unavailable storage instead of reporting import success", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(saveImportedSnapshot(snapshot("new", "2026-09-20"), archiveInfo("new"))).rejects.toBeDefined();
    // Live desktop viewing still tolerates optional cache failure.
    await expect(saveCachedSnapshot(snapshot("new", "2026-09-20"))).resolves.toBeUndefined();
  });

  it("keeps the previous archive when the write transaction aborts", async () => {
    await saveImportedSnapshot(snapshot("old", "2026-09-19"), archiveInfo("old"));
    const original = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
      const transaction = original.apply(this, args);
      if (args[1] === "readwrite") queueMicrotask(() => transaction.abort());
      return transaction;
    });
    await expect(saveImportedSnapshot(snapshot("new", "2026-09-20"), archiveInfo("new"))).rejects.toBeDefined();
    spy.mockRestore();
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "old" });
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: "old" });
  });

  it("rolls back earlier writes if metadata cannot be cloned", async () => {
    await saveImportedSnapshot(snapshot("old", "2026-09-19"), archiveInfo("old"));
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === "archive-info") throw new DOMException("test clone failure", "DataCloneError");
      return original.call(this, value, key);
    });
    await expect(saveImportedSnapshot(snapshot("new", "2026-09-20"), archiveInfo("new"))).rejects.toThrow("clone failure");
    spy.mockRestore();
    await expect(loadCachedSnapshot()).resolves.toMatchObject({ snapshotId: "old" });
    await expect(loadDeviceArchiveInfo()).resolves.toMatchObject({ sourceSnapshotId: "old" });
  });
  it("keeps chronological order when an older snapshot is viewed later", () => {
    const existing: SnapshotSummary[] = [
      { snapshotId: "20260919T090000Z", createdAt: "2026-09-19T02:44:02+10:00" },
    ];
    const result = mergeCachedSnapshotIndex(existing, snapshot("20260918T080000Z", "2026-09-18T02:44:02+10:00"));
    expect(result.map((item) => item.snapshotId)).toEqual(["20260919T090000Z", "20260918T080000Z"]);
  });

  it("uses the microsecond snapshot id as a stable tie breaker and caps history at 20", () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({
      snapshotId: `20260919T090000${String(index).padStart(2, "0")}Z`,
      createdAt: "2026-09-19T02:44:02+10:00",
    }));
    const result = mergeCachedSnapshotIndex(existing, snapshot("20260919T09000099Z", "2026-09-19T02:44:02+10:00"));
    expect(result).toHaveLength(20);
    expect(result[0].snapshotId).toBe("20260919T09000099Z");
    expect(result.some((item) => item.snapshotId === "20260919T09000000Z")).toBe(false);
  });
});
