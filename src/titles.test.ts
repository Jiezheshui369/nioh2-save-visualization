import { describe, expect, it } from 'vitest';
import demo from '../public/data/demo-snapshot.json';
import catalog from './titleDefinitions.json';
import { isTitles } from './titles';
import { isSupportedSnapshot } from './snapshotValidation';

import { titleFixture } from './test/titleFixture';

describe('titles snapshot contract', () => {
  it('accepts old snapshots without titles and new snapshots with exact IDs', () => {
    expect(isSupportedSnapshot(demo)).toBe(true);
    expect(isTitles(titleFixture([catalog.definitions[0].titleId]))).toBe(true);
    expect(isSupportedSnapshot({ ...demo, titles: titleFixture() })).toBe(true);
    expect(isSupportedSnapshot({ ...demo, game: 'Nioh 3', titles: titleFixture() })).toBe(false);
  });
  it('rejects unsupported versions, game IDs and fabricated current state', () => {
    for (const patch of [{ version: 2 }, { gameId: 'nioh3' }, { definitionVersion: 'unknown' },
      { current: { completed: true, progress: null, visible: null, claimable: null } }]) {
      expect(isTitles({ ...titleFixture(), ...patch })).toBe(false);
    }
  });
  it('rejects duplicate, missing, unknown IDs and mismatched totals', () => {
    for (const mutate of [
      (v: ReturnType<typeof titleFixture>) => { v.entries[1] = v.entries[0]; },
      (v: ReturnType<typeof titleFixture>) => { v.entries.pop(); },
      (v: ReturnType<typeof titleFixture>) => { v.entries[0].titleId = 0xFFFFFFFF; },
      (v: ReturnType<typeof titleFixture>) => { v.summary.awarded = 305; },
      (v: ReturnType<typeof titleFixture>) => { v.summary.groups[0].total = 178; },
    ]) { const value = titleFixture(); mutate(value); expect(isTitles(value)).toBe(false); }
  });
  it('accepts explicit unknown, rejects unknown disguised as zero', () => {
    const value = titleFixture();
    const unknown = { ...value, state: 'unknown', reason: 'unsupported-layout-or-set',
      entries: value.entries.map(e => ({ ...e, savedAwarded: null })),
      summary: { ...value.summary, awarded: null, notAwarded: null, unknown: 390,
        groups: value.summary.groups.map(g => ({ ...g, awarded: null, notAwarded: null, unknown: g.total })) } };
    expect(isTitles(unknown)).toBe(true);
    expect(isTitles({ ...unknown, summary: { ...unknown.summary, awarded: 0 } })).toBe(false);
    expect(isSupportedSnapshot({ ...demo, titles: { ...value, version: 2 } })).toBe(false);
  });
});
