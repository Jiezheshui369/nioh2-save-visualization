// Synthetic UI fixture only. No game archive, personal save or screenshot is read.
export function createPrivateMobileFixture() {
  const gear = (index, nameZh, type, category) => ({
    recordIndex: index, equipIndex: index, id: 'synthetic-gear-' + index,
    name: category, nameZh, type, rarity: index === 9 ? 'Unknown' : 'Ethereal',
    level: 190 - index, plus: index === 9 ? 0 : 120, setOrGrace: index % 2 ? "Tsukuyomi's Grace" : "Magatsuhi's Grace",
    effects: ['Melee Damage', 'Melee Ki Damage', 'Unresolved synthetic effect'],
    effectsZh: ['近距离攻击伤害', '近距离攻击精力伤害', '示例未解析词条'],
    effectMagnitudes: ['+7.0%', '+9.8%', null],
  });
  const equipment = [
    gear(0, '示例手甲', 'Weapon', 'Fists'), gear(1, '示例大太刀', 'Weapon', 'Odachi'),
    gear(2, '示例弓', 'Weapon', 'Bow'), gear(3, '示例火枪', 'Weapon', 'Rifle'),
    gear(4, '示例大炮', 'Weapon', 'Cannon'), gear(5, '示例头盔', 'Armor - Head Armor', ''),
    gear(6, '示例胸甲', 'Armor - Torso Armor', ''), gear(7, '示例臂甲', 'Armor - Arm Guards', ''),
    gear(8, '示例腿甲', 'Armor - Leg Guards', ''), gear(9, '名称未识别的武器', 'Weapon', 'Unknown blade'),
    gear(10, '示例足甲', 'Armor - Foot Guards', ''),
  ];
  const slots = ['melee1', 'melee2', 'ranged1', 'ranged2', 'head', 'torso', 'arms', 'legs', 'feet'];
  const equipped = [equipment[0], equipment[1], equipment[2], equipment[3], equipment[5], equipment[6], equipment[7], equipment[8], equipment[10]];
  const snapshotId = 'synthetic-mobile-visual-demo';
  return {
    schemaVersion: '1.0.0', parserVersion: 'synthetic-ui-fixture', game: 'Nioh 2', platform: 'Steam',
    snapshotId, researchLabel: '手机界面合成示例', sourceLastWriteLocal: '2026-10-11T00:00:00Z',
    safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: 'synthetic-only', originalHashUnchangedAfterProcessing: true },
    character: { level: 689, amrita: 995398543, gold: 17454970,
      attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 }, proficiency: {} },
    currentLoadoutName: '当前配装 · 合成示例', loadoutSource: 'synthetic-ui-fixture',
    currentLoadout: equipped.map((item, index) => ({ ...item, slot: slots[index] })),
    equipmentInventory: equipment,
    inventoryItems: [
      ['仙药', 'Usable Items', 12], ['灵石', 'Smithing Materials', 48], ['神曲', 'Usable Items', 6],
      ['御神水', 'Usable Items', 9], ['招灵蜡烛', 'Key Items', 3], ['岁杀神之酒', 'Usable Items', 5],
    ].map(([nameZh, type, quantity], recordIndex) => ({ recordIndex, id: 'synthetic-item-' + recordIndex, name: nameZh, nameZh, type, quantity })),
    scrolls: [{ recordIndex: 0, id: 'synthetic-scroll', name: 'Scroll', nameZh: '示例绘卷', level: 750, rarity: 'Unknown', attemptsRemaining: 4,
      effects: ['Melee Damage', 'Ultimate Magic', 'Unresolved synthetic effect'], effectsZh: ['近距离攻击伤害', '咒之深奥', '尚未解析的示例词条'], effectMagnitudes: ['+7.0%', null, null] }],
    characterStatus: {
      version: 1, source: 'game-screenshots', recordedOn: '2026-10-11', captureTime: null, referenceSnapshotId: snapshotId, screenshotCount: 1,
      groups: [{ title: '基础状态 · 合成观察示例', entries: [
        { label: '体力', value: '9841/9841', pages: [1] }, { label: '精力', value: '1297/1297', pages: [1] },
        { label: '妖力', value: '0.0/17.8', pages: [1] }, { label: '装备重量', value: '38.0/57.4', pages: [1] },
        { label: '装备重量占比', value: '66.2%', pages: [1] }, { label: '敏捷', value: 'B', pages: [1] }, { label: '坚忍度', value: '198（B）', pages: [1] },
      ] }],
      effects: [{ title: '掉落 · 合成观察示例', entries: [
        { label: '妖怪化持续时间', value: '+7.0%', pages: [1] }, { label: '装备品掉落率', value: '+13.8%', pages: [1] }, { label: '道具掉落率', value: '+10.0%', pages: [1] },
      ] }],
    },
    inventorySummary: { equipmentRecords: equipment.length, equipmentUnknownIds: 1, equipmentByType: {}, stackedItemRecords: 6, scrollRecordsDetected: 1 },
    limitations: ['全体数值均为合成界面示例，未读取游戏存档。', '未解析值不代表零；没有绘卷佩戴关系。'],
  };
}
