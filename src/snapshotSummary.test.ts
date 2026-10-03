import { describe, expect, it } from 'vitest';
import { normalizeSnapshotSummary, readableSnapshotIndex, validateSnapshotIndex } from './snapshotSummary';

describe('snapshot index boundary', () => {
  it('normalizes optional nulls from older agents without retaining extra metadata', () => {
    expect(normalizeSnapshotSummary({ snapshotId: 'one', level: 99999, createdAt: null,
      researchLabel: null, parserVersion: null, privatePath: 'not-for-display' }))
      .toEqual({ snapshotId: 'one', level: 99999 });
  });
  it.each([null, {}, [], { snapshotId: '' }, { snapshotId: ' ' }, { snapshotId: 'x'.repeat(161) },
    { snapshotId: 'one', level: {} }, { snapshotId: 'one', level: Infinity },
    { snapshotId: 'one', researchLabel: {} }, { snapshotId: 'one', createdAt: [] },
    { snapshotId: 'one', parserVersion: 7 }])('rejects malformed metadata: %j', value => {
    expect(normalizeSnapshotSummary(value)).toBeNull();
    expect(() => validateSnapshotIndex([value])).toThrow('列表无效');
  });
  it('rejects duplicate, non-array and excessive network indexes', () => {
    for (const value of [null, {}, [{ snapshotId: 'one' }, { snapshotId: 'one' }], Array(10001).fill({ snapshotId: 'one' })]) {
      expect(() => validateSnapshotIndex(value)).toThrow('列表无效');
    }
  });
  it('reads only safe unique cached rows without mutating the original index', () => {
    const value = [{ snapshotId: 'good', level: 2 }, { snapshotId: 'bad', level: {} },
      null, { snapshotId: 'good', level: 3 }, { snapshotId: 'old', createdAt: null }];
    const before = structuredClone(value);
    expect(readableSnapshotIndex(value)).toEqual([{ snapshotId: 'good', level: 2 }, { snapshotId: 'old' }]);
    expect(value).toEqual(before);
  });
});
