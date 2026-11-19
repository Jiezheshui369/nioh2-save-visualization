/** Desktop-only navigation. No save, account, or gameplay values live here. */
export const desktopMenuEntries = [
  { id: 'equipment', label: '装备' },
  { id: 'warehouse', label: '仓库' },
  { id: 'guardians', label: '守护灵' },
  { id: 'skills', label: '技能' },
  { id: 'equipment-skills', label: '装备技能' },
  { id: 'preparation', label: '战斗准备' },
  { id: 'underworld', label: '奈洛狱' },
  { id: 'settings', label: '设置' },
  { id: 'titles', label: '称号' },
  { id: 'character-details', label: '人物详细信息' },
] as const;
export type DesktopMenuId = typeof desktopMenuEntries[number]['id'];
export type DesktopPage = 'home' | DesktopMenuId;
export interface DesktopLocation { page: DesktopPage; recordKey: string | null }
export interface DesktopNavigation {
  location: DesktopLocation;
  history: readonly DesktopLocation[];
  menuOpen: boolean;
  snapshotId: string | null;
}
export const initialDesktopNavigation: DesktopNavigation = {
  location: { page: 'home', recordKey: null }, history: [], menuOpen: false, snapshotId: null,
};
export type DesktopNavigationAction =
  | { type: 'menu'; open: boolean }
  | { type: 'navigate'; page: DesktopPage }
  | { type: 'detail'; recordKey: string; snapshotId: string }
  | { type: 'back' }
  | { type: 'snapshot'; snapshotId: string | null }
  | { type: 'reset' };
export function desktopNavigation(state: DesktopNavigation, action: DesktopNavigationAction): DesktopNavigation {
  switch (action.type) {
    case 'menu': return { ...state, menuOpen: action.open };
    case 'navigate': {
      const page = action.page === 'settings' ? 'home' : action.page;
      if (page === state.location.page) return { ...state, menuOpen: false };
      return { ...state, menuOpen: false, location: { page, recordKey: null },
        history: page === 'home' ? [] : [...state.history, state.location].slice(-20) };
    }
    case 'detail':
      if (action.snapshotId !== state.snapshotId || !action.recordKey) return state;
      return { ...state, menuOpen: false, location: { ...state.location, recordKey: action.recordKey }, history: state.location.recordKey ? state.history : [...state.history, state.location].slice(-20) };
    case 'back':
      if (state.menuOpen) return { ...state, menuOpen: false };
      return { ...state, location: state.history.at(-1) ?? { page: 'home', recordKey: null }, history: state.history.slice(0, -1) };
    case 'snapshot':
      if (action.snapshotId === state.snapshotId) return state;
      return { ...state, snapshotId: action.snapshotId, menuOpen: false, location: { ...state.location, recordKey: null }, history: [] };
    case 'reset': return { ...initialDesktopNavigation };
  }
}
