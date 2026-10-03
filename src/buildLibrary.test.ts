import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, IDBDatabase } from "fake-indexeddb";
import { deleteSavedBuild, importSavedBuilds, loadSavedBuilds, saveCurrentBuild } from "./buildLibrary";
import type { SaveSnapshot } from "./types";

const snapshot = {
  snapshotId: "source-1",
  sourceLastWriteLocal: "2026-09-20T00:00:00Z",
  character: {
    level: 689,
    attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 },
  },
  currentLoadout: [{ recordIndex: 1, equipIndex: 0, slot: "melee1", id: "FA97", name: "Fists", level: 190, plus: 120, rarity: "Ethereal", setOrGrace: "Grace", type: "Weapon" }],
} as SaveSnapshot;

beforeEach(() => window.localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("build library", () => {
  it('persists a decoded grade and raw value without replacing it with a numeric bonus', async () => {
    const source: SaveSnapshot = { ...snapshot, currentLoadout: [{ ...snapshot.currentLoadout[0],
      effects: ['Synthetic grade effect'], effectIds: ['3961'], effectMagnitudes: ['AA'],
      effectValueDetails: [{ rawValue: 13, kind: 'grade', encoding: 'verified-id' }] }] };
    const [build] = await saveCurrentBuild(source, '档位回归');
    source.currentLoadout[0].effectMagnitudes![0] = 'AAA+';
    source.currentLoadout[0].effectValueDetails![0].rawValue = 99;
    const restored = (await loadSavedBuilds())[0];
    expect(restored.equipment[0].effectMagnitudes).toEqual(['AA']);
    expect(restored.equipment[0].effectValueDetails).toEqual([{ rawValue: 13, kind: 'grade', encoding: 'verified-id' }]);
    expect(restored).toEqual(build);
  });
  it('copies raw effect metadata independently and restores it offline', async () => {
    const source: SaveSnapshot = { ...snapshot, currentLoadout: [{ ...snapshot.currentLoadout[0],
      effects: ['Ultimate Constitution'], effectIds: ['DAC2'], effectMagnitudes: [null],
      effectValueDetails: [{ rawValue: 150, kind: 'condition', encoding: 'not-decoded' }] }] };
    const [build] = await saveCurrentBuild(source, '条件词条');
    source.currentLoadout[0].effectValueDetails![0].rawValue = 200;
    expect(build.equipment[0].effectValueDetails![0].rawValue).toBe(150);
    expect((await loadSavedBuilds())[0].equipment[0].effectValueDetails).toEqual(build.equipment[0].effectValueDetails);
  });
  it("stores an independent named build without the full inventory", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const builds = await saveCurrentBuild(snapshot, "  深层大山阴阳  ", " 展示用 ");
    expect(builds[0]).toMatchObject({ title: "深层大山阴阳", note: "展示用", level: 689, sourceSnapshotId: "source-1" });
    expect(builds[0].equipment[0].id).toBe("FA97");
    expect(JSON.stringify(builds[0])).not.toContain("equipmentInventory");
    await expect(loadSavedBuilds()).resolves.toHaveLength(1);
  });

  it("requires a title and supports removing a saved build", async () => {
    await expect(saveCurrentBuild(snapshot, "   ")).rejects.toThrow("请先填写配装名称");
    const [saved] = await saveCurrentBuild(snapshot, "刷宝装");
    await expect(deleteSavedBuild(saved.id)).resolves.toEqual([]);
  });
});

