import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { EmptyLibrary } from "./App";

vi.mock("./api", () => ({
  cacheRecentSnapshots: () => Promise.resolve(20),
  getLastLoadSource: () => "api",
  loadLatestSnapshot: () => Promise.resolve({
    schemaVersion: "0.1.0",
    game: "Nioh 2",
    platform: "Steam/Windows",
    snapshotId: "test",
    sourceLastWriteLocal: "2026-01-01",
    safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: "abc", originalHashUnchangedAfterProcessing: true },
    character: { level: 689, amrita: 1, gold: 2, attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 }, proficiency: { sword: 1 } },
    currentLoadout: [{ recordIndex: 0, equipIndex: 0, type: "Weapon", slot: "melee1", id: "FA97", name: "Tsuchigumo Clawed Fists", level: 190, plus: 120, rarity: "Ethereal", setOrGrace: "Grace of Tsukuyomi", effects: ["Imbue Corruption", "Unknown effect E580"], effectMagnitudes: ["10", null] }],
    equipmentInventory: [
      { recordIndex: 0, equipIndex: 0, id: "FA97", name: "Tsuchigumo Clawed Fists", type: "Weapon", level: 190, plus: 120, rarity: "Ethereal", setOrGrace: "Grace of Tsukuyomi", effects: ["Imbue Corruption"] },
      { recordIndex: 1, equipIndex: 1, id: "4626", name: "Unknown equipment 4626", type: "Soul Core", level: 190, plus: 0, rarity: "Ethereal", setOrGrace: "Unknown Set", effects: ["Life Recovery (Amrita Absorption)"] },
    ],
    currentLoadoutName: "存档记录的当前装备",
    savedEquipmentPresetName: "战斗准备 1",
    inventoryItems: [
      { recordIndex: 0, id: "342F", name: "Guardian Spirit Talisman", nameZh: "守护灵呼唤符", type: "Usable Items", quantity: 17 },
      { recordIndex: 1, id: "BCCE", name: "Quality Lacquer", nameZh: "良质漆", type: "Smithing Materials", quantity: 109 },
    ],
    scrolls: [{ recordIndex: 0, id: "DEA7", name: "Scroll of the Damned", nameZh: "百鬼夜行绘卷·地狱", level: 190, rarity: "Ethereal", attemptsRemaining: 4, effects: ["Ultimate Skill"], effectsZh: ["技之深奥"] }],
    inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
    backupComparison: { backupLastWriteLocal: "2026-01-01", level: 689, amrita: 1, gold: 2, attributeChangesToCurrent: {}, binaryChangedBytes: 283, binaryChangedRanges: 52, loadoutChanged: false, inventoryChanged: true, inventoryQuantityChanges: [{ id: "0529", nameZh: "神馔米", name: "Divine Rice", before: 2, after: 5, delta: 3 }], copyHashesUnchangedAfterParsing: true },
    limitations: [],
  }),
  importSnapshot: vi.fn(),
  refreshSnapshot: vi.fn(),
  loadSnapshotIndex: () => Promise.resolve([]),
  loadAgentStatus: () => Promise.resolve({ status: "ok", apiVersion: "1.3", writeBackSupported: false, refreshAvailable: true, lanMode: false, source: { configured: true, accountHint: "…1843", saveSlots: ["SAVEDATA00"], latestWriteLocal: "2026-01-02" }, backupCopies: { completeCopies: 4, incompleteCopies: 0, latestCreatedAtUtc: "2026-01-02" }, steamCloud: { detected: true, state: "synchronized", lastRemoteWriteLocal: "2026-01-02", metadataLastWriteLocal: "2026-01-02", sizeMatches: true } }),
  loadSaveSources: () => Promise.resolve([{ id: "source-1", accountHint: "…1843", slot: "SAVEDATA00", latestWriteLocal: "2026-01-01", active: true }]),
  loadPairingStatus: () => Promise.resolve({ enabled: false, urls: [] }),
  loadSnapshot: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const openMore = () => fireEvent.click(screen.getByRole("button", { name: /04 更多/ }));
const openAdvanced = (name: string) => {
  openMore();
  fireEvent.click(screen.getByText("高级工具 · 进度、记录与安全"));
  fireEvent.click(screen.getByRole("button", { name }));
};
describe("desktop companion UI", () => {
  it("keeps the truthful empty-library backup screen", () => {
    const onImport = vi.fn();
    render(<EmptyLibrary onImport={onImport} />);
    expect(screen.getByRole("heading", { name: /这里等待的是/ })).toHaveTextContent("你的存档");
    fireEvent.click(screen.getByRole("button", { name: "导入我的档案包" }));
    expect(onImport).toHaveBeenCalledOnce();
  });
  it("uses the same four destinations and eight attributes as the mobile app", async () => {
    const app = render(<App />);
    expect(await screen.findByText("689")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "电脑主要导航" })).toHaveTextContent("01角色02配装03仓库04更多");
    expect(app.container.querySelectorAll(".nm-attribute")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: "扫描电脑二维码" })).not.toBeInTheDocument();
  });
  it("warns about a newer save without refreshing automatically", async () => {
    render(<App />);
    expect(await screen.findByText("电脑端检测到较新的存档")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取新存档" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "立即读取" })).toBeEnabled();
  });
  it("keeps safety tools under more, not in the main navigation", async () => {
    render(<App />); await screen.findByText("689");
    openAdvanced("安全记录");
    expect(screen.getByText("4 份完整")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "本机存档、当前档案与 Steam 元数据" })).toBeInTheDocument();
    expect(screen.queryByText(/encrypted-snapshots/)).not.toBeInTheDocument();
  });
  it("retains named build saving and sharing", async () => {
    render(<App />); await screen.findByText("689");
    fireEvent.click(screen.getByRole("button", { name: /02 配装/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的配装册" }));
    fireEvent.change(screen.getByRole("textbox", { name: "配装名称" }), { target: { value: "深层大山阴阳" } });
    fireEvent.change(screen.getByRole("textbox", { name: "配装备注" }), { target: { value: "社交展示用" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "收藏当前配装" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "收藏当前配装" }));
    expect(await screen.findByText("已收藏配装")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享配装图片" })).toBeInTheDocument();
  });
  it("opens Chinese equipment details without inventing unknown magnitudes", async () => {
    render(<App />); await screen.findByText("689");
    fireEvent.click(screen.getByRole("button", { name: /02 配装/ }));
    fireEvent.click(screen.getByRole("button", { name: /土蜘蛛众手甲钩/ }));
    expect(screen.getByText("赋予妖属性")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("未识别词条（E580）")).toBeInTheDocument();
    expect(screen.getByText("数值未解析")).toBeInTheDocument();
    expect(screen.queryByText("Ethereal")).not.toBeInTheDocument();
  });
  it("keeps equipment and items together under warehouse with working search", async () => {
    render(<App />); await screen.findByText("689");
    fireEvent.click(screen.getByRole("button", { name: /03 仓库/ }));
    fireEvent.click(screen.getByRole("tab", { name: "物品" }));
    expect(screen.getByText("守护灵呼唤符")).toBeInTheDocument();
    expect(screen.getByText("× 17")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
    expect(screen.getByText(/没有符合条件的记录/)).toBeInTheDocument();
  });
  it("opens scrolls via the loadout without pretending they are worn", async () => {
    render(<App />); await screen.findByText("689");
    fireEvent.click(screen.getByRole("button", { name: /02 配装/ }));
    fireEvent.click(screen.getByRole("button", { name: /装备中的绘卷尚未识别/ }));
    fireEvent.click(screen.getByRole("button", { name: /百鬼夜行绘卷·地狱/ }));
    expect(screen.getByText("技之深奥")).toBeInTheDocument();
    expect(screen.getByText(/剩余挑战次数 4/)).toBeInTheDocument();
    expect(screen.getByText(/不代表已装备/)).toBeInTheDocument();
  });
  it("keeps the PC drop zone and encrypted sync together under more", async () => {
    render(<App />); await screen.findByText("689"); openMore();
    expect(screen.getByRole("button", { name: "选择游戏存档" })).toBeVisible();
    expect(screen.getByRole("button", { name: "开启同步并生成二维码" })).toBeVisible();
    expect(screen.getByText(/只允许“专用网络”/)).toBeInTheDocument();
  });
  it("preserves progress research without promoting it to the home page", async () => {
    render(<App />); await screen.findByText("689"); openAdvanced("旅途进度");
    expect(screen.getByRole("heading", { name: "自动备份自测" })).toBeInTheDocument();
    expect(screen.getByText("神馔米")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取并标记" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "研究快照标签" }), { target: { value: "受控副本" } });
    expect(screen.getByRole("button", { name: "读取并标记" })).toBeEnabled();
  });
});
