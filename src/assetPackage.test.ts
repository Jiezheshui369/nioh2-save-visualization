import { describe, expect, it } from "vitest";
import { createAssetPackage, isAssetPackage } from "./assetPackage";
import type { SaveSnapshot } from "./types";
import type { SavedBuild } from "./buildLibrary";

const snapshot: SaveSnapshot = {
  schemaVersion: "1.0.0",
  game: "Nioh 2",
  platform: "Steam/Windows",
  snapshotId: "source-1",
  sourceLastWriteLocal: "2026-09-20T00:00:00Z",
  safety: {
    sourceOpenedReadOnly: true,
    parsedFromCopy: true,
    originalMainSaveSha256: "private-hash",
    originalHashUnchangedAfterProcessing: true,
  },
  character: {
    level: 689,
    amrita: 1,
    gold: 2,
    attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 },
    proficiency: {},
  },
  currentLoadout: [],
  inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 },
  limitations: [],
};

describe("character asset package", () => {
  it('rejects an invalid export timestamp before creating an unusable backup', () => {
    for (const time of ['', 'not-a-time', ' '.repeat(81)]) {
      expect(() => createAssetPackage(snapshot, [], time)).toThrow('档案导出时间无效');
    }
  });
  it("packages a redacted character snapshot for moving to iPhone", () => {
    const archive = createAssetPackage(snapshot, [], "2026-09-20T01:00:00Z");
    expect(archive.format).toBe("nioh2-character-assets");
    expect(archive.character.safety.originalMainSaveSha256).toBe("已隐藏");
    expect(isAssetPackage(archive)).toBe(true);
    expect(snapshot.safety.originalMainSaveSha256).toBe("private-hash");
  });

  it("rejects an unrelated JSON object", () => {
    expect(isAssetPackage({ version: "1.0.0" })).toBe(false);
  });

  it('rejects duplicate build identities before receiving or exporting an archive', () => {
    const build = { schemaVersion: '1.0.0', id: 'same', title: '配装', note: '', createdAt: '2026-09-25', updatedAt: '2026-09-25',
      sourceSnapshotId: snapshot.snapshotId, sourceLastWriteLocal: snapshot.sourceLastWriteLocal, level: 689,
      attributes: snapshot.character.attributes, equipment: [] } as SavedBuild;
    expect(() => createAssetPackage(snapshot, [build, build])).toThrow('未生成不完整档案');
    expect(isAssetPackage({ ...createAssetPackage(snapshot, []), builds: [build, build] })).toBe(false);
    expect(isAssetPackage({ ...createAssetPackage(snapshot, []), exportedAt: 'not-a-time' })).toBe(false);
  });

  it("never silently discards invalid builds while exporting", () => {
    expect(() => createAssetPackage(snapshot, [null as unknown as SavedBuild])).toThrow("未生成不完整档案");
    expect(() => createAssetPackage(snapshot, new Array(51).fill(null))).toThrow("50 套");
  });
});
