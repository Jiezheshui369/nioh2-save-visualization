import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AttributeKey, DeviceArchiveInfo, SaveSnapshot } from './types';
import type { CharacterAssetPackage } from './assetPackage';
import { MobileReceivePanel } from './SyncPanel';
import type { ArchiveReceipt } from './SyncPanel';
import { localizeEffect, localizeItemName, localizeItemType, localizeSetOrGrace } from './localization';
import { deduplicateEntries, formatPanelValue, isCharacterStatus } from './characterStatus';
import { useShareTextAction } from './useShareTextAction';
import { buildShareText } from './shareSummary';
import { effectText, effectValueText } from './effectValues';
import { CATEGORIES, CATEGORY_ICONS, equipmentCategory, equipmentIcon, isScroll, mobileRarity } from './mobileEquipment';
import type { MobileItem } from './mobileEquipment';
import menuIcon from './assets/figma/menu.svg';
import searchIcon from './assets/figma/search.svg';
import bellIcon from './assets/figma/bell.svg';
import trophyIcon from './assets/figma/trophy.svg';
import walletIcon from './assets/figma/wallet.svg';
import packageInfo from '../package.json';
import './mobile.css';

const ATTRIBUTES: Record<AttributeKey, string> = { constitution: '体', heart: '心', courage: '勇', stamina: '刚', strength: '武', skill: '技', dexterity: '忍', magic: '咒' };
const SLOTS = ['melee1', 'melee2', 'ranged1', 'ranged2', 'head', 'torso', 'arms', 'legs', 'feet', 'accessory1', 'accessory2'];
const number = (v: number) => v.toLocaleString('zh-CN');
const nameOf = (item: MobileItem) => localizeItemName(item.id, item.nameZh);
const itemKey = (item: MobileItem) => `${isScroll(item) ? 'scroll' : 'equipment'}:${item.recordIndex}:${item.id}`;

type ItemSelection = { snapshotId: string; key: string; slot: string | null };
function selectedItem(snapshot: SaveSnapshot | null, selection: ItemSelection | null): MobileItem | null {
  if (!snapshot || selection?.snapshotId !== snapshot.snapshotId) return null;
  if (selection.slot !== null) {
    return snapshot.currentLoadout.find(item => item.slot === selection.slot && itemKey(item) === selection.key) ?? null;
  }
  // Match the warehouse's precedence: current equipment supersedes its inventory copy.
  const candidates = [...(snapshot.equipmentInventory ?? []), ...snapshot.currentLoadout, ...(snapshot.scrolls ?? [])];
  for (let index = candidates.length - 1; index >= 0; index--) {
    if (itemKey(candidates[index]) === selection.key) return candidates[index];
  }
  return null;
}

function GameIcon({ item }: { item: MobileItem }) {
  const src = equipmentIcon(item);
  return <span className="nm-icon-slot">{src ? <img src={src} alt="" /> : <span className="nm-icon-text">{equipmentCategory(item) === '未分类武器' ? '武器' : equipmentCategory(item)}</span>}</span>;
}

function EquipmentRow({ item, compact, equipped, onOpen }: { item: MobileItem; compact?: boolean; equipped?: boolean; onOpen: () => void }) {
  return <button className={`nm-equipment-row${compact ? ' nm-compact' : ''}${equipped ? ' nm-equipped' : ''}`} onClick={onOpen}>
    <GameIcon item={item} /><span className="nm-item-copy"><span className="nm-item-name">{nameOf(item)}{!isScroll(item) && item.plus > 0 ? ` +${item.plus}` : ''}{equipped && !compact ? <small className="nm-badge">已装备</small> : null}</span>
    {!compact ? <span className="nm-item-meta">{equipmentCategory(item)} · {isScroll(item) ? `建议Lv.${item.level}` : `${item.level} / +${item.plus}`} · {isScroll(item) ? '佩戴关系未识别' : localizeSetOrGrace(item.setOrGrace)}</span> : null}</span><span className="nm-chevron" aria-hidden="true">›</span>
  </button>;
}

