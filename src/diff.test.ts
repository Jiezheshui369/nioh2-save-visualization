import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./diff";
import type { SaveSnapshot } from "./types";

function snapshot(level: number, quantity: number): SaveSnapshot {
  return {
    schemaVersion: "test",
    game: "Nioh 2",
    platform: "Steam/Windows",
    snapshotId: String(level),
    sourceLastWriteLocal: "2026-01-01",
    safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: "x", originalHashUnchangedAfterProcessing: true },
    character: { level, amrita: 10, gold: 20, attributes: { constitution: level, heart: 1, courage: 1, stamina: 1, strength: 1, skill: 1, dexterity: 1, magic: 1 }, proficiency: {} },
    currentLoadout: [],
    inventoryItems: [{ recordIndex: 0, id: "342F", name: "Guardian Spirit Talisman", nameZh: "守护灵呼唤符", type: "Usable Items", quantity }],
    inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 1, scrollRecordsDetected: 0 },
    limitations: [],
  };
}

describe("snapshot diff", () => {
  it("compares resources, attributes and aggregated inventory", () => {
    const result = diffSnapshots(snapshot(20, 7), snapshot(19, 3));
    expect(result.resources[0].delta).toBe(1);
    expect(result.attributes[0]).toMatchObject({ key: "constitution", delta: 1 });
    expect(result.inventory[0]).toMatchObject({ id: "342F", before: 3, after: 7, delta: 4 });
  });

  it("does not invent inventory changes for legacy snapshots without item details", () => {
    const previous = snapshot(19, 3);
    delete previous.inventoryItems;
    const result = diffSnapshots(snapshot(20, 7), previous);
    expect(result.inventoryComparable).toBe(false);
    expect(result.inventory).toEqual([]);
  });
});
