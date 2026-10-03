import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheRecentSnapshots, getLastLoadSource, importSnapshot, isSupportedSnapshot, loadAgentStatus, loadLatestSnapshot, loadSaveSources, loadSnapshot, loadSnapshotIndex, refreshSnapshot } from "./api";
import { loadCachedSnapshot, loadCachedSnapshotById, loadCachedSnapshotIndex, saveCachedSnapshot, saveHistorySnapshot } from "./snapshotCache";
import { isNativeApp } from "./runtime";
import demo from "../public/data/demo-snapshot.json";

vi.mock("./runtime", () => ({ isNativeApp: vi.fn(() => false) }));

vi.mock("./snapshotCache", () => ({
  loadCachedSnapshot: vi.fn(),
  loadCachedSnapshotById: vi.fn(),
  loadCachedSnapshotIndex: vi.fn(),
  saveCachedSnapshot: vi.fn(),
  saveHistorySnapshot: vi.fn(),
}));

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.mocked(isNativeApp).mockReturnValue(false);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.mocked(loadCachedSnapshot).mockReset();
  vi.mocked(loadCachedSnapshotById).mockReset();
  vi.mocked(loadCachedSnapshotIndex).mockReset();
  vi.mocked(saveCachedSnapshot).mockReset();
  vi.mocked(saveHistorySnapshot).mockReset();
});

