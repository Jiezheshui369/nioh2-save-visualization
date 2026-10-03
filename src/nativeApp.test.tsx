import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import App from "./App";
import { createAssetPackage } from "./assetPackage";
import type { SaveSnapshot } from "./types";
import { LocalSync } from "./mobileSync";
import { loadSavedBuilds } from "./buildLibrary";
import type { SavedBuild } from "./buildLibrary";
import { loadCachedSnapshot, saveImportedSnapshot } from "./snapshotCache";
import allPairingCases from "../scripts/ios-tests/pairing-cases.json";
const pairingCases = allPairingCases.filter(item => item.valid);

vi.mock("./runtime", () => ({ isNativeApp: () => true }));
vi.mock("./mobileSync", async (original) => ({ ...await original<typeof import("./mobileSync")>(), LocalSync: { status: vi.fn(), receive: vi.fn(), scan: vi.fn(), forget: vi.fn() } }));

// Synthetic fixture exists only in tests; never included in the app bundle.
const character: SaveSnapshot = {
  schemaVersion: "1.0.0", snapshotId: "native-test", game: "Nioh 2", platform: "Steam/Windows",
  sourceLastWriteLocal: "2026-09-20T00:00:00Z",
  safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: "test", originalHashUnchangedAfterProcessing: true },
  character: { level: 123, amrita: 2, gold: 3, attributes: { constitution: 10, heart: 20, courage: 30, stamina: 40, strength: 50, skill: 60, dexterity: 70, magic: 80 }, proficiency: {} },
  currentLoadout: [], limitations: [],
  characterStatus: { version: 1, source: "game-screenshots", recordedOn: "2026-09-22", captureTime: null, referenceSnapshotId: "native-test", screenshotCount: 1,
    groups: [{ title: "基础状态", entries: [{ label: "测试防御力", value: "777", pages: [1] }] }], effects: [] },
  inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
};

