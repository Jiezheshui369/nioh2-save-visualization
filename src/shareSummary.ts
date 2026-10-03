import type { AttributeKey, LoadoutItem, SaveSnapshot } from './types';
import type { SavedBuild } from './buildLibrary';
import { localizeItemName, localizeSetOrGrace } from './localization';
import { effectText } from './effectValues';

export const SHARE_ATTRIBUTES: Record<AttributeKey, string> = {
  constitution: '体', heart: '心', courage: '勇', stamina: '刚',
  strength: '武', skill: '技', dexterity: '忍', magic: '咒',
};
export const SHARE_SLOTS: Record<string, string> = {
  melee1: '主武器', melee2: '副武器', ranged1: '远程一', ranged2: '远程二',
  head: '头部', torso: '胸甲', arms: '臂甲', legs: '膝甲', feet: '足甲',
  accessory1: '饰品一', accessory2: '饰品二',
};

export function orderedShareEquipment(items: LoadoutItem[]): LoadoutItem[] {
  const slots = Object.keys(SHARE_SLOTS);
  const rank = (slot: string) => { const index = slots.indexOf(slot); return index < 0 ? slots.length : index; };
  return [...items].sort((a, b) => rank(a.slot) - rank(b.slot));
}

function summary(title: string, level: number, attributes: Record<AttributeKey, number>, equipment: LoadoutItem[], note?: string): string {
  const stats = Object.entries(SHARE_ATTRIBUTES).map(([key, label]) => `${label} ${attributes[key as AttributeKey]}`).join(' · ');
  const rows = orderedShareEquipment(equipment).map(item => {
    const effects = (item.effects ?? []).map((_, index) => `  ${effectText(item, index)}`);
    return [`${SHARE_SLOTS[item.slot] ?? '未知部位'}｜${localizeItemName(item.id, item.nameZh)}｜等级 ${item.level} +${item.plus}｜${localizeSetOrGrace(item.setOrGrace)}`,
      ...(effects.length ? effects : ['  尚无已解析词条'])].join('\n');
  });
  return [`Nioh 2 配装｜${title}｜等级 ${level}`, ...(note ? [`说明：${note}`] : []), `能力：${stats}`, '',
    ...(rows.length ? rows : ['尚无已解析的装备槽记录。']), '',
    '佩戴绘卷尚未识别；仓库绘卷不代表已装备。',
    '仅展示记录中的装备词条，不推算最终伤害或套装触发档位。',
    '由 Nioh 存档伴侣在设备本地生成。'].join('\n');
}

// Explicit display projection: no automatic snapshot ID, fingerprint, paths, currency or inventory.
// Player-authored title/note remain intentional shared content, not anonymized text.
export function buildShareText(snapshot: SaveSnapshot): string {
  return summary(snapshot.currentLoadoutName || '当前配装', snapshot.character.level,
    snapshot.character.attributes, snapshot.currentLoadout);
}

export function buildSavedBuildShareText(build: SavedBuild): string {
  return summary(build.title, build.level, build.attributes, build.equipment, build.note);
}