function CharacterPage({ snapshot, archiveInfo, desktop }: { snapshot: SaveSnapshot; archiveInfo: DeviceArchiveInfo | null; desktop: boolean }) {
  const status = isCharacterStatus(snapshot.characterStatus) && snapshot.characterStatus.referenceSnapshotId === snapshot.snapshotId ? snapshot.characterStatus : null;
  const panels = status?.groups.flatMap(g => g.entries) ?? [];
  const effects = status?.effects.flatMap(g => g.entries) ?? [];
  const get = (label: string, effect = false) => (effect ? effects : panels).find(e => e.label === label)?.value ?? '未解析';
  const summary = [['装备负重', get('装备重量')], ['敏捷等级', get('敏捷')], ['坚忍度', get('坚忍度')], ['妖怪化持续时间加成', get('妖怪化持续时间', true)], ['装备掉落率', get('装备品掉落率', true)], ['道具掉落率', get('道具掉落率', true)]];
  return <div className="nm-character-page">
    <header className="nm-character-head"><div><h1>无名武士</h1><p>{desktop ? '电脑展示 · 原始存档只读' : <>{archiveInfo?.sourceSnapshotId === snapshot.snapshotId && archiveInfo.source === 'computer-sync' ? <span>电脑安全同步</span> : '本机档案'} · 离线可用</>}</p></div><div className="nm-level"><span>等级</span><strong>{snapshot.character.level}</strong></div></header>
    <div className="nm-resources">{[[trophyIcon, '持有的精华', snapshot.character.amrita], [walletIcon, '持有的金钱', snapshot.character.gold]].map(([icon, title, value]) => <div key={String(title)}><img src={String(icon)} alt="" /><div><small>{title}</small><strong>{number(Number(value))}</strong></div></div>)}</div>
    <section className="nm-attributes"><h2>01 能力强化值</h2><div className="nm-attribute-grid">{Object.entries(ATTRIBUTES).map(([key, label]) => <div className="nm-attribute" key={key}><b>{label}</b><strong>{snapshot.character.attributes[key as AttributeKey]}</strong></div>)}</div></section>
    <section className="nm-section"><h2>02 人物详细属性{status ? ' · 截图记录' : ''}</h2><dl className="nm-summary">{summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === '敏捷等级' && value !== '未解析' ? <span className="nm-stat-badge">{value}</span> : value}{label === '装备负重' && get('装备重量占比') !== '未解析' ? <span className="nm-stat-badge">{get('装备重量占比')}</span> : null}</dd></div>)}</dl></section>
    {status ? <>
      <p className="nm-note nm-inset"><span>截图记录 · 非自动解析</span><br />整理于 {status.recordedOn} · {status.captureTime ? `拍摄于 ${status.captureTime}` : '截图时间未知'}。不会随换装自动更新，也不再次叠加到面板值。</p>
      <p className="nm-note nm-inset">体力、精力、妖力仅显示上限。</p>
      {[...status.groups.map(g => ({ ...g, panel: true, title: `面板 · ${g.title}` })), ...status.effects.map(g => ({ ...g, panel: false, title: `特殊效果 · ${g.title}` }))].map(group => <section className="nm-section" key={group.title}><h2>{group.title}</h2><dl className="nm-values">{deduplicateEntries(group.entries).map(entry => <div key={JSON.stringify([entry.label, entry.value])}><dt>{entry.label}<small>截图 {entry.pages.join('、')}</small></dt><dd>{(group.panel ? formatPanelValue(entry) : entry.value) ?? '已生效'}</dd></div>)}</dl></section>)}
    </> : <p className="nm-note nm-inset">最终面板数值尚未完成自动解析；未解析不代表零。若电脑档案包含与当前快照匹配的截图记录，同步后会在这里显示。</p>}
    <p className="nm-note nm-inset nm-source-time">来源存档时间：{snapshot.sourceLastWriteLocal || '未知'}。展示的是已读取的记录，不是游戏实时状态。</p>
  </div>;
}