function chooseArchive(container: HTMLElement) {
  const contents = JSON.stringify(createAssetPackage(character, []));
  const file = new File([contents], "test-assets.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => contents });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

beforeEach(() => {
  vi.mocked(LocalSync.status).mockResolvedValue({ paired: false, host: "" });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("must remain offline")));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("native offline archive workflow", () => {
  it('keeps displayed and saved data identical if the receive caller later changes its object', async () => {
    const incoming = createAssetPackage(character, []);
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: incoming, revision: 'e'.repeat(64) });
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'snapshots' && key === 'latest') incoming.character.character.level = 9999;
      return original.call(this, value, key);
    });
    render(<App />);
    await screen.findByRole('button', { name: '扫描电脑二维码' });
    fireEvent.change(screen.getByLabelText('手机配对信息'), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole('button', { name: '确认配对并同步' }));
    expect(await screen.findByText('123')).toBeVisible();
    expect(screen.queryByText('9999')).not.toBeInTheDocument();
    await expect(loadCachedSnapshot({ required: true })).resolves.toMatchObject({ character: { level: 123 } });
  });
  it("recovers a stored character after a temporary startup read failure without resyncing", async () => {
    await saveImportedSnapshot(character, { schemaVersion: "1.0.0", importedAt: "2026-09-25", sourceSnapshotId: character.snapshotId,
      sourceLastWriteLocal: character.sourceLastWriteLocal, buildCount: 0, source: "computer-sync" });
    const open = vi.spyOn(window.indexedDB, "open").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("本机档案读取失败，原数据未删除");
    expect(screen.queryByText("123")).not.toBeInTheDocument();
    open.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "重试读取本机档案" }));
    expect(await screen.findByText("123")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试读取本机档案" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows partial commit honestly and retries the same archive without any file transfer", async () => {
    const build: SavedBuild = {
      schemaVersion: "1.0.0", id: "from-pc", title: "电脑收藏的配装", note: "", createdAt: "2026-09-25", updatedAt: "2026-09-25",
      sourceSnapshotId: character.snapshotId, sourceLastWriteLocal: character.sourceLastWriteLocal,
      level: character.character.level, attributes: character.character.attributes, equipment: [],
    };
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: createAssetPackage(character, [build]), revision: "d".repeat(64) });
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "builds") throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, value, key);
    });
    const app = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("123")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("角色已保存，但配装册合并失败");
    expect(screen.getByRole("alert")).toHaveTextContent("无需传文件");
    expect(screen.getByText("接收尚未全部完成").closest("details")).toHaveAttribute("open");
    put.mockRestore();
    expect(await loadSavedBuilds()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "接收最新角色" }));
    expect(await screen.findByText("电脑分析结果已同步并保存到手机，关闭电脑后仍可查看。")).toBeInTheDocument();
    expect(await loadSavedBuilds()).toEqual([build]);
    app.unmount(); render(<App />);
    expect(await screen.findByText("123")).toBeVisible();
    expect(await loadSavedBuilds()).toEqual([build]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed QR input before calling the native network plugin", async () => {
    vi.mocked(LocalSync.receive).mockClear();
    render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    fireEvent.click(screen.getByText("配对信息 / 手动输入"));
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr + "&host=127.0.0.1" } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("配对信息无效，请重新扫描电脑二维码。")).toBeInTheDocument();
    expect(LocalSync.receive).not.toHaveBeenCalled();
  });
  it("retains an existing character when a structurally valid envelope contains broken equipment", async () => {
    const app = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    chooseArchive(app.container);
    await screen.findByText("123");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const incoming = createAssetPackage(character, []);
    incoming.character.currentLoadout = [null as never];
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: incoming, revision: "b".repeat(64) });
    fireEvent.click(screen.getByText("配对信息 / 手动输入"));
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("电脑返回的档案无效，旧档案未改变。")).toBeInTheDocument();
    app.unmount(); render(<App />);
    expect(await screen.findByText("123")).toBeInTheDocument();
  });
  it("keeps the old character when the sync payload is invalid", async () => {
    const app = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    chooseArchive(app.container);
    await screen.findByText("123");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: { invalid: true }, revision: "b".repeat(64) });
    fireEvent.click(screen.getByText("配对信息 / 手动输入"));
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("电脑返回的档案无效，旧档案未改变。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    expect(screen.getByText("123")).toBeInTheDocument();
  });
  it("does not show a synced character when persistent storage rejects the write", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: createAssetPackage(character, []), revision: "c".repeat(64) });
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("storage full"); } });
    fireEvent.click(screen.getByText("配对信息 / 手动输入"));
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("手机保存失败，旧档案仍保留，请检查存储空间后重试。")).toBeInTheDocument();
    expect(screen.queryByText("123")).not.toBeInTheDocument();
  });
  it("receives from a paired PC without file selection and survives an offline remount", async () => {
    vi.mocked(LocalSync.receive).mockResolvedValue({ archive: createAssetPackage(character, []), revision: "a".repeat(64) });
    const first = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    fireEvent.click(screen.getByText("配对信息 / 手动输入"));
    fireEvent.change(screen.getByLabelText("手机配对信息"), { target: { value: pairingCases[0].qr } });
    fireEvent.click(screen.getByRole("button", { name: "确认配对并同步" }));
    expect(await screen.findByText("电脑安全同步")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
    first.unmount(); render(<App />);
    expect(await screen.findByText("123")).toBeInTheDocument();
    expect(screen.getByText("电脑安全同步")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("imports a desktop package and restores it after remount without a network request", async () => {
    const first = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    fireEvent.click(screen.getByText("高级：从已有备份恢复（可选）"));
    expect(screen.queryByText("123")).not.toBeInTheDocument();
    chooseArchive(first.container);
    expect(await screen.findByText("123")).toBeInTheDocument();
    expect(screen.getByText(/角色档案包已存入这台设备/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "读取存档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手机连接" })).not.toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(await screen.findByText("123")).toBeInTheDocument();
    expect(screen.getByText("截图记录 · 非自动解析")).toBeInTheDocument();
    expect(screen.getByText("777")).toBeInTheDocument();
    expect(screen.getByText(/来源存档时间/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the empty screen and shows a failure if local persistence is unavailable", async () => {
    const first = render(<App />);
    await screen.findByRole("button", { name: "扫描电脑二维码" });
    fireEvent.click(screen.getByText("高级：从已有备份恢复（可选）"));
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("测试：存储空间不足"); } });
    chooseArchive(first.container);
    expect(await screen.findByRole("alert")).toHaveTextContent("导入失败");
    expect(screen.queryByText("123")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入我的档案包" })).toBeEnabled();
  });
});
