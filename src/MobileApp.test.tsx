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
  it('uses a neutral mobile identity and keeps the real level on one labelled line', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: '角色资料' })).toBeVisible();
    expect(screen.queryByText('无名武士')).not.toBeInTheDocument();
    expect(document.querySelector('.nm-attribute-heading .nm-level')).toHaveTextContent('等级600');
  });
  it('does not promote an unproven current-loadout title while retaining actual gear, graces and saved data', () => {
    const data = { ...snapshot, currentLoadoutName: '深处 · 妖念手甲', savedEquipmentPresetName: '用户保留的预设名称' };
    const onExport = vi.fn();
    render(<MobileApp {...appNode(data).props} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: '配装' }));
    expect(screen.getByRole('heading', { name: '当前配装' })).toBeVisible();
    expect(screen.queryByText('深处 · 妖念手甲')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /测试手甲/ })).toBeVisible();
    expect(screen.getByText('祸津日的恩宠')).toBeVisible();
    expect(data.currentLoadoutName).toBe('深处 · 妖念手甲');
    expect(data.savedEquipmentPresetName).toBe('用户保留的预设名称');
    fireEvent.click(screen.getByRole('button', { name: '我的配装册' }));
    expect(screen.getByText('配装册')).toBeVisible();
  });
  it('keeps equipment identity and detail navigation when category art fails', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '配装' }));
    const row = screen.getByRole('button', { name: /测试手甲 \+120/ });
    const image = row.querySelector('img');
    if (image) fireEvent.error(image);
    expect(row.querySelector('img')).toBeNull();
    expect(row).toHaveTextContent('手甲');
    fireEvent.click(row);
    expect(screen.getByRole('button', { name: '返回配装' })).toBeVisible();
    expect(screen.getByText('最后一项效果')).toBeVisible();
  });
  it('retains category selection after every optional filter image fails', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: '类别：全部' }));
    const filters = screen.getByRole('region', { name: '筛选装备' });
    for (const image of filters.querySelectorAll('img')) fireEvent.error(image);
    expect(filters.querySelector('img')).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: '手甲' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByRole('button', { name: /测试手甲/ })).toBeVisible();
  });

  it('returns to the warehouse list when its bottom navigation is pressed from filters', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: '类别：全部' }));
    expect(screen.getByRole('region', { name: '筛选装备' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    expect(screen.queryByRole('region', { name: '筛选装备' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索仓库' })).toBeVisible();
    expect(screen.getByRole('main')).toHaveAttribute('aria-label', '仓库内容');
  });
  it('focuses filters and restores the originating control on Escape without applying drafts', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: '稀有度：全部' }));
    expect(screen.getByRole('button', { name: '关闭 ×' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '神宝' }));
    fireEvent.keyDown(screen.getByRole('region', { name: '筛选装备' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: '稀有度：全部' })).toHaveFocus();
  });
  it('moves warehouse tabs with arrow keys and links the selected tab to its panel', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: '装备' }), { key: 'ArrowRight' });
    const selected = screen.getByRole('tab', { name: '物品' });
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', selected.id);
    fireEvent.keyDown(selected, { key: 'Home' });
    expect(screen.getByRole('tab', { name: '装备' })).toHaveFocus();
  });
  it('focuses topbar search and still restores filter focus afterward', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '配装' }));
    fireEvent.click(screen.getByRole('button', { name: '搜索仓库' }));
    expect(screen.getByRole('searchbox', { name: '搜索仓库' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '类别：全部' }));
    fireEvent.keyDown(screen.getByRole('region', { name: '筛选装备' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: '类别：全部' })).toHaveFocus();
  });
  it('keeps the complete uint32 attribute value', () => {
    renderApp({ ...snapshot, character: { ...snapshot.character, attributes: { ...snapshot.character.attributes, constitution: 4294967295 } } });
    expect(document.querySelector('.nm-attribute strong')).toHaveTextContent('4294967295');
  });
  it('keeps all destinations visible before import without inventing a character or failure', () => {
    render(appNode(null));
    expect(screen.getByRole('heading', { name: '本机还没有存档资料' })).toBeVisible();
    expect(screen.getByRole('button', { name: '角色' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更多' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('无名武士')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps source provenance without a mobile top sample banner and retains unknown values', () => {
    renderApp({ ...snapshot, snapshotId: 'synthetic-mobile-test', currentLoadout: [{ ...snapshot.currentLoadout[0], rarity: 'Unmapped' }] });
    expect(screen.queryByText('示例数据 · 非存档读取 / 模拟预览')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('合成预览');
    fireEvent.click(screen.getByRole('button', { name: '配装' }));
    expect(screen.queryByText('示例数据 · 非存档读取 / 模拟预览')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    expect(screen.getByText('未知 · 示例')).toBeVisible();
    expect(screen.getByText('数值未解析')).toBeVisible();
    expect(screen.queryByText('妖念量表积累速度 +30.0%')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回配装' }));
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    expect(screen.getByText('示例库 · 非存档读取')).toBeVisible();
  });
  it('filters unknown equipment explicitly and resets an empty search', () => {
    const unknown = { ...gear, name: 'Unknown blade', nameZh: '无明确类别名称', rarity: 'Unmapped' };
    renderApp({ ...snapshot, currentLoadout: [], equipmentInventory: [unknown], scrolls: [] });
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('button', { name: '类别：全部' }));
    fireEvent.click(screen.getByRole('button', { name: '未分类武器' }));
    fireEvent.click(screen.getByRole('button', { name: '未知' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByText('未分类武器 · 1 件')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } });
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: /无明确类别名称/ })).toBeVisible();
  });
  it('sorts and filters stacked items by their actual quantities and types', () => {
    renderApp({ ...snapshot, inventoryItems: [
      { recordIndex: 0, id: 'one', name: 'One', nameZh: '低数量物品', type: 'Usable Items', quantity: 2 },
      { recordIndex: 1, id: 'two', name: 'Two', nameZh: '高数量材料', type: 'Smithing Materials', quantity: 48 },
    ] });
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    fireEvent.click(screen.getByRole('tab', { name: '物品' }));
    const list = document.querySelector('.nm-warehouse-list')!;
    expect(list.textContent!.indexOf('高数量材料')).toBeLessThan(list.textContent!.indexOf('低数量物品'));
    const select = screen.getByRole('combobox', { name: '物品类别' });
    const option = within(select).getAllByRole('option').find(o => o.textContent === '锻造素材') ?? within(select).getAllByRole('option')[2];
    fireEvent.change(select, { target: { value: (option as HTMLOptionElement).value } });
    expect(screen.getByText('高数量材料')).toBeVisible();
    expect(screen.queryByText('低数量物品')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '排序：数量' }));
    expect(screen.getByRole('button', { name: '排序：名称' })).toBeVisible();
  });
  it('does not attach another character receipt or promise optional desktop caching succeeded', () => {
    const info = { schemaVersion: '1.0.0' as const, source: 'computer-sync' as const, importedAt: '2026-09-25', sourceSnapshotId: 'other', sourceLastWriteLocal: '2026-09-25', buildCount: 0 };
    const app = render(<MobileApp {...appNode().props} archiveInfo={info} />);
    expect(screen.queryByText('电脑安全同步')).not.toBeInTheDocument();
    app.rerender(<MobileApp {...appNode().props} desktop={{ tools: null, importPanel: null, notices: null, refreshing: false, newerSave: false, onRefresh: vi.fn() }} />);
    expect(screen.queryByText('电脑展示 · 原始存档只读')).not.toBeInTheDocument();
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
    expect(screen.getAllByText('38.0/57.4')).toHaveLength(1);
    for (const value of ['9841/9841', '1297/1297', '0.0/17.8']) expect(screen.queryByText(value)).not.toBeInTheDocument();
  });
  it('uses four bottom tabs, equal-size attribute classes, and hides sync on character screen', () => {
    const app = renderApp();
    expect(within(screen.getByRole('navigation')).getAllByRole('button').map(b => b.textContent)).toEqual(['角色','配装','仓库','更多']);
    expect(app.container.querySelectorAll('.nm-attribute')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
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
    expect(screen.getAllByText('未解析')).toHaveLength(153);
  });
  it('keeps unidentified weapon types and does not use a specific accessory icon for every accessory', () => {
    expect(equipmentCategory({ ...gear, name: 'Unknown blade', nameZh: null })).toBe('未分类武器');
    expect(equipmentIcon({ ...gear, type: 'Accessory', name: 'Fan', nameZh: '扇子' })).toBeUndefined();
  });
  it('restores the warehouse scroll position after equipment detail', () => {
    const view = renderApp(); fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    const scroller = view.container.querySelector('.nm-scroll') as HTMLElement;
    scroller.scrollTop = 480;
    fireEvent.click(screen.getByRole('button', { name: /测试手甲 \+120/ }));
    expect(scroller.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '返回仓库' }));
    expect(scroller.scrollTop).toBe(480);
  });
  it('renders a large warehouse in batches and searches records beyond the first batch', () => {
    const inventory = Array.from({ length: 1000 }, (_, i) => ({ ...gear, recordIndex: i + 100, id: 'large-' + i, nameZh: '大仓库装备' + i }));
    const view = renderApp({ ...snapshot, currentLoadout: [], equipmentInventory: inventory, scrolls: [] });
    fireEvent.click(screen.getByRole('button', { name: '仓库' }));
    expect(view.container.querySelectorAll('.nm-warehouse .nm-equipment-row')).toHaveLength(60);
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(view.container.querySelectorAll('.nm-warehouse .nm-equipment-row')).toHaveLength(120);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '大仓库装备999' } });
    expect(view.container.querySelectorAll('.nm-warehouse .nm-equipment-row')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /大仓库装备999/ })).toBeVisible();
  });
  it('never classifies soul cores or unknown non-weapons as weapons', () => {
    expect(equipmentCategory({ ...gear, type: 'Soul Core', name: 'Sword enemy core' })).toBe('魂核');
    expect(equipmentCategory({ ...gear, type: 'SoulCore' })).toBe('魂核');
    expect(equipmentCategory({ ...gear, type: 'Unknown' })).toBe('其他装备');
    expect(equipmentIcon({ ...gear, type: 'SoulCore' })).toBeUndefined();
  });
});