describe("paired API requests", () => {
  it('times out a stalled read and falls back to the existing offline character', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    })));
    vi.mocked(loadCachedSnapshot).mockResolvedValue(demo);
    const task = loadLatestSnapshot();
    await vi.advanceTimersByTimeAsync(20000);
    await expect(task).resolves.toEqual(demo);
    expect(signal.aborted).toBe(true);
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
    expect(getLastLoadSource()).toBe('cache');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors caller cancellation without falling back or caching a late response', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(done => { finish = done; }) }));
    const task = loadLatestSnapshot(controller.signal);
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); finish(demo);
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
    expect(loadCachedSnapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds response body reads as well as the initial connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => Promise.resolve({ ok: true,
      json: () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) })));
    vi.mocked(loadCachedSnapshotIndex).mockResolvedValue([{ snapshotId: 'offline-history' }]);
    const task = loadSnapshotIndex();
    await vi.advanceTimersByTimeAsync(20000);
    await expect(task).resolves.toEqual([{ snapshotId: 'offline-history' }]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    [new TypeError("Failed to fetch"), "无法连接电脑服务"],
    [new DOMException("timeout", "TimeoutError"), "这不代表解析已取消"],
  ])("explains refresh transport errors without changing cached data", async (reason, message) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
    await expect(refreshSnapshot()).rejects.toThrow(message as string);
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/refresh", expect.objectContaining({ signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ 'X-Nioh2-Desktop-Sync': '1' }) }));
  });

  it.each([
    [{ ok: false, status: 503, json: async () => { throw new SyntaxError("html"); } }, "HTTP 503"],
    [{ ok: false, status: 409, json: async () => ({ error: "已有刷新任务" }) }, "已有刷新任务"],
    [{ ok: false, status: 400, json: async () => null }, "刷新失败：400"],
    [{ ok: false, status: 400, json: async () => ({ error: {} }) }, "刷新失败：400"],
  ])("validates refresh error responses", async (response, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(refreshSnapshot()).rejects.toThrow(message as string);
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
  });

  it.each([() => loadLatestSnapshot(), () => loadSnapshot(demo.snapshotId), () => refreshSnapshot()])(
    "waits for the optional cache attempt before releasing a character read", async read => {
      let finish!: () => void;
      vi.mocked(saveCachedSnapshot).mockReturnValue(new Promise<void>(done => { finish = done; }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => demo }));
      let settled = false;
      const task = read().then(value => { settled = true; return value; });
      for (let index = 0; index < 8; index++) await Promise.resolve();
      expect(saveCachedSnapshot).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
      finish(); await expect(task).resolves.toEqual(demo);
    });

  it("loads native archives locally and never requests the PC agent", async () => {
    vi.mocked(isNativeApp).mockReturnValue(true);
    const cached = { schemaVersion: "test", snapshotId: "native", character: { level: 200 } };
    vi.mocked(loadCachedSnapshot).mockResolvedValue(cached as never);
    vi.mocked(loadCachedSnapshotById).mockResolvedValue(cached as never);
    vi.mocked(loadCachedSnapshotIndex).mockResolvedValue([{ snapshotId: "native" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadLatestSnapshot()).resolves.toEqual(cached);
    await expect(loadSnapshot("native")).resolves.toEqual(cached);
    await expect(loadSnapshotIndex()).resolves.toHaveLength(1);
    await expect(loadAgentStatus()).rejects.toThrow("本机档案");
    await expect(loadSaveSources()).rejects.toThrow("本机档案");
    await expect(refreshSnapshot()).rejects.toThrow("电脑读取存档并发布");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getLastLoadSource()).toBe("cache");
  });

  it("starts native mode empty without contacting a server", async () => {
    vi.mocked(isNativeApp).mockReturnValue(true);
    vi.mocked(loadCachedSnapshot).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadLatestSnapshot()).resolves.toBeNull();
    expect(getLastLoadSource()).toBe("empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("moves a fragment token into the request header and removes it from the address bar", async () => {
    window.location.hash = "pair=temporary-secret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...demo, snapshotId: "test" }) });
    vi.stubGlobal("fetch", fetchMock);

    await loadSnapshot("test");

    expect(window.location.hash).toBe("");
    expect(window.localStorage.getItem("nioh2-pairing-token")).toBe("temporary-secret");
    expect(fetchMock).toHaveBeenCalledWith("/api/snapshots/test", expect.objectContaining({ headers: { "X-Nioh2-Token": "temporary-secret" } }));
  });

  it("does not replace an authorization failure with demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "需要有效的手机配对口令。" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadLatestSnapshot()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the latest local structured snapshot when the agent is offline", async () => {
    const cached = { schemaVersion: "test", snapshotId: "cached", character: { level: 321 } };
    vi.mocked(loadCachedSnapshot).mockResolvedValue(cached as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(loadLatestSnapshot()).resolves.toMatchObject({ snapshotId: "cached" });
    expect(getLastLoadSource()).toBe("cache");
  });

  it("returns an empty library instead of synthetic character data on first mobile launch", async () => {
    vi.mocked(loadCachedSnapshot).mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(loadLatestSnapshot()).resolves.toBeNull();
    expect(getLastLoadSource()).toBe("empty");
  });

  it("uses cached history and cached snapshot details when the agent is offline", async () => {
    const summary = { snapshotId: "cached-history", level: 750 };
    const snapshot = { schemaVersion: "test", snapshotId: "cached-history", character: { level: 750 } };
    vi.mocked(loadCachedSnapshotIndex).mockResolvedValue([summary]);
    vi.mocked(loadCachedSnapshotById).mockResolvedValue(snapshot as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(loadSnapshotIndex()).resolves.toEqual([summary]);
    await expect(loadSnapshot("cached-history")).resolves.toMatchObject({ snapshotId: "cached-history" });
    expect(getLastLoadSource()).toBe("cache");
  });

  it("does not bypass pairing authorization with cached history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "需要有效的手机配对口令。" }) }));
    await expect(loadSnapshotIndex()).rejects.toMatchObject({ status: 401 });
    await expect(loadSnapshot("private")).rejects.toMatchObject({ status: 401 });
    expect(loadCachedSnapshotIndex).not.toHaveBeenCalled();
    expect(loadCachedSnapshotById).not.toHaveBeenCalled();
  });

  it("downloads at most 20 recent structured snapshots for offline browsing", async () => {
    const summaries = Array.from({ length: 22 }, (_, index) => ({ snapshotId: `snapshot-${index}` }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => summaries })
      .mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ ...demo, snapshotId: url.split("/").at(-1) }),
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cacheRecentSnapshots(99)).resolves.toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(saveHistorySnapshot).toHaveBeenCalledTimes(20);
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
  });

  it("does not count failed explicit history persistence as successful downloads", async () => {
    const summaries = [{ snapshotId: 'one' }, { snapshotId: 'two' }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => summaries })
      .mockResolvedValue({ ok: true, json: async () => ({ ...demo, snapshotId: 'one' }) }));
    vi.mocked(saveHistorySnapshot).mockRejectedValueOnce(new Error("storage full"));
    await expect(cacheRecentSnapshots()).rejects.toThrow("storage full");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(saveHistorySnapshot).toHaveBeenCalledOnce();
  });

  it.each([{}, [null], [{ snapshotId: 'bad', researchLabel: {} }], [{ snapshotId: 'one' }, { snapshotId: 'one' }]])(
    'falls back to cached history but refuses explicit downloads for a malformed index', async value => {
      vi.mocked(loadCachedSnapshotIndex).mockResolvedValue([{ snapshotId: 'cached' }]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => value }));
      await expect(loadSnapshotIndex()).resolves.toEqual([{ snapshotId: 'cached' }]);
      await expect(cacheRecentSnapshots()).rejects.toThrow('列表无效');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(saveHistorySnapshot).not.toHaveBeenCalled();
    });

  it('never caches an archive with a different ID from the requested history entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => demo }));
    vi.mocked(loadCachedSnapshotById).mockResolvedValue(null);
    await expect(loadSnapshot('different')).rejects.toThrow('不一致');
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [{ snapshotId: 'different' }] })
      .mockResolvedValue({ ok: true, json: async () => demo }));
    await expect(cacheRecentSnapshots()).rejects.toThrow('不一致');
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it("does not interpret a native storage failure as an empty account", async () => {
    vi.mocked(isNativeApp).mockReturnValue(true);
    vi.mocked(loadCachedSnapshot).mockRejectedValue(new Error("本机档案读取失败"));
    vi.stubGlobal("fetch", vi.fn());
    await expect(loadLatestSnapshot()).rejects.toThrow("本机档案读取失败");
    expect(loadCachedSnapshot).toHaveBeenCalledWith({ required: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads privacy-safe agent source status", async () => {
    const payload = { status: "ok", writeBackSupported: false, refreshAvailable: true, lanMode: false, source: { configured: true, accountHint: "…1843", saveSlots: ["SAVEDATA00"], latestWriteLocal: "2026-09-18T10:00:00+10:00" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload }));

    await expect(loadAgentStatus()).resolves.toEqual(payload);
  });

  it("loads privacy-safe selectable save slots", async () => {
    const payload = [{ id: "source-1", accountHint: "…1843", slot: "SAVEDATA00", latestWriteLocal: null, active: true }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload }));
    await expect(loadSaveSources()).resolves.toEqual(payload);
  });

  it("sends a trimmed controlled-research label without source data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...demo, snapshotId: "labeled" }) });
    vi.stubGlobal("fetch", fetchMock);
    await refreshSnapshot(undefined, "  拾取木灵前  ");
    expect(fetchMock).toHaveBeenCalledWith("/api/refresh", expect.objectContaining({ body: JSON.stringify({ label: "拾取木灵前" }) }));
  });

  it("rejects oversized or structurally invalid imported snapshots", async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.json", { type: "application/json" });
    await expect(importSnapshot(oversized)).rejects.toThrow("超过 5 MB");
    const invalid = { size: 42, text: async () => JSON.stringify({ schemaVersion: "1", character: {} }) } as File;
    await expect(importSnapshot(invalid)).rejects.toThrow("不是受支持");
  });

  it("rejects snapshots whose nested character or safety fields cannot be rendered safely", () => {
    expect(isSupportedSnapshot({
      schemaVersion: "1", snapshotId: "looks-valid", sourceLastWriteLocal: "2026-09-19T00:00:00Z",
      character: { level: "689", amrita: 1, gold: 1, attributes: {}, proficiency: {} },
      currentLoadout: [], limitations: [], inventorySummary: {},
      safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalHashUnchangedAfterProcessing: true, originalMainSaveSha256: "x" },
    })).toBe(false);
  });

  it("rejects a malformed live response and keeps a previously saved character", async () => {
    vi.mocked(loadCachedSnapshot).mockResolvedValue(demo);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...demo, currentLoadout: [null] }) }));
    await expect(loadLatestSnapshot()).resolves.toEqual(demo);
    expect(saveCachedSnapshot).not.toHaveBeenCalled();
    expect(getLastLoadSource()).toBe("cache");
    await expect(refreshSnapshot()).rejects.toThrow("刷新结果无效");
  });
});