function ItemDetail({ item, onBack }: { item: MobileItem; onBack: () => void }) {
  const shareAction = useShareTextAction();
  const effects = item.effects ?? [];
  const share = async () => {
    await shareAction.run('Nioh 装备详情', [nameOf(item), `等级 ${item.level}${isScroll(item) ? '' : ` +${item.plus}`}`,
      isScroll(item) ? '仓库绘卷，佩戴关系尚未识别。' : localizeSetOrGrace(item.setOrGrace),
      ...effects.map((_, index) => effectText(item, index))].join('\n'));
  };
  return <section className="nm-detail"><button className="nm-back" onClick={onBack}>‹ 返回列表</button>
    <div className="nm-detail-card"><div><GameIcon item={item} /><h1>{nameOf(item)}{!isScroll(item) && item.plus > 0 ? ` +${item.plus}` : ''}</h1><span className="nm-badge">{mobileRarity(item.rarity)}</span></div><p>等级 {item.level} · {isScroll(item) ? `剩余挑战次数 ${item.attemptsRemaining}` : localizeSetOrGrace(item.setOrGrace)}</p></div>
    {isScroll(item) ? <p className="nm-note">当前尚未识别佩戴中的绘卷；本页展示仓库内这张绘卷，不代表已装备。</p> : <p className="nm-note">按存档记录展示词条。不推算套装触发效果，不把装备加成当作最终伤害。</p>}
    <h2>{isScroll(item) ? '绘卷包含词条' : '特殊效果'} · {effects.length} 条</h2><dl className="nm-values nm-effects">{effects.map((effect, i) => <div key={`${i}:${effect}`}><dt>{localizeEffect(effect, item.effectsZh?.[i])}</dt><dd>{effectValueText(item, i)}</dd></div>)}</dl>
    {!effects.length ? <p className="nm-note">此记录尚无已解析词条。</p> : null}<button className="nm-primary" disabled={shareAction.busy} onClick={() => void share()}>{shareAction.busy ? '正在分享…' : '分享装备资料'}</button>{shareAction.error ? <p role="alert">{shareAction.error}</p> : null}
  </section>;
}

function LoadoutPage({ snapshot, onItem, onScrolls, onBuilds }: { snapshot: SaveSnapshot; onItem: (item: MobileItem) => void; onScrolls: () => void; onBuilds: () => void }) {
  const shareAction = useShareTextAction();
  const ordered = [...snapshot.currentLoadout].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  const sets = new Map<string, number>();
  for (const item of ordered) if (item.setOrGrace && item.setOrGrace !== '-') sets.set(item.setOrGrace, (sets.get(item.setOrGrace) ?? 0) + 1);
  return <>
    <div className="nm-build-head"><div>{ordered[0] ? <GameIcon item={ordered[0]} /> : null}<h1>{snapshot.currentLoadoutName || '当前配装'}</h1></div><p>存档已装备记录 · 点击装备查看完整属性</p></div>
    <div className="nm-set-grid">{[...sets].map(([name, count]) => <div key={name}><b>{localizeSetOrGrace(name)}</b><small>当前装备 {count} 件 · 非触发档位</small></div>)}</div>
    <div className="nm-loadout-list">{ordered.map(item => <EquipmentRow compact key={item.slot} item={item} onOpen={() => onItem(item)} />)}{ordered.length === 0 ? <p className="nm-note">尚无已解析的装备槽记录。</p> : null}
      <button className="nm-equipment-row nm-compact" onClick={onScrolls}><span className="nm-icon-slot"><img src={CATEGORY_ICONS['绘卷']} alt="" /></span><span className="nm-item-copy"><b>装备中的绘卷尚未识别</b><small>查看绘卷库 · {snapshot.scrolls?.length ?? 0} 张</small></span><span className="nm-chevron">›</span></button>
      <button onClick={onBuilds}>我的配装册</button><button className="nm-primary" disabled={shareAction.busy} onClick={() => void shareAction.run('Nioh 当前配装', buildShareText(snapshot))}>{shareAction.busy ? '正在分享…' : '分享当前配装'}</button>{shareAction.error ? <p role="alert">{shareAction.error}</p> : null}
    </div>
  </>;
}

