import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';
import { equipmentCategory, equipmentIcon } from './mobileEquipment';
import type { EquipmentItem, SaveSnapshot } from './types';
import { shareText } from './fileSharing';

vi.mock('./SyncPanel', () => ({ MobileReceivePanel: () => <button>扫描电脑二维码</button> }));
vi.mock('./fileSharing', async original => ({ ...await original<typeof import('./fileSharing')>(), shareText: vi.fn(async () => {}) }));
const gear: EquipmentItem = { recordIndex: 1, equipIndex: 1, id: 'test', name: 'Test Fists', nameZh: '测试手甲', type: 'Weapon', rarity: 'Ethereal', level: 190, plus: 120, setOrGrace: "Magatsuhi's Grace", effects: ['a','b','c','d','e'], effectsZh: ['近距离攻击伤害','武技伤害','攻击力','防御力','最后一项效果'], effectMagnitudes: ['+7.0%', '+3.0%', '+10', null, '+9.9%'] };
const snapshot: SaveSnapshot = { schemaVersion: '1.0.0', game: 'Nioh 2', platform: 'Steam', snapshotId: 'ui-test', sourceLastWriteLocal: '2026-09-23', safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: 'hidden', originalHashUnchangedAfterProcessing: true }, character: { level: 600, amrita: 100, gold: 200, attributes: { constitution: 80, heart: 150, courage: 100, stamina: 150, strength: 200, skill: 50, dexterity: 20, magic: 25 }, proficiency: {} }, currentLoadout: [{ ...gear, slot: 'melee1' }], equipmentInventory: [gear], inventoryItems: [{ recordIndex: 2, id: 'item', name: 'Elixir', nameZh: '仙药', type: 'Usable Items', quantity: 12 }], scrolls: [{ recordIndex: 3, id: 'scroll', name: 'Scroll', nameZh: '测试绘卷', level: 750, rarity: 'Ethereal', attemptsRemaining: 4, effects: ['a'], effectsZh: ['绘卷效果'], effectMagnitudes: ['+5.0%'] }], inventorySummary: { equipmentRecords: 1, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 1, scrollRecordsDetected: 1 }, limitations: [] };
const appNode = (data: SaveSnapshot | null = snapshot) => <MobileApp snapshot={data} archiveInfo={null} importing={false} error="" onArchive={async () => true} onBackup={vi.fn()} onExport={vi.fn()} builds={<p>配装册</p>}>{null}</MobileApp>;
const renderApp = (data = snapshot) => render(appNode(data));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('approved mobile design interactions', () => {
  it('does not attach another character receipt or promise optional desktop caching succeeded', () => {
    const info = { schemaVersion: '1.0.0' as const, source: 'computer-sync' as const, importedAt: '2026-09-25', sourceSnapshotId: 'other', sourceLastWriteLocal: '2026-09-25', buildCount: 0 };
    const app = render(<MobileApp {...appNode().props} archiveInfo={info} />);
    expect(screen.queryByText('电脑安全同步')).not.toBeInTheDocument();
    app.rerender(<MobileApp {...appNode().props} desktop={{ tools: null, importPanel: null, notices: null, refreshing: false, newerSave: false, onRefresh: vi.fn() }} />);
    expect(screen.getByText('电脑展示 · 原始存档只读')).toBeVisible();
    expect(screen.queryByText(/离线可用/)).not.toBeInTheDocument();
  });
  it('updates an open loadout detail and its share text when the same snapshot is replaced', () => {
    const app = renderApp(); fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    const updated = { ...snapshot, currentLoadout: [{ ...snapshot.currentLoadout[0], effects: ['new'], effectsZh: ['更新后的词条'], effectMagnitudes: ['+12.3%'] }] };
    app.rerender(appNode(updated));
    expect(screen.getByText('更新后的词条')).toBeVisible();
    expect(screen.queryByText('最后一项效果')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分享装备资料' }));
    expect(shareText).toHaveBeenCalledWith('Nioh 装备详情', expect.stringContaining('更新后的词条 +12.3%'));
  });
  it('closes removed equipment instead of following a reused slot or reopening old selection', () => {
    const app = renderApp(); fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    app.rerender(appNode({ ...snapshot, currentLoadout: [{ ...snapshot.currentLoadout[0], id: 'replacement', nameZh: '另一件武器' }] }));
    expect(screen.queryByRole('button', { name: '分享装备资料' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /另一件武器/ })).toBeVisible();
    app.rerender(appNode(snapshot));
    expect(screen.queryByRole('button', { name: '分享装备资料' })).not.toBeInTheDocument();
  });
  it.each(['another-character', null])('clears detail after switching away (%s) and returning', id => {
    const app = renderApp(); fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    app.rerender(appNode(id === null ? null : { ...snapshot, snapshotId: id }));
    app.rerender(appNode(snapshot));
    expect(screen.queryByRole('button', { name: '分享装备资料' })).not.toBeInTheDocument();
  });
  it('resolves warehouse details from the same current-equipment precedence as the list', () => {
    const app = renderApp(); fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '手甲' } });
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    app.rerender(appNode({ ...snapshot, currentLoadout: [{ ...snapshot.currentLoadout[0], effectMagnitudes: ['+25%', null, null, null, null] }] }));
    expect(screen.getByText('+25%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '‹ 返回列表' }));
    expect(screen.getByRole('searchbox')).toHaveValue('手甲');
  });
  it('updates scroll details and closes them when the scroll is removed', () => {
    const app = renderApp(); fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: /测试绘卷/ }));
    app.rerender(appNode({ ...snapshot, scrolls: [{ ...snapshot.scrolls![0], attemptsRemaining: 2, effectMagnitudes: ['+8%'] }] }));
    expect(screen.getByText(/剩余挑战次数 2/)).toBeVisible();
    expect(screen.getByText('+8%')).toBeVisible();
    app.rerender(appNode({ ...snapshot, scrolls: [] }));
    expect(screen.queryByRole('button', { name: '分享装备资料' })).not.toBeInTheDocument();
    app.rerender(appNode(snapshot));
    expect(screen.queryByRole('button', { name: '分享装备资料' })).not.toBeInTheDocument();
  });
  it('shares all equipment details using the same evidence formatting as desktop', () => {
    renderApp(); fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: '分享当前配装' }));
    expect(shareText).toHaveBeenCalledWith('Nioh 当前配装', expect.stringContaining('最后一项效果 +9.9%'));
    const text = vi.mocked(shareText).mock.calls[0][1];
    expect(text).toContain('防御力 数值未解析'); expect(text).toContain('佩戴绘卷尚未识别');
    expect(text).not.toContain('ui-test'); expect(text).not.toContain('hidden');
  });
  it('shows only base maxima, preserving weight and separate additive effects', () => {
    renderApp({ ...snapshot, characterStatus: { version: 1, source: 'game-screenshots', recordedOn: '2026-09-25', captureTime: null, referenceSnapshotId: snapshot.snapshotId, screenshotCount: 1,
      groups: [{ title: '基础状态', entries: [
        { label: '体力', value: '9841/9841', pages: [1] },
        { label: '精力', value: '1297/1297', pages: [1] },
        { label: '妖力', value: '0.0/17.8', pages: [1] },
        { label: '装备重量', value: '38.0/57.4', pages: [1] },
      ] }], effects: [{ title: '恢复', entries: [{ label: '体力', value: '+964', pages: [1] }, { label: '妖力', value: '+7.8', pages: [1] }] }] } });
    for (const value of ['9841', '1297', '17.8', '+964', '+7.8']) expect(screen.getByText(value)).toBeVisible();
    expect(screen.getAllByText('38.0/57.4')).toHaveLength(2);
    for (const value of ['9841/9841', '1297/1297', '0.0/17.8']) expect(screen.queryByText(value)).not.toBeInTheDocument();
  });
  it('uses four bottom tabs, equal-size attribute classes, and hides sync on character screen', () => {
    const app = renderApp();
    expect(within(screen.getByRole('navigation')).getAllByRole('button').map(b => b.textContent)).toEqual(['角色','配装','仓库','更多']);
    expect(app.container.querySelectorAll('.nm-attribute')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('button', { name: '扫描电脑二维码' })).toBeVisible();
  });
  it('opens all equipment effects, including values after the third, from the loadout', () => {
    renderApp(); fireEvent.click(screen.getByRole('button', { name: '配装' }));
    expect(screen.queryByText('近战1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    expect(screen.getByText('最后一项效果')).toBeVisible(); expect(screen.getByText('+9.9%')).toBeVisible();
    expect(screen.getByText('数值未解析')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '‹ 返回列表' }));
    fireEvent.click(screen.getByRole('button', { name: /装备中的绘卷尚未识别/ }));
    expect(screen.getByText('绘卷 · 1 件')).toBeVisible();
  });
  it('shows a condition instead of a false numeric bonus from a legacy archive', () => {
    const oldItem = { ...snapshot.currentLoadout[0], effects: ['Ultimate Constitution'], effectsZh: ['体之深奥'], effectIds: ['DAC2'], effectMagnitudes: ['150'] };
    renderApp({ ...snapshot, currentLoadout: [oldItem] });
    fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    expect(screen.getByText('条件词条（非数值加成）')).toBeVisible();
    expect(screen.queryByText('150')).not.toBeInTheDocument();
  });
  it('keeps warehouse filters when opening and returning from detail; items have quantities not bonuses', () => {
    renderApp(); fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: '类别：全部' }));
    fireEvent.click(screen.getByRole('button', { name: '手甲' })); fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByText('手甲 · 1 件')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ })); fireEvent.click(screen.getByRole('button', { name: '‹ 返回列表' }));
    expect(screen.getByText('手甲 · 1 件')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } });
    expect(screen.getByText(/没有符合条件的记录/)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '物品' })); expect(screen.getByText('× 12')).toBeVisible();
    expect(screen.queryByText('测试手甲 +120')).not.toBeInTheDocument();
  });
  it('does not apply screenshot attributes from another snapshot', () => {
    renderApp({ ...snapshot, characterStatus: { version: 1, source: 'game-screenshots', recordedOn: '2026-09-23', captureTime: null, referenceSnapshotId: 'other', screenshotCount: 1, groups: [{ title: '旧记录', entries: [{ label: '敏捷', value: 'AA', pages: [1] }] }], effects: [] } });
    expect(screen.queryByText('AA')).not.toBeInTheDocument();
    expect(screen.getAllByText('未解析')).toHaveLength(6);
  });
  it('keeps unidentified weapon types and does not use a specific accessory icon for every accessory', () => {
    expect(equipmentCategory({ ...gear, name: 'Unknown blade', nameZh: null })).toBe('未分类武器');
    expect(equipmentIcon({ ...gear, type: 'Accessory', name: 'Fan', nameZh: '扇子' })).toBeUndefined();
  });
  it('never classifies soul cores or unknown non-weapons as weapons', () => {
    expect(equipmentCategory({ ...gear, type: 'Soul Core', name: 'Sword enemy core' })).toBe('魂核');
    expect(equipmentCategory({ ...gear, type: 'SoulCore' })).toBe('魂核');
    expect(equipmentCategory({ ...gear, type: 'Unknown' })).toBe('其他装备');
    expect(equipmentIcon({ ...gear, type: 'SoulCore' })).toBeUndefined();
  });
});
