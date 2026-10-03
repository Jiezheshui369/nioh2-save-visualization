import { describe, expect, it } from "vitest";
import { createResearchDiff } from "./researchExport";
import type { SaveSnapshot } from "./types";

function snapshot(id: string, level: number, hash: string): SaveSnapshot {
  return {
    schemaVersion: "test",
    game: "Nioh 2",
    platform: "Steam/Windows",
    snapshotId: id,
    sourceLastWriteLocal: "2026-01-01",
    safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: hash, originalHashUnchangedAfterProcessing: true },
    character: { level, amrita: 1, gold: 2, attributes: { constitution: 1, heart: 1, courage: 1, stamina: 1, strength: 1, skill: 1, dexterity: 1, magic: 1 }, proficiency: {} },
    currentLoadout: [],
    inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
    limitations: [],
  };
}

describe("createResearchDiff", () => {
  it("exports structured changes without save hashes", () => {
    const report = createResearchDiff(snapshot("after", 2, "PRIVATE-AFTER"), snapshot("before", 1, "PRIVATE-BEFORE"));
    const raw = JSON.stringify(report);
    expect(report.diff.resources.find((item) => item.key === "level")?.delta).toBe(1);
    expect(report.safety).toEqual({ containsRawSave: false, sourceHashesIncluded: false });
    expect(raw).not.toContain("PRIVATE-AFTER");
    expect(raw).not.toContain("PRIVATE-BEFORE");
  });
});
