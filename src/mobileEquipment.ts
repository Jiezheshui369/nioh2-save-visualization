import type { EquipmentItem, ScrollRecord } from './types';
import sword from '../design-assets/nioh2-weapons/sword_logo.png';
import dual from '../design-assets/nioh2-weapons/dual_swords_logo.png';
import spear from '../design-assets/nioh2-weapons/spear_logo.png';
import axe from '../design-assets/nioh2-weapons/axe_logo.png';
import kusa from '../design-assets/nioh2-weapons/kusarigama_logo.png';
import odachi from '../design-assets/nioh2-weapons/odachi_logo.png';
import tonfa from '../design-assets/nioh2-weapons/tonfa_logo.png';
import hatchets from '../design-assets/nioh2-weapons/hatchets_logo.png';
import glaive from '../design-assets/nioh2-weapons/switchglaive.png';
import staff from '../design-assets/nioh2-weapons/splitstaff.png';
import fists from '../design-assets/nioh2-weapons/fists_logo.png';
import bow from '../design-assets/nioh2-weapons/bow_logo.png';
import rifle from '../design-assets/nioh2-weapons/rifle_logo.png';
import head from '../design-assets/nioh2-equipment/head.png';
import body from '../design-assets/nioh2-equipment/body.png';
import arms from '../design-assets/nioh2-equipment/arms.png';
import legs from '../design-assets/nioh2-equipment/legs.png';
import feet from '../design-assets/nioh2-equipment/feet.png';
import magatama from '../design-assets/nioh2-equipment/yasakani-magatama.png';
import omamori from '../design-assets/nioh2-equipment/omamori.png';
import scroll from '../design-assets/nioh2-equipment/demon-parade-scroll.png';

export const CATEGORIES = ['全部', '刀', '双刀', '枪', '斧', '锁镰', '大太刀', '旋棍', '手斧', '薙刀镰', '机关棍', '手甲', '弓', '火枪', '大炮', '防具', '饰品', '魂核', '绘卷', '未分类武器', '其他装备'] as const;
export const CATEGORY_ICONS: Record<string, string> = { 刀: sword, 双刀: dual, 枪: spear, 斧: axe, 锁镰: kusa, 大太刀: odachi, 旋棍: tonfa, 手斧: hatchets, 薙刀镰: glaive, 机关棍: staff, 手甲: fists, 弓: bow, 火枪: rifle, 防具: body, 绘卷: scroll };
export type MobileItem = EquipmentItem | ScrollRecord;
export const isScroll = (item: MobileItem): item is ScrollRecord => 'attemptsRemaining' in item;

// The parser currently supplies only "Weapon". Match explicit category words;
// never silently assign unidentified blades to swords. This is UI classification.
const WEAPONS: Array<[string, RegExp]> = [
  ['双刀', /dual swords|双刀|双太刀/i], ['大太刀', /odachi|大太刀/i],
  ['锁镰', /kusarigama|锁镰/i], ['旋棍', /tonfa|旋棍/i], ['手斧', /hatchets|手斧|双斧/i],
  ['薙刀镰', /switchglaive|薙刀镰/i], ['机关棍', /splitstaff|机关棍|锡杖/i],
  ['手甲', /fists|claws|手甲|腕甲/i], ['弓', /\bbow\b|弓/i], ['火枪', /rifle|musket|火枪|铳/i],
  ['大炮', /cannon|大炮|大筒/i], ['枪', /\bspear\b|长枪/i], ['斧', /\baxe\b|\bhammer\b|斧|大锤/i], ['刀', /\bsword\b|katana|太刀/i],
];
export function equipmentCategory(item: MobileItem): string {
  if (isScroll(item)) return '绘卷';
  if (item.type?.startsWith('Armor')) return '防具';
  if (item.type === 'Accessory') return '饰品';
  if (item.type === 'Soul Core' || item.type === 'SoulCore') return '魂核';
  if (item.type && item.type !== 'Weapon') return '其他装备';
  const name = `${item.name} ${item.nameZh ?? ''}`;
  return WEAPONS.find(([, regex]) => regex.test(name))?.[0] ?? '未分类武器';
}
export function equipmentIcon(item: MobileItem): string | undefined {
  if (isScroll(item)) return scroll;
  const armor: Record<string, string> = { 'Armor - Head Armor': head, 'Armor - Torso Armor': body, 'Armor - Arm Guards': arms, 'Armor - Leg Guards': legs, 'Armor - Foot Guards': feet };
  if (armor[item.type]) return armor[item.type];
  if (item.type === 'Accessory') {
    if (/Yasakani|八尺琼/i.test(`${item.name} ${item.nameZh}`)) return magatama;
    if (/Omamori|护身符/i.test(`${item.name} ${item.nameZh}`)) return omamori;
    return undefined;
  }
  return CATEGORY_ICONS[equipmentCategory(item)];
}
export const mobileRarity = (value: string) => ({ Common: '普通', Uncommon: '名器', Rare: '上等', Exotic: '大名物', Divine: '神器', Ethereal: '神宝' }[value] ?? '未知');