describe("transactional build library", () => {
  const legacyKey = "nioh2-build-library-v1";
  beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));

  it('compares update instants instead of lexicographic timezone representations', async () => {
    const [template] = await saveCurrentBuild(snapshot, '模板');
    const original = { ...template, id: 'timezone', updatedAt: '2026-09-25T01:00:00Z', title: '较新本地' };
    await importSavedBuilds([original]);
    await importSavedBuilds([{ ...original, updatedAt: '2026-09-25T10:00:00+10:00', title: '实际较旧' }]);
    expect((await loadSavedBuilds()).find(row => row.id === original.id)?.title).toBe('较新本地');
    await importSavedBuilds([{ ...original, updatedAt: '2026-09-24T22:00:00-04:00', title: '实际较新' }]);
    expect((await loadSavedBuilds()).find(row => row.id === original.id)?.title).toBe('实际较新');
  });

  it('rejects duplicate IDs and invalid times without changing existing records', async () => {
    const [build] = await saveCurrentBuild(snapshot, '保留');
    await expect(importSavedBuilds([build, { ...build, title: '含糊重复' }])).rejects.toThrow('重复编号');
    await expect(importSavedBuilds([{ ...build, updatedAt: 'not-a-time' }])).rejects.toThrow('无效时间');
    await expect(importSavedBuilds([{ ...build, id: ' ' }])).rejects.toThrow('保留原数据');
    expect(await loadSavedBuilds()).toEqual([build]);
  });

  it('takes an independent known-field copy before asynchronous storage begins', async () => {
    const [template] = await saveCurrentBuild(snapshot, '模板');
    const imported = { ...template, id: 'incoming', title: '应保存', attributes: { ...template.attributes },
      equipment: template.equipment.map(item => ({ ...item })), privatePath: 'must-not-copy' };
    const pending = importSavedBuilds([imported]);
    imported.title = '迟到改写'; imported.attributes.constitution = 1; imported.equipment[0].name = '迟到装备';
    await pending;
    const saved = (await loadSavedBuilds()).find(build => build.id === 'incoming')!;
    expect(saved.title).toBe('应保存'); expect(saved.attributes.constitution).toBe(150);
    expect(saved.equipment[0].name).toBe('Fists'); expect(saved).not.toHaveProperty('privatePath');
  });

  it("serializes concurrent saves across separate database connections", async () => {
    await Promise.all(Array.from({ length: 15 }, (_, index) => saveCurrentBuild(snapshot, `配装 ${index}`)));
    const saved = await loadSavedBuilds();
    expect(saved).toHaveLength(15);
    expect(new Set(saved.map(build => build.id)).size).toBe(15);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });

  it("does not report success or switch backends after a failed write", async () => {
    const [old] = await saveCurrentBuild(snapshot, "已有配装");
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    const event = vi.fn(); window.addEventListener("nioh2-build-library-updated", event);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await expect(saveCurrentBuild(snapshot, "不能保存")).rejects.toThrow("存储空间");
    expect(close).toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    window.removeEventListener("nioh2-build-library-updated", event);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    put.mockRestore();
    expect((await loadSavedBuilds()).map(build => build.id)).toEqual([old.id]);
  });

  it("rejects a transaction aborted after put success instead of claiming commit", async () => {
    await loadSavedBuilds();
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    await expect(saveCurrentBuild(snapshot, "未提交")).rejects.toThrow();
    put.mockRestore();
    expect(await loadSavedBuilds()).toEqual([]);
  });

  it("migrates legacy data only after a committed transaction", async () => {
    const [build] = await saveCurrentBuild(snapshot, "迁移记录");
    vi.stubGlobal("indexedDB", new IDBFactory());
    const raw = JSON.stringify([build]); window.localStorage.setItem(legacyKey, raw);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await expect(loadSavedBuilds()).rejects.toThrow();
    expect(window.localStorage.getItem(legacyKey)).toBe(raw);
    put.mockRestore();
    expect(await loadSavedBuilds()).toEqual([build]);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(await loadSavedBuilds()).toEqual([build]);
  });

  it("keeps intentionally empty primary storage empty without deleting a legacy recovery copy", async () => {
    const [old] = await saveCurrentBuild(snapshot, "已移除");
    await deleteSavedBuild(old.id);
    const raw = JSON.stringify([old]); window.localStorage.setItem(legacyKey, raw);
    expect(await loadSavedBuilds()).toEqual([]);
    expect(window.localStorage.getItem(legacyKey)).toBe(raw);
  });

  it("preserves a legacy copy changed by another writer during migration", async () => {
    const [build] = await saveCurrentBuild(snapshot, "迁移记录");
    vi.stubGlobal("indexedDB", new IDBFactory());
    window.localStorage.setItem(legacyKey, JSON.stringify([build]));
    const updated = JSON.stringify([{ ...build, title: "另一窗口的新记录" }]);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      window.localStorage.setItem(legacyKey, updated);
      return original.call(this, value, key);
    });
    expect(await loadSavedBuilds()).toEqual([build]);
    expect(window.localStorage.getItem(legacyKey)).toBe(updated);
  });

  it("refuses the 51st build without evicting anything, while allowing deletion and retry", async () => {
    const [first] = await saveCurrentBuild(snapshot, "保留此配装");
    const fifty = Array.from({ length: 50 }, (_, index) => ({ ...first, id: `build-${index}` }));
    await deleteSavedBuild(first.id);
    await importSavedBuilds(fifty);
    await expect(saveCurrentBuild(snapshot, "第 51 套")).rejects.toThrow("50 套");
    await expect(importSavedBuilds([{ ...first, id: "overflow" }])).rejects.toThrow("50 套");
    expect((await loadSavedBuilds()).map(build => build.id)).toEqual(fifty.map(build => build.id));
    await deleteSavedBuild("build-0");
    expect(await saveCurrentBuild(snapshot, "空出一个位置")).toHaveLength(50);
  });

  it("fails closed on an open error instead of reporting an empty or fallback library", async () => {
    const [build] = await saveCurrentBuild(snapshot, "已有配装");
    const raw = JSON.stringify([build]); window.localStorage.setItem(legacyKey, raw);
    vi.spyOn(window.indexedDB, "open").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    await expect(loadSavedBuilds()).rejects.toThrow("无法读写");
    await expect(saveCurrentBuild(snapshot, "不要切换存储")).rejects.toThrow("无法读写");
    expect(window.localStorage.getItem(legacyKey)).toBe(raw);
  });

  it("does not overwrite unrecognized legacy data during migration", async () => {
    window.localStorage.setItem(legacyKey, '{"old":"unknown"}');
    await expect(saveCurrentBuild(snapshot, "不得覆盖")).rejects.toThrow("保留原数据");
    expect(window.localStorage.getItem(legacyKey)).toBe('{"old":"unknown"}');
  });

  it("uses localStorage only when IndexedDB is genuinely unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await Promise.all([saveCurrentBuild(snapshot, "第一套"), saveCurrentBuild(snapshot, "第二套")]);
    expect(await loadSavedBuilds()).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(legacyKey)!)).toHaveLength(2);
  });

  it("preserves oversized legacy libraries for recovery and allows reducing their size", async () => {
    const [build] = await saveCurrentBuild(snapshot, "旧记录");
    vi.stubGlobal("indexedDB", new IDBFactory());
    window.localStorage.setItem(legacyKey, JSON.stringify(Array.from({ length: 52 }, (_, index) => ({ ...build, id: `old-${index}` }))));
    expect(await loadSavedBuilds()).toHaveLength(52);
    await expect(saveCurrentBuild(snapshot, "不能再增加")).rejects.toThrow("50 套");
    expect(await deleteSavedBuild("old-0")).toHaveLength(51);
    expect(await deleteSavedBuild("old-1")).toHaveLength(50);
  });

  it("merges concurrent imports without replacing newer local versions or losing independent builds", async () => {
    const [build] = await saveCurrentBuild(snapshot, "保留新版");
    await Promise.all([
      importSavedBuilds([{ ...build, title: "旧版不应覆盖", updatedAt: "2020-01-01" }, { ...build, id: "incoming-1" }]),
      importSavedBuilds([{ ...build, id: "incoming-2" }]),
      saveCurrentBuild(snapshot, "同时收藏"),
    ]);
    const result = await loadSavedBuilds();
    expect(result).toHaveLength(4);
    expect(result.find(row => row.id === build.id)?.title).toBe("保留新版");
  });
});
