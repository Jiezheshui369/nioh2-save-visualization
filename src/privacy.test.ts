import { describe, expect, it } from "vitest";
import { createShareSnapshot } from "./privacy";
import type { SaveSnapshot } from "./types";
import demo from '../public/data/demo-snapshot.json';
import { createAssetPackage, isAssetPackage } from './assetPackage';
import type { SavedBuild } from './buildLibrary';

describe("share snapshot privacy", () => {
  it('removes unknown diagnostic properties at each exported layer but preserves all supported evidence', () => {
    const privateField = { privateDiagnostic: 'PRIVATE_AUTO_METADATA' };
    const item = { ...demo.currentLoadout[0], ...privateField, effects: ['Ultimate Constitution'], effectsZh: ['体之深奥'],
      effectIds: ['DAC2'], effectMagnitudes: [null], effectValueDetails: [{ rawValue: 150, kind: 'condition' as const, encoding: 'not-decoded' as const, ...privateField }] };
    const snapshot: SaveSnapshot = {
      ...demo, ...privateField, safety: { ...demo.safety, ...privateField },
      character: { ...demo.character, ...privateField, attributes: { ...demo.character.attributes, ...privateField },
        skillPointCounters: { sword: { temporary: 2, permanent: 3, ...privateField } } },
      currentLoadout: [item], equipmentInventory: [item],
      inventoryItems: [{ recordIndex: 0, id: 'item', name: 'Synthetic Item', type: 'test', quantity: 5, ...privateField }],
      scrolls: [{ recordIndex: 0, id: 'scroll', name: 'Synthetic Scroll', level: 1, rarity: 'test', attemptsRemaining: 2,
        effects: item.effects, effectIds: item.effectIds, effectMagnitudes: item.effectMagnitudes, effectValueDetails: item.effectValueDetails, ...privateField }],
      inventorySummary: { ...demo.inventorySummary, ...privateField },
      characterStatus: { version: 1, source: 'game-screenshots', recordedOn: '2026-09-25', captureTime: null,
        referenceSnapshotId: demo.snapshotId, screenshotCount: 1, ...privateField,
        groups: [{ title: 'Observation', ...privateField, entries: [{ label: '体力', value: '9841/9841', pages: [1], ...privateField }] }], effects: [] },
      backupComparison: { backupLastWriteLocal: demo.sourceLastWriteLocal, level: 1, amrita: 2, gold: 3, attributeChangesToCurrent: {}, ...privateField,
        inventoryQuantityChanges: [{ id: 'item', before: 1, after: 5, delta: 4, ...privateField }] },
    };
    const build: SavedBuild = { schemaVersion: '1.0.0', id: 'build', title: '可分享标题', note: '保留玩家主动填写的备注',
      createdAt: '2026-09-25', updatedAt: '2026-09-25', sourceSnapshotId: snapshot.snapshotId, sourceLastWriteLocal: snapshot.sourceLastWriteLocal,
      level: 99999, attributes: snapshot.character.attributes, equipment: [item], ...privateField };
    const result = createAssetPackage(snapshot, [build]);
    expect(isAssetPackage(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_AUTO_METADATA');
    expect(JSON.stringify(snapshot)).toContain('PRIVATE_AUTO_METADATA');
    expect(result.character.currentLoadout[0].effectValueDetails).toEqual([{ rawValue: 150, kind: 'condition', encoding: 'not-decoded' }]);
    expect(result.character.character.skillPointCounters?.sword).toEqual({ temporary: 2, permanent: 3 });
    expect(result.character.characterStatus?.groups[0].entries[0]).toEqual({ label: '体力', value: '9841/9841', pages: [1] });
    expect(result.builds[0].note).toBe(build.note); expect(result.builds[0].level).toBe(99999);
    result.character.currentLoadout[0].effects![0] = 'changed in output';
    result.builds[0].attributes.heart = -5;
    expect(item.effects[0]).toBe('Ultimate Constitution');
    expect(snapshot.character.attributes.heart).toBe(demo.character.attributes.heart);
  });

  it("redacts fingerprints without mutating the source snapshot", () => {
    const snapshot = {
      ...demo,
      snapshotId: "test",
      safety: { ...demo.safety, originalMainSaveSha256: "original-hash", snapshotCopySha256: "copy-hash" },
    } as SaveSnapshot;

    const shared = createShareSnapshot(snapshot);

    expect(shared.safety.originalMainSaveSha256).toBe("已隐藏");
    expect(shared.safety.snapshotCopySha256).toBeUndefined();
    expect(shared.privacy?.redactedForSharing).toBe(true);
    expect(snapshot.safety.originalMainSaveSha256).toBe("original-hash");
    expect(snapshot.safety.snapshotCopySha256).toBe("copy-hash");
  });
});
