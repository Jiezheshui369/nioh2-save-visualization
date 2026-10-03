import { describe, it, expect } from 'vitest';
import { equipment, loadout, scroll, snapshotDetails } from './dataValidation';
import { isSupportedSnapshot } from './api';
import { isAssetPackage, createAssetPackage } from './assetPackage';
import { isSavedBuild } from './buildLibrary';
import demo from '../public/data/demo-snapshot.json';
import type { SaveSnapshot } from './types';

const sample = demo as SaveSnapshot;
const item = sample.currentLoadout[0];
describe('deep archive boundary', () => {
  it.each([
    { game: {} }, { platform: [] }, { parserVersion: 4 }, { researchLabel: {} }, { loadoutSource: [] },
    { privacy: { redactedForSharing: 'true' } }, { safety: { ...sample.safety, snapshotCopySha256: {} } },
    { character: { ...sample.character, proficiency: { sword: [] } } },
    { character: { ...sample.character, proficiency: { sword: Infinity } } },
    { character: { ...sample.character, skillPointCounters: { sword: {} } } },
    { character: { ...sample.character, skillPointCounters: { sword: { permanent: 2, temporary: '3' } } } },
    { inventorySummary: { ...sample.inventorySummary, equipmentByType: { Weapon: {} } } },
    { inventorySummary: { ...sample.inventorySummary, equipmentUnknownIds: NaN } },
    { backupComparison: [] }, { backupComparison: null },
    { backupComparison: { backupLastWriteLocal: '', level: 1, amrita: 2, gold: 3, attributeChangesToCurrent: {}, inventoryQuantityChanges: ['bad'] } },
  ])('rejects malformed auxiliary data before it can enter history or progress screens', changes => {
    expect(isSupportedSnapshot({ ...sample, ...changes })).toBe(false);
  });

  it('does not coerce arrays into effect-kind strings', () => {
    expect(equipment({ ...item, effects: ['Ultimate Constitution'], effectIds: ['DAC2'], effectMagnitudes: [null],
      effectValueDetails: [{ rawValue: 150, kind: ['condition'], encoding: 'not-decoded' }] })).toBe(false);
  });

  it('preserves aligned raw effect evidence through archive export', () => {
    const enhanced = { ...item, effects: ['Ultimate Constitution'], effectIds: ['DAC2'], effectMagnitudes: [null],
      effectValueDetails: [{ rawValue: 150, kind: 'condition', encoding: 'not-decoded' }] };
    expect(equipment(enhanced)).toBe(true);
    const archive = createAssetPackage({ ...sample, currentLoadout: [enhanced] } as SaveSnapshot, []);
    expect(isAssetPackage(JSON.parse(JSON.stringify(archive)))).toBe(true);
    expect(JSON.stringify(archive)).toContain('effectValueDetails');
    for (const bad of [[], [null], [{ rawValue: -1, kind: 'condition', encoding: 'not-decoded' }],
      [{ rawValue: 1.5, kind: 'numeric', encoding: 'verified-id' }],
      [{ rawValue: 0x100000000, kind: 'unknown', encoding: 'not-decoded' }],
      [{ rawValue: 150, kind: 'condition', encoding: 'verified-id' }],
      [{ rawValue: 12, kind: 'numeric', encoding: 'not-decoded' }]]) {
      expect(equipment({ ...enhanced, effectValueDetails: bad })).toBe(false);
    }
    expect(equipment({ ...enhanced, effectIds: [] })).toBe(false);
  });
  it('accepts synthetic legacy data and modded stats without applying gameplay caps', () => {
    expect(isSupportedSnapshot(sample)).toBe(true);
    expect(isSupportedSnapshot({ ...sample, character: { ...sample.character, level: 99999 } })).toBe(true);
    expect(equipment(item)).toBe(true);
  });
  it('round trips sparse grade evidence without treating it as a numeric bonus', () => {
    const enhanced = { ...item, effects: ['Anima Bonus (Confused Enemy)'], effectIds: ['3961'], effectMagnitudes: ['AA'],
      effectValueDetails: [{ rawValue: 13, kind: 'grade', encoding: 'verified-id' } as const] };
    expect(equipment(enhanced)).toBe(true);
    const archive = createAssetPackage({ ...sample, currentLoadout: [enhanced] }, []);
    const restored = JSON.parse(JSON.stringify(archive));
    expect(isAssetPackage(restored)).toBe(true);
    expect(restored.character.currentLoadout[0].effectValueDetails).toEqual(enhanced.effectValueDetails);
    for (const encoding of ['legacy-cap', 'not-decoded']) {
      expect(equipment({ ...enhanced, effectValueDetails: [{ rawValue: 13, kind: 'grade', encoding }] })).toBe(false);
    }
  });
  it.each([null, {}, { ...item, name: {} }, { ...item, plus: Infinity },
    { ...item, effects: [null] }, { ...item, effectsZh: [{}] },
    { ...item, effectMagnitudes: [123] }, { ...item, effectIds: [false] },
    { ...item, slot: {} }])('rejects invalid equipped records %j', value => {
    expect(loadout(value)).toBe(false);
    expect(isSupportedSnapshot({ ...sample, currentLoadout: [value] })).toBe(false);
  });
  it('keeps unknown effect magnitudes nullable, not zero or strings of objects', () => {
    expect(equipment({ ...item, effects: ['one', 'two'], effectMagnitudes: [null, 'A+'] })).toBe(true);
  });
  it('rejects malformed warehouse and scroll arrays before persistence', () => {
    for (const changes of [{ equipmentInventory: [null] }, { inventoryItems: [false] },
      { scrolls: [{ effects: [] }] }, { limitations: [{}] }, { currentLoadoutName: {} },
      { emptyLoadoutSlots: ['bad'] }, { equipmentInventory: Array(10001).fill(item) }]) {
      expect(snapshotDetails({ ...sample, ...changes })).toBe(false);
      expect(isAssetPackage({ ...createAssetPackage(sample, []), character: { ...sample, ...changes } })).toBe(false);
    }
    expect(scroll({ recordIndex: 1, id: 's', name: 'Scroll', level: 1, rarity: 'Divine', attemptsRemaining: 1, effects: [] })).toBe(true);
  });
  it('rejects broken build metadata and unsafe nested equipment', () => {
    const build = { schemaVersion: '1.0.0', id: 'test', title: 'test', note: '',
      createdAt: '2026-09-25', updatedAt: '2026-09-25', sourceSnapshotId: sample.snapshotId,
      sourceLastWriteLocal: sample.sourceLastWriteLocal, level: sample.character.level,
      attributes: sample.character.attributes, equipment: sample.currentLoadout };
    expect(isSavedBuild(build)).toBe(true);
    for (const bad of [{ ...build, updatedAt: undefined }, { ...build, equipment: [null] },
      { ...build, attributes: {} }, { ...build, level: NaN }, { ...build, note: {} }]) expect(isSavedBuild(bad)).toBe(false);
  });
});
