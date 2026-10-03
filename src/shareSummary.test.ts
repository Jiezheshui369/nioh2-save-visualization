import { describe, expect, it } from 'vitest';
import { buildShareText, buildSavedBuildShareText, orderedShareEquipment } from './shareSummary';
import type { SaveSnapshot, LoadoutItem } from './types';
import type { SavedBuild } from './buildLibrary';
import fixture from '../public/data/demo-snapshot.json';

const item = { recordIndex: 0, equipIndex: 0, slot: 'melee1', id: 'FA97', name: 'Tsuchigumo Clawed Fists', nameZh: '土蜘蛛众手甲钩',
  type: 'Weapon', level: 190, plus: 120, rarity: 'Ethereal', setOrGrace: 'Grace of Tsukuyomi',
  effects: ['Melee Damage', 'Ultimate Constitution', 'Unknown'], effectsZh: ['近距离攻击伤害', '体之深奥', '未知效果'],
  effectIds: ['test', 'DAC2', 'none'], effectMagnitudes: ['+7.0%', '150', null] } satisfies LoadoutItem;
const sample = { ...fixture, snapshotId: 'private-source-123', safety: { ...fixture.safety, originalMainSaveSha256: 'private-sha' },
  currentLoadoutName: '我的配装', currentLoadout: [item] } as unknown as SaveSnapshot;

describe('shared desktop/mobile build text', () => {
  it('shares a verified grade without substituting a catalog maximum', () => {
    const graded: LoadoutItem = { ...item, effects: ['Synthetic grade'], effectsZh: ['测试档位词条'],
      effectIds: ['3961'], effectMagnitudes: ['AA'],
      effectValueDetails: [{ rawValue: 13, kind: 'grade', encoding: 'verified-id' }] };
    expect(buildShareText({ ...sample, currentLoadout: [graded] })).toContain('测试档位词条 AA');
    const unknown: LoadoutItem = { ...graded, effectValueDetails: [{ rawValue: 12, kind: 'grade', encoding: 'verified-id' }] };
    expect(buildShareText({ ...sample, currentLoadout: [unknown] })).toContain('测试档位词条 档位未解析');
  });
  it('includes detailed values and unresolved/conditional evidence without private metadata', () => {
    const text = buildShareText(sample);
    for (const expected of ['Nioh 2 配装', '等级 190 +120', '月读的恩宠', '近距离攻击伤害 +7.0%',
      '体之深奥 条件词条（非数值加成）', '未知效果 数值未解析', '佩戴绘卷尚未识别', '不推算最终伤害']) expect(text).toContain(expected);
    for (const secret of ['private-source-123', 'private-sha', String(sample.character.gold), String(sample.character.amrita)]) expect(text).not.toContain(secret);
    expect(text).not.toContain('体之深奥 150');
  });
  it('uses a fixed attribute order even if imported object keys are reversed', () => {
    const attributes = Object.fromEntries(Object.entries(sample.character.attributes).reverse()) as SaveSnapshot['character']['attributes'];
    const text = buildShareText({ ...sample, character: { ...sample.character, attributes } });
    expect(text.split('\n')[1]).toBe('能力：体 30 · 心 20 · 勇 30 · 刚 25 · 武 15 · 技 20 · 忍 25 · 咒 35');
  });
  it('sorts a copy, preserving unknown slots at the end and all rows', () => {
    const equipment = [{ ...item, slot: 'extra' }, { ...item, slot: 'feet' }, item];
    expect(orderedShareEquipment(equipment).map(row => row.slot)).toEqual(['melee1', 'feet', 'extra']);
    expect(equipment.map(row => row.slot)).toEqual(['extra', 'feet', 'melee1']);
  });
  it('does not invent equipment for empty saves and keeps intentional build notes', () => {
    expect(buildShareText({ ...sample, currentLoadout: [] })).toContain('尚无已解析的装备槽记录');
    const build = { title: '自定义标题', note: '主动写入的交流备注', level: 1000,
      attributes: sample.character.attributes, equipment: [item], sourceSnapshotId: 'private-source-123' } as SavedBuild;
    expect(buildSavedBuildShareText(build)).toContain('说明：主动写入的交流备注');
    expect(buildSavedBuildShareText(build)).toContain('等级 1000');
    expect(buildSavedBuildShareText(build)).not.toContain('private-source-123');
  });
});
