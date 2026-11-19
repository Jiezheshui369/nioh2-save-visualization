import type { SaveSnapshot, LoadoutItem } from './types';
import { matchingResearchStatus } from './researchStatus';
import { effectValueText, hasVerifiedEffectValue } from './effectValues';
import { localizeEffect, localizeItemName } from './localization';
export const desktopEquipmentSlots = [
  ['melee1','近战武器一'],['melee2','近战武器二'],['ranged1','远程武器一'],['ranged2','远程武器二'],
  ['head','头防具'],['torso','胸防具'],['arms','臂防具'],['legs','膝防具'],['feet','腿防具'],
  ['accessory1','饰品一'],['accessory2','饰品二'],['scroll','绘卷'],
] as const;
export function equippedSlots(snapshot: SaveSnapshot | null) {
  return desktopEquipmentSlots.map(([slot, label]) => ({
    slot, label, item: snapshot?.currentLoadout.find(item => item.slot === slot) ?? null,
  }));
}
export function equipmentRecordKey(item: LoadoutItem): string {
  return item.slot + ':' + item.recordIndex + ':' + item.id;
}
export function equipmentName(item: LoadoutItem | null): string {
  return item ? localizeItemName(item.id, item.nameZh) : '—';
}
export function equipmentEffects(item: LoadoutItem) {
  return (item.effects ?? []).map((effect, index) => ({
    label: localizeEffect(effect, item.effectsZh?.[index]),
    value: hasVerifiedEffectValue(item, index) ? effectValueText(item, index) : '—',
    kind: item.effectValueDetails?.[index]?.kind ?? 'unknown',
  }));
}
export function basicDesktopStatus(snapshot: SaveSnapshot) {
  const status = matchingResearchStatus(snapshot);
  return ['体力','精力','精力回复速度','妖力','重量','重量占比','敏捷','坚韧度'].map((label,index) => {
    const patterns = ['体力','精力','精力恢复速度','妖力','装备重量','装备重量占比','敏捷','坚忍度'];
    const row = status?.panel.find(p => p.label === patterns[index]);
    return { label, value: row?.display ?? '—', state: row?.state ?? 'unknown' };
  });
}
export function persistedGuardian(snapshot: SaveSnapshot | null, savedKey: number) {
  return snapshot ? matchingResearchStatus(snapshot)?.guardianSources?.guardians.find(g => g.savedKey === savedKey) : undefined;
}
export function firstPersistedGuardianKey(snapshot: SaveSnapshot | null): number | undefined {
  return snapshot ? matchingResearchStatus(snapshot)?.guardianSources?.guardians[0]?.savedKey : undefined;
}
/** Catalogue names are navigation labels. They never stand in for learned records. */
export const ninjutsuCatalogue = ['手里剑术','散弹苦无术','毒手里剑术','火药弹术','撒菱术','风车手里剑术','烟雾弹术','盲目弹之术'] as const;

/** Never round an unsafe or missing save counter into a displayed value. */
export function desktopIntegerDisplay(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';
}
