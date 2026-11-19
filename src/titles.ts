import catalog from './titleDefinitions.json';
import textIndex from './titleTextIndex.json';
import iconIndex from './titleIconIndex.json';

export type TitleCategory = 0 | 1;
export interface TitleEntry { titleId: number; savedAwarded: boolean | null }
export interface TitleCounts { total: number; awarded: number | null; notAwarded: number | null; unknown: number }
export interface Titles {
  version: 1;
  gameId: 'nioh2';
  definitionVersion: 'titles-v225';
  state: 'verified-saved-set' | 'unknown';
  reason: 'unsupported-layout-or-set' | null;
  entries: TitleEntry[];
  summary: TitleCounts & { groups: Array<TitleCounts & { category: TitleCategory }> };
  current: { completed: null; progress: null; visible: null; claimable: null };
}
export const titleDefinitions = catalog.definitions;
const byId = new Map(titleDefinitions.map(d => [d.titleId, d]));
const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** Count checks are recomputed by exact ID, never trusted from a cached total. */
export function isTitles(value: unknown): value is Titles {
  if (!rec(value) || !exact(value, ['version','gameId','definitionVersion','state','reason','entries','summary','current'])
    || value.version !== 1 || value.gameId !== 'nioh2' || value.definitionVersion !== catalog.version
    || !['verified-saved-set','unknown'].includes(String(value.state))) return false;
  const known = value.state === 'verified-saved-set';
  if (value.reason !== (known ? null : 'unsupported-layout-or-set') || !rec(value.current)
    || !exact(value.current, ['completed','progress','visible','claimable'])
    || !Object.values(value.current).every(v => v === null)) return false;
  if (!Array.isArray(value.entries) || value.entries.length !== titleDefinitions.length) return false;
  const seen = new Set<number>(), counts = [0, 0];
  for (const e of value.entries) {
    if (!rec(e) || !exact(e, ['titleId','savedAwarded']) || typeof e.titleId !== 'number' || seen.has(e.titleId)) return false;
    const definition = byId.get(e.titleId);
    if (!definition || (known ? typeof e.savedAwarded !== 'boolean' : e.savedAwarded !== null)) return false;
    seen.add(e.titleId);
    if (e.savedAwarded === true) counts[definition.category]++;
  }
  const checkCounts = (v: Record<string, unknown>, total: number, awarded: number) => v.total === total
    && v.awarded === (known ? awarded : null) && v.notAwarded === (known ? total-awarded : null)
    && v.unknown === (known ? 0 : total);
  const summary = value.summary;
  if (!rec(summary) || !exact(summary, ['total','awarded','notAwarded','unknown','groups'])
    || !checkCounts(summary, titleDefinitions.length, counts[0]+counts[1])
    || !Array.isArray(summary.groups) || summary.groups.length !== 2) return false;
  const groups = new Set<number>();
  for (const group of summary.groups) {
    if (!rec(group) || !exact(group, ['category','total','awarded','notAwarded','unknown'])
      || (group.category !== 0 && group.category !== 1) || groups.has(group.category)) return false;
    groups.add(group.category);
    if (!checkCounts(group, titleDefinitions.filter(d => d.category === group.category).length, counts[group.category])) return false;
  }
  return true;
}

/** Independent local text/icon indexes. Missing translations fall back to verified Chinese. */
export function titleText(titleId: number, locale: 'zh-CN' | 'en' = 'zh-CN'): { name: string; condition: string } {
  const key = byId.get(titleId)?.textKey;
  const local = textIndex.locales[locale] as Record<string, {name: string; condition: string}>;
  const chinese = textIndex.locales['zh-CN'] as Record<string, {name: string; condition: string}>;
  return (key && (local[key] ?? chinese[key])) || { name: `称号 0x${titleId.toString(16).padStart(8,'0').toUpperCase()}`, condition: '条件未知' };
}
export function titleIcon(titleId: number): string | null {
  const id = byId.get(titleId)?.iconId;
  return id ? (iconIndex.icons as Record<string, string>)[id] ?? null : null;
}