function Warehouse({ snapshot, onItem, initialCategory }: { snapshot: SaveSnapshot; onItem: (item: MobileItem) => void; initialCategory: string }) {
  const [tab, setTab] = useState('装备');
  const [query, setQuery] = useState('');
  const needle = useDeferredValue(query.trim().toLowerCase());
  const [category, setCategory] = useState(initialCategory);
  const [rarity, setRarity] = useState('全部');
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftRarity, setDraftRarity] = useState(rarity);
  const [filtering, setFiltering] = useState(false);
  const [sort, setSort] = useState('等级');
  const [limit, setLimit] = useState(60);
  const inventory = useMemo(() => {
    const rows = new Map<string, MobileItem>();
    for (const item of [...(snapshot.equipmentInventory ?? []), ...snapshot.currentLoadout, ...(snapshot.scrolls ?? [])]) rows.set(itemKey(item), item);
    return [...rows.values()];
  }, [snapshot]);
  const equipped = new Set(snapshot.currentLoadout.map(itemKey));
  const rows = useMemo(() => inventory.filter(item => (category === '全部' || equipmentCategory(item) === category) && (rarity === '全部' || mobileRarity(item.rarity) === rarity) && (!needle || [nameOf(item), !isScroll(item) ? localizeSetOrGrace(item.setOrGrace) : '', ...(item.effects ?? []).map((e, i) => localizeEffect(e, item.effectsZh?.[i]))].join(' ').toLowerCase().includes(needle))).sort((a, b) => sort === '名称' ? nameOf(a).localeCompare(nameOf(b), 'zh-CN') : b.level - a.level || (isScroll(b) ? 0 : b.plus) - (isScroll(a) ? 0 : a.plus)), [inventory, category, rarity, needle, sort]);
  const items = (snapshot.inventoryItems ?? []).filter(item => !needle || `${localizeItemName(item.id, item.nameZh)} ${localizeItemType(item.type)}`.toLowerCase().includes(needle));
  const openFilters = () => { setDraftCategory(category); setDraftRarity(rarity); setFiltering(true); };
  if (filtering) return <section className="nm-filter"><button className="nm-back" onClick={() => setFiltering(false)}>关闭 ×</button><h1>筛选装备</h1><h2>类别</h2><div className="nm-filter-grid">{CATEGORIES.map(c => <button aria-pressed={draftCategory === c} key={c} onClick={() => setDraftCategory(c)}>{CATEGORY_ICONS[c] ? <img src={CATEGORY_ICONS[c]} alt="" /> : null}{c}</button>)}</div><h2>稀有度</h2><div className="nm-filter-grid">{['全部', '普通', '名器', '上等', '大名物', '神器', '神宝'].map(r => <button key={r} aria-pressed={draftRarity === r} onClick={() => setDraftRarity(r)}>{r}</button>)}</div><div className="nm-two-buttons"><button onClick={() => { setDraftCategory('全部'); setDraftRarity('全部'); }}>重置</button><button className="nm-primary" onClick={() => { setCategory(draftCategory); setRarity(draftRarity); setLimit(60); setFiltering(false); }}>应用筛选</button></div><p className="nm-note">武器细分类按明确名称识别；无法确认的记录保留在“未分类武器”，不会丢弃。</p></section>;
  return <section className="nm-warehouse"><div className="nm-two-buttons" role="tablist" aria-label="仓库内容">{['装备', '物品'].map(t => <button role="tab" aria-selected={t === tab} className={t === tab ? 'nm-primary' : ''} key={t} onClick={() => { setTab(t); setQuery(''); setLimit(60); }}>{t}</button>)}</div>
    <input aria-label="搜索仓库" type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }} placeholder={tab === '装备' ? '⌕  搜索装备名称、恩宠或词条' : '⌕  搜索物品名称、类别'} />
    {tab === '装备' ? <div className="nm-filter-bar"><button onClick={openFilters}>类别：{category}</button><button onClick={openFilters}>稀有度：{rarity}</button><button onClick={() => setSort(s => s === '等级' ? '名称' : '等级')}>排序：{sort}</button></div> : null}
    <h2>{tab === '装备' ? `${category === '全部' ? '全部装备' : category} · ${rows.length} 件` : `物品 · ${items.length} 种`}</h2>
    <div className="nm-warehouse-list">{tab === '装备' ? rows.slice(0, limit).map(item => <EquipmentRow item={item} key={itemKey(item)} equipped={equipped.has(itemKey(item))} onOpen={() => onItem(item)} />) : items.slice(0, limit).map(item => <div className="nm-inventory-row" key={`${item.recordIndex}:${item.id}`}><div><b>{localizeItemName(item.id, item.nameZh)}</b><small>{localizeItemType(item.type)}</small></div><strong>× {number(item.quantity)}</strong></div>)}</div>
    {(tab === '装备' ? rows.length : items.length) === 0 ? <p className="nm-note">没有符合条件的记录，请更换搜索条件或重置筛选。</p> : null}
    {(tab === '装备' ? rows.length : items.length) > limit ? <button className="nm-load-more" onClick={() => setLimit(n => n + 60)}>加载更多</button> : null}
  </section>;
}

