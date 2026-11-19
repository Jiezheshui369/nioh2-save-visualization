import { describe, expect, it } from 'vitest';
import { desktopMenuEntries, desktopNavigation, initialDesktopNavigation } from './desktopNavigation';
describe('desktop menu and return contract', () => {
  it('keeps the ten authorized menu entries in exact order', () => {
    expect(desktopMenuEntries.map(x => x.label)).toEqual(['装备','仓库','守护灵','技能','装备技能','战斗准备','奈洛狱','设置','称号','人物详细信息']);
    expect(new Set(desktopMenuEntries.map(x => x.id)).size).toBe(10);
  });
  it('dismisses the overlay before changing the underlying return destination', () => {
    let state = desktopNavigation(initialDesktopNavigation, { type: 'navigate', page: 'skills' });
    state = desktopNavigation(state, { type: 'menu', open: true });
    const dismissed = desktopNavigation(state, { type: 'back' });
    expect(dismissed.menuOpen).toBe(false);
    expect(dismissed.location.page).toBe('skills');
    expect(desktopNavigation(dismissed, { type: 'back' }).location.page).toBe('home');
  });
  it('clicking the current module closes the menu without losing its record or return stack', () => {
    let state = desktopNavigation(initialDesktopNavigation, { type: 'snapshot', snapshotId: 'A' });
    state = desktopNavigation(state, { type: 'navigate', page: 'equipment' });
    state = desktopNavigation(state, { type: 'detail', recordKey: 'record', snapshotId: 'A' });
    state = desktopNavigation(state, { type: 'menu', open: true });
    const next = desktopNavigation(state, { type: 'navigate', page: 'equipment' });
    expect(next.menuOpen).toBe(false);
    expect(next.location).toBe(state.location);
    expect(next.history).toBe(state.history);
    expect(desktopNavigation(initialDesktopNavigation, { type: 'navigate', page: 'settings' }).location.page).toBe('home');
  });
  it('returns from an equipment record to its page without carrying stale snapshot identity', () => {
    let state = desktopNavigation(initialDesktopNavigation, { type: 'snapshot', snapshotId: 'A' });
    state = desktopNavigation(state, { type: 'navigate', page: 'equipment' });
    state = desktopNavigation(state, { type: 'detail', recordKey: 'record-1', snapshotId: 'A' });
    expect(state.location.recordKey).toBe('record-1');
    expect(desktopNavigation(state, { type: 'back' }).location).toEqual({ page: 'equipment', recordKey: null });
    const changed = desktopNavigation(state, { type: 'snapshot', snapshotId: 'B' });
    expect(changed.location.recordKey).toBeNull();
    expect(changed.history).toEqual([]);
    expect(desktopNavigation(changed, { type: 'detail', recordKey: 'record-1', snapshotId: 'A' })).toBe(changed);
    expect(desktopNavigation(changed, { type: 'back' }).location.page).toBe('home');
  });

  it('directly switches equipment without stacking multiple detail drawers', () => {
    let state = desktopNavigation(initialDesktopNavigation, { type: 'snapshot', snapshotId: 'A' });
    state = desktopNavigation(state, { type: 'navigate', page: 'equipment' });
    state = desktopNavigation(state, { type: 'detail', recordKey: 'first', snapshotId: 'A' });
    const depth = state.history.length;
    state = desktopNavigation(state, { type: 'detail', recordKey: 'second', snapshotId: 'A' });
    expect(state.location.recordKey).toBe('second');
    expect(state.history).toHaveLength(depth);
    expect(desktopNavigation(state, { type: 'back' }).location).toEqual({ page: 'equipment', recordKey: null });
  });
});
