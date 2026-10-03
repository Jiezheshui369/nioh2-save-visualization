import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterStatusPanel } from "./CharacterStatusPanel";
import { deduplicateEntries, formatPanelValue, isCharacterStatus } from "./characterStatus";
import type { CharacterStatus } from "./characterStatus";
import { createAssetPackage, isAssetPackage } from "./assetPackage";
import { isSupportedSnapshot } from "./api";
import type { SaveSnapshot } from "./types";

const status: CharacterStatus = {
  version: 1, source: "game-screenshots", recordedOn: "2026-09-22", captureTime: null,
  referenceSnapshotId: "test-panel", screenshotCount: 2,
  groups: [{ title: "基础状态", entries: [{ label: "敏捷", value: "A", pages: [1] }] }],
  effects: [{ title: "恢复", entries: [
    { label: "体力", value: "+100", pages: [1] },
    { label: "体力", value: "+10.0%", pages: [2] },
  ] }, { title: "其他", entries: [{ label: "自动瞄准要害", value: null, pages: [2] }] }],
};
const snapshot: SaveSnapshot = {
  schemaVersion: "1.0.0", snapshotId: "test-panel", game: "Nioh 2", platform: "Steam/Windows",
  sourceLastWriteLocal: "2026-09-20T00:00:00Z",
  safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: "private", originalHashUnchangedAfterProcessing: true },
  character: { level: 123, amrita: 2, gold: 3, attributes: { constitution: 10, heart: 20, courage: 30, stamina: 40, strength: 50, skill: 60, dexterity: 70, magic: 80 }, proficiency: {} },
  currentLoadout: [], limitations: [], characterStatus: status,
  inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
};
afterEach(cleanup);

describe("screenshot panel observations", () => {
  it.each([
    ["体力", "9841/9841", "9841"],
    ["精力", "1297 / 1297", "1297"],
    ["妖力", "0.0/17.8", "17.8"],
    ["妖力", "0/0", "0"],
    ["体力", "9841", "9841"],
    ["体力", "+964", "+964"],
    ["体力", "+30.0%", "+30.0%"],
    ["体力", null, null],
    ["体力", "未知/9841", "未知/9841"],
    ["体力", "1/2/3", "1/2/3"],
    ["装备重量", "38.0/57.4", "38.0/57.4"],
    ["妖力加成", "1/2", "1/2"],
  ])("formats only valid base-panel maxima: %s %s", (label, value, expected) => {
    const entry = { label: label!, value, pages: [1] };
    expect(formatPanelValue(entry)).toBe(expected);
    expect(entry.value).toBe(value);
  });
  it("renders maxima without changing special effects, weight or exported evidence", () => {
    const observed: CharacterStatus = { ...status, groups: [{ title: "基础状态", entries: [
      { label: "体力", value: "9841/9841", pages: [1] },
      { label: "精力", value: "1297/1297", pages: [1] },
      { label: "妖力", value: "0.0/17.8", pages: [1] },
      { label: "装备重量", value: "38.0/57.4", pages: [1] },
    ] }] };
    const input = { ...snapshot, characterStatus: observed };
    const before = JSON.stringify(observed);
    render(<CharacterStatusPanel snapshot={input} />);
    for (const value of ["9841", "1297", "17.8", "38.0/57.4", "+100", "+10.0%"])
      expect(screen.getByText(value)).toBeInTheDocument();
    for (const value of ["9841/9841", "1297/1297", "0.0/17.8"])
      expect(screen.queryByText(value)).not.toBeInTheDocument();
    expect(JSON.stringify(observed)).toBe(before);
    expect(createAssetPackage(input, []).character.characterStatus).toEqual(JSON.parse(before));
  });
  it("deduplicates overlapping rows but retains flat and percentage effects and source pages", () => {
    const rows = status.effects[0].entries;
    expect(deduplicateEntries([...rows, { ...rows[0], pages: [2] }])).toEqual([
      { ...rows[0], pages: [1, 2] }, rows[1],
    ]);
    expect(rows[0].pages).toEqual([1]);
  });
  it("round-trips observations without replacing parser values or exposing the source hash", () => {
    const archive = JSON.parse(JSON.stringify(createAssetPackage(snapshot, [])));
    expect(isAssetPackage(archive)).toBe(true);
    expect(archive.character.characterStatus).toEqual(status);
    expect(archive.character.character.amrita).toBe(2);
    expect(archive.character.safety.originalMainSaveSha256).toBe("已隐藏");
  });
  it("rejects malformed, oversized and untrusted provenance extensions", () => {
    expect(isCharacterStatus(status)).toBe(true);
    for (const bad of [
      { ...status, source: "save-parser" },
      { ...status, recordedOn: "unknown" },
      { ...status, groups: [{ title: "a", entries: [{ label: {}, value: "1", pages: [1] }] }] },
      { ...status, effects: [{ title: "a", entries: [{ label: "b", value: Infinity, pages: [1] }] }] },
      { ...status, groups: [{ title: "a", entries: [{ label: "b", value: "1", pages: [3] }] }] },
      { ...status, screenshotCount: 1000 },
    ]) expect(isSupportedSnapshot({ ...snapshot, characterStatus: bad })).toBe(false);
  });
  it("keeps legacy snapshots valid and displays unparsed, not zeros or sample data", () => {
    const legacy = { ...snapshot, characterStatus: undefined };
    expect(isSupportedSnapshot(legacy)).toBe(true);
    render(<CharacterStatusPanel snapshot={legacy} />);
    expect(screen.getAllByText("未解析")).toHaveLength(6);
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
  it("labels provenance and supports text search, category filtering, empty results and flag values", () => {
    render(<CharacterStatusPanel snapshot={snapshot} />);
    expect(screen.getByText("截图记录 · 非自动解析")).toBeInTheDocument();
    expect(screen.getByText(/拍摄时间未提供/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索效果"), { target: { value: "体力" } });
    expect(screen.getByText("+100")).toBeVisible();
    expect(screen.getByText("+10.0%")).toBeVisible();
    fireEvent.change(screen.getByLabelText("效果分类"), { target: { value: "其他" } });
    expect(screen.getByRole("status")).toHaveTextContent("显示 0 条效果");
    fireEvent.change(screen.getByLabelText("搜索效果"), { target: { value: "自动" } });
    expect(screen.getByText("已生效")).toBeVisible();
    expect(screen.queryByText("+100")).not.toBeInTheDocument();
  });
  it("does not display observations attached to another snapshot", () => {
    render(<CharacterStatusPanel snapshot={{ ...snapshot, snapshotId: "other" }} />);
    expect(screen.getByText(/属于另一份档案/)).toBeInTheDocument();
    expect(screen.queryByText("+100")).not.toBeInTheDocument();
  });
  it("drops old screenshot values when a new snapshot without observations is selected", () => {
    const result = render(<CharacterStatusPanel snapshot={snapshot} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    result.rerender(<CharacterStatusPanel snapshot={{ ...snapshot, snapshotId: "new", characterStatus: undefined }} />);
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getAllByText("未解析")).toHaveLength(6);
  });
});