interface Props {
  snapshot: SaveSnapshot | null; archiveInfo: DeviceArchiveInfo | null; notice?: string; noticeWarning?: boolean; error: string; importing: boolean; onRetryLoad?: () => void;
  onArchive: (archive: CharacterAssetPackage) => Promise<ArchiveReceipt>; onBackup: () => void; onExport: () => void; children: ReactNode; builds: ReactNode;
  desktop?: { tools: ReactNode; importPanel: ReactNode; notices: ReactNode; refreshing: boolean; newerSave: boolean; onRefresh: () => void };
}
/** Figma 02–08 presentation; the existing App owns all validated persistence. */
export function MobileApp({ snapshot, archiveInfo, notice, noticeWarning, error, importing, onRetryLoad, onArchive, onBackup, onExport, children, builds, desktop }: Props) {
  const [tab, setTab] = useState('角色');
  const [detail, setDetail] = useState<ItemSelection | null>(null);
  const [initialCategory, setInitialCategory] = useState('全部');
  const [showBuilds, setShowBuilds] = useState(false);
  const scroller = useRef<HTMLElement>(null);
  const currentDetail = selectedItem(snapshot, detail);
  // Keep only identity in state, not an outdated equipment object. Once removed or
  // switched to another character, a selection must not reopen itself later.
  if (detail && !currentDetail) setDetail(null);
  useEffect(() => { scroller.current?.scrollTo?.(0, 0); }, [tab, detail, showBuilds]);
  const navigate = (next: string) => { setTab(next); setDetail(null); setShowBuilds(false); if (next === '仓库') setInitialCategory('全部'); };
  const openItem = (item: MobileItem) => {
    if (snapshot) setDetail({ snapshotId: snapshot.snapshotId, key: itemKey(item),
      slot: tab === '配装' && 'slot' in item && typeof item.slot === 'string' ? item.slot : null });
  };
  const navigation = <nav className={desktop ? 'nd-nav' : 'nm-bottom-nav'} aria-label={desktop ? '电脑主要导航' : '手机主要导航'}>{['角色', '配装', '仓库', '更多'].map((label, index) => <button key={label} aria-current={label === tab ? 'page' : undefined} onClick={() => navigate(label)}>{desktop ? <small>0{index + 1}</small> : null}{label}</button>)}</nav>;
  return <div className={`nm-shell${desktop ? ' nd-shell' : ''}`}>
    {desktop ? <aside className="nd-sidebar"><div className="nd-brand"><b>Nioh</b><span>存档伴侣</span><small>你的角色，随身同行。</small></div>{navigation}<div className="nd-sidebar-foot"><span>本地优先 · 原档只读</span><p>电脑分析，手机展示。<br />无需 Steam 密码。</p><small>版本 {packageInfo.version}</small></div></aside> : null}
    {desktop ? <header className="nd-toolbar"><div><span>NIOH 2 / 存档工作台</span><strong>{tab === '更多' ? '导入与设备管理' : tab}</strong></div><div><button disabled={desktop.refreshing || importing} onClick={desktop.onRefresh}>{desktop.refreshing ? '刷新中' : desktop.newerSave ? '读取新存档' : '读取存档'}</button><button className="nm-primary" onClick={() => navigate('更多')}>导入与同步</button></div></header> : null}
    <main className="nm-scroll" ref={scroller}>
      {!desktop && (tab !== '角色' || !snapshot) ? <header className="nm-topbar"><button aria-label="打开更多" onClick={() => navigate('更多')}><img src={menuIcon} alt="" /></button><strong>{currentDetail ? (isScroll(currentDetail) ? '绘卷详情' : '装备详情') : `Nioh${tab === '仓库' ? ' · 仓库' : ' 存档伴侣'}`}</strong><button aria-label="搜索仓库" onClick={() => navigate('仓库')}><img src={searchIcon} alt="" /></button><button aria-label="同步状态" onClick={() => navigate('更多')}><img src={bellIcon} alt="" /></button></header> : null}
      {error ? <p className="nm-alert" role="alert">{error}</p> : null}
      {onRetryLoad ? <button className="nm-primary" disabled={importing} onClick={onRetryLoad}>重试读取本机档案</button> : null}
      {desktop?.notices}
      {notice ? <details className="nm-notice" open={noticeWarning || undefined}><summary>{noticeWarning ? '接收尚未全部完成' : '接收结果'}</summary><p role={noticeWarning ? 'alert' : 'status'}>{notice}</p></details> : null}
      {snapshot && tab === '角色' ? <CharacterPage snapshot={snapshot} archiveInfo={archiveInfo} desktop={Boolean(desktop)} /> : null}
      {snapshot && (tab === '配装' || tab === '仓库') && currentDetail ? <ItemDetail key={itemKey(currentDetail)} item={currentDetail} onBack={() => setDetail(null)} /> : null}
      {snapshot && tab === '配装' && !currentDetail ? showBuilds ? <div className="nm-legacy-builds"><button onClick={() => setShowBuilds(false)}>‹ 返回当前配装</button>{builds}</div> : <LoadoutPage snapshot={snapshot} onItem={openItem} onBuilds={() => setShowBuilds(true)} onScrolls={() => { setInitialCategory('绘卷'); setTab('仓库'); }} /> : null}
      {snapshot && tab === '仓库' ? <div hidden={Boolean(currentDetail)}><Warehouse key={`${snapshot.snapshotId}:${initialCategory}`} snapshot={snapshot} initialCategory={initialCategory} onItem={openItem} /></div> : null}
      <div hidden={Boolean(snapshot) && tab !== '更多'} className="nm-more">
        {desktop ? <><div className="nd-workflow"><span>01 / 电脑读取副本</span><span>02 / 扫码同步</span><span>03 / 手机离线展示</span></div>{desktop.importPanel}{desktop.tools}</> : <><MobileReceivePanel onArchive={onArchive} active={tab === '更多' || !snapshot} /><p className="nm-note">同步后可关闭电脑、离开 Wi-Fi 查看；卸载或清除数据会删除手机资料。</p></>}
        <details><summary>高级：从已有备份恢复（可选）</summary><button disabled={importing} onClick={onBackup}>导入我的档案包</button>{snapshot ? <button onClick={onExport}>导出备份档案包</button> : null}</details>
        <p className="nm-note">版本 {packageInfo.version} · 原始存档只读<br />与 Koei Tecmo、Team Ninja、Valve 无隶属关系。</p>
      </div>
      {children}
    </main>
    {!desktop && snapshot ? navigation : null}
  </div>;
}
