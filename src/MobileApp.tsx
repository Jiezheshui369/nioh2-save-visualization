import { CharacterDetails } from './DesktopCharacterDetails';
import { GameBitmapText, DesktopBitmapTextLayout } from './GameBitmapText';
import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AttributeKey, DeviceArchiveInfo, SaveSnapshot } from './types';
import type { CharacterAssetPackage } from './assetPackage';
import { MobileMore } from './MobileMore';
import { MobileAssetImage } from './MobileAssetImage';
import type { ArchiveReceipt } from './SyncPanel';
import { localizeEffect, localizeItemName, localizeItemType, localizeSetOrGrace } from './localization';
import { mobileSetLabel } from './mobileSetPresentation';
import { deduplicateEntries, formatPanelValue, isCharacterStatus } from './characterStatus';
import { useShareTextAction } from './useShareTextAction';
import { buildShareText } from './shareSummary';
import { effectText, effectValueText } from './effectValues';
import { CATEGORIES, categoryIcon, equipmentCategory, equipmentIcon, inventoryItemIcon, isScroll, mobileRarity } from './mobileEquipment';
import type { MobileItem } from './mobileEquipment';
import menuIcon from './assets/figma/menu.svg';
import searchIcon from './assets/figma/search.svg';
import bellIcon from './assets/figma/bell.svg';
import trophyIcon from './assets/figma/trophy.svg';
import walletIcon from './assets/figma/wallet.svg';
import packageInfo from '../package.json';
import { privateImage, bundledPrivateUi, privateVisualPreview, privateColorPreview, privateGameFramesPreview, privateRoleLightPreview, privateLightAllPreview, privateVisualStyle } from './privateVisualAssets';
import './mobile.css';
import './mobileVisual.css';

const ATTRIBUTES: Record<AttributeKey, string> = { constitution: '体', heart: '心', courage: '勇', stamina: '刚', strength: '武', skill: '技', dexterity: '忍', magic: '咒' };
const SLOTS = ['melee1', 'melee2', 'ranged1', 'ranged2', 'head', 'torso', 'arms', 'legs', 'feet', 'accessory1', 'accessory2'];
const number = (v: number) => v.toLocaleString('zh-CN');
const nameOf = (item: MobileItem) => localizeItemName(item.id, item.nameZh);
const itemKey = (item: MobileItem) => `${isScroll(item) ? 'scroll' : 'equipment'}:${item.recordIndex}:${item.id}`;
const isSample = (snapshot: SaveSnapshot) => snapshot.snapshotId.startsWith('synthetic-');

function SampleNotice({ snapshot }: { snapshot: SaveSnapshot }) {
  return isSample(snapshot) ? <p className="nm-sample-notice" role="status">示例数据 · 非存档读取 / 模拟预览</p> : null;
}

type ItemSelection = { snapshotId: string; key: string; slot: string | null };
function selectedItem(snapshot: SaveSnapshot | null, selection: ItemSelection | null): MobileItem | null {
  if (!snapshot || selection?.snapshotId !== snapshot.snapshotId) return null;
  if (selection.slot !== null) {
    return snapshot.currentLoadout.find(item => item.slot === selection.slot && itemKey(item) === selection.key) ?? null;
  }
  // Match the warehouse's precedence: current equipment supersedes its inventory copy.
  const groups = [snapshot.scrolls ?? [], snapshot.currentLoadout, snapshot.equipmentInventory ?? []];
  for (const group of groups) for (let index = group.length - 1; index >= 0; index--) {
    if (itemKey(group[index]) === selection.key) return group[index];
  }
  return null;
}

function GameIcon({ item, representative = false }: { item: MobileItem; representative?: boolean }) {
  const src = representative && isScroll(item) ? privateImage('scrollRepresentative') ?? equipmentIcon(item) : equipmentIcon(item);
  const category = equipmentCategory(item);
  return <span className="nm-icon-slot" data-icon-kind="category"><MobileAssetImage src={src} fallback={<span className="nm-icon-text" aria-hidden="true">{category === '未分类武器' ? '未分类' : category}</span>} /></span>;
}

function EquipmentRow({ item, compact, equipped, onOpen, suppressUnverifiedSets = false }: { item: MobileItem; compact?: boolean; equipped?: boolean; onOpen: () => void; suppressUnverifiedSets?: boolean }) {
  const lightMobile = privateLightAllPreview && new URLSearchParams(window.location.search).get('layout') !== 'desktop';
  const setName = isScroll(item) || lightMobile && suppressUnverifiedSets ? '' : lightMobile ? mobileSetLabel(item.setOrGrace ?? '') : localizeSetOrGrace(item.setOrGrace);
  return <button className={`nm-equipment-row${compact ? ' nm-compact' : ''}${equipped ? ' nm-equipped' : ''}`} onClick={onOpen}>
    <GameIcon item={item} /><span className="nm-item-copy"><span className="nm-item-name">{nameOf(item)}{!isScroll(item) && item.plus > 0 ? ` +${item.plus}` : ''}{equipped && !compact ? <small className="nm-badge">已装备</small> : null}</span>
    {!compact ? <span className="nm-item-meta">{equipmentCategory(item)} · {isScroll(item) ? `建议Lv.${item.level} · 佩戴关系未识别` : `${item.level} / +${item.plus}${setName ? ' · ' + setName : ''}`}</span> : null}</span><span className="nm-chevron" aria-hidden="true">›</span>
  </button>;
}

function CharacterPage({ snapshot, archiveInfo, desktop }: { snapshot: SaveSnapshot; archiveInfo: DeviceArchiveInfo | null; desktop: boolean }) {
  const roleLight = !desktop && privateRoleLightPreview;
  const syntheticStatus = !desktop && privateLightAllPreview && isSample(snapshot);
  const status = isCharacterStatus(snapshot.characterStatus) && snapshot.characterStatus.referenceSnapshotId === snapshot.snapshotId ? snapshot.characterStatus : null;
  const historicalReference = !desktop && privateLightAllPreview && new URLSearchParams(window.location.search).get('reference') === 'historical-screenshot';
  const sourceNote = syntheticStatus ? <p className="nm-note nm-inset nm-source-time">数值来源：独立合成规则。未读取存档或截图，不代表真实角色或自动解析结果。</p> : <p className="nm-note nm-inset nm-source-time">来源存档时间：{snapshot.sourceLastWriteLocal || '未知'}。展示的是已读取的记录，不是游戏实时状态。</p>;
  const currencyBlock = <div data-long-currency={number(snapshot.character.amrita).length>14 || number(snapshot.character.gold).length>14 ? 'true' : undefined} className={`nm-resources${desktop ? ' nd-character-summary' : ''}`}>{desktop ? <div className="nd-summary-level"><div><small><GameBitmapText>等级</GameBitmapText></small><strong><GameBitmapText>{snapshot.character.level}</GameBitmapText></strong></div></div> : null}{[[privateImage('resource:amrita') ?? privateImage('ui:trophy') ?? trophyIcon, '持有的精华', snapshot.character.amrita, Boolean(privateImage('resource:amrita'))], [privateImage('resource:money') ?? privateImage('ui:wallet') ?? walletIcon, '持有的金钱', snapshot.character.gold, Boolean(privateImage('resource:money'))]].map(([icon, title, value, gameIcon]) => <div key={String(title)}><MobileAssetImage className={gameIcon ? 'nm-resource-game-icon nm-currency-icon' : 'nm-currency-icon'} src={String(icon)} /><div><small><GameBitmapText>{String(title)}</GameBitmapText></small><strong><GameBitmapText>{number(Number(value))}</GameBitmapText></strong></div></div>)}</div>;
  const attributesBlock = <section className="nm-attributes"><div className="nm-attribute-heading"><h2><GameBitmapText>01 能力强化值</GameBitmapText></h2>{!desktop ? <div className="nm-level"><span><GameBitmapText>等级</GameBitmapText></span><strong><GameBitmapText>{snapshot.character.level}</GameBitmapText></strong></div> : null}</div><div className="nm-attribute-grid">{Object.entries(ATTRIBUTES).map(([key, label]) => <div className={'nm-attribute'+(desktop && String(snapshot.character.attributes[key as AttributeKey]).length>7 ? ' nm-long-value' : '')} key={key}><b><GameBitmapText>{label}</GameBitmapText></b><strong><GameBitmapText>{snapshot.character.attributes[key as AttributeKey]}</GameBitmapText></strong></div>)}</div></section>;
  return <div className="nm-character-page">

    {historicalReference ? <aside className="nm-historical-reference" role="note"><strong>独立历史档案 · 截图资料</strong><p>历史快照：{snapshot.snapshotId}<br />{status ? <>截图整理于 {status.recordedOn} · {status.groups.reduce((count, group) => count + group.entries.length, 0)} 条面板记录 / {status.effects.reduce((count, group) => count + group.entries.length, 0)} 条效果记录。</> : '截图记录与此历史快照未匹配。'}<br />非自动解析，不代表当前配装；不会随换装更新，不改变其他档案。</p></aside> : null}
    {desktop ? <header className="nm-character-head"><div><h1><GameBitmapText>角色资料</GameBitmapText></h1></div></header>
      : <header className="nm-character-head nm-neutral-head"><div className="nm-character-identity"><div className="nm-character-title-line"><h1><GameBitmapText>角色资料</GameBitmapText></h1></div><p>{historicalReference ? '历史档案' : archiveInfo?.sourceSnapshotId === snapshot.snapshotId && archiveInfo.source === 'computer-sync' ? <span>电脑安全同步</span> : '本机档案'} · 离线可用</p></div></header>}
    {desktop ? <>{currencyBlock}<div className="nd-character-workspace"><CharacterDetails snapshot={snapshot} synthetic={isSample(snapshot)} /></div></> : <>{currencyBlock}{attributesBlock}<CharacterDetails snapshot={snapshot} synthetic={isSample(snapshot)} mobile /></>}
    {!roleLight ? sourceNote : null}
  </div>;
}

function ItemDetail({ item, snapshot, onBack, returnLabel, light = false }: { item: MobileItem; snapshot: SaveSnapshot; onBack: () => void; returnLabel: string; light?: boolean }) {
  const shareAction = useShareTextAction();
  const effects = item.effects ?? [];
  const scroll = isScroll(item);
  const setName = isScroll(item) ? '' : light ? (isSample(snapshot) ? '' : mobileSetLabel(item.setOrGrace ?? '')) : localizeSetOrGrace(item.setOrGrace);
  const share = async () => {
    await shareAction.run('Nioh 装备详情', [nameOf(item), '等级 ' + item.level + (scroll ? '' : ' +' + item.plus),
      scroll ? '仓库绘卷，佩戴关系尚未识别。' : localizeSetOrGrace(item.setOrGrace),
      ...effects.map((_, index) => effectText(item, index))].join('\n'));
  };
  const overview = <>
    {light && scroll ? <p className="nm-unresolved-scroll">装备中绘卷尚未识别</p> : null}
    <div className="nm-detail-card">
      <div><GameIcon item={item} representative={scroll} /><div className="nm-detail-name"><h1>{nameOf(item)}{!scroll && item.plus > 0 ? ' +' + item.plus : ''}</h1><p>{mobileRarity(item.rarity)}{isSample(snapshot) ? ' · 示例' : ''}</p></div></div>
      <p>{scroll ? '建议等级 ' : '等级 '}{item.level}{scroll ? ' · 剩余挑战次数 ' + item.attemptsRemaining : setName ? ' · ' + setName : ''}</p>
    </div>
    {scroll ? <p className="nm-note">当前尚未识别佩戴中的绘卷；本页展示仓库内这张绘卷，不代表已装备。绘卷图示仅表示类别，不对应稀有度。</p> : null}
  </>;
  return <section className={'nm-detail' + (scroll ? ' nm-scroll-detail' : '')}>
    <button className="nm-back" onClick={onBack}>‹ 返回列表</button>
    {!light && scroll ? <p className="nm-unresolved-scroll">装备中绘卷尚未识别</p> : null}
    {light ? <section className="nm-detail-overview">{overview}</section> : overview}
    <section className="nm-effect-panel" aria-label={scroll ? '绘卷包含词条' : '装备词条'}>{scroll ? <h2>绘卷包含词条 · {effects.length} 条</h2> : null}
      <dl className="nm-values nm-effects">{effects.map((effect, i) => <div key={i + ':' + effect}><dt>{localizeEffect(effect, item.effectsZh?.[i])}</dt><dd>{effectValueText(item, i)}</dd></div>)}</dl>
      {!effects.length ? <p className="nm-note">此记录尚无已解析词条。</p> : null}
    </section>
    <div className="nm-detail-actions"><button disabled={shareAction.busy} onClick={() => void share()}>{shareAction.busy ? '正在分享…' : '分享装备资料'}</button><button className="nm-primary" onClick={onBack}>{returnLabel}</button></div>
    {shareAction.error ? <p role="alert">{shareAction.error}</p> : null}
  </section>;
}

function LoadoutPage({ snapshot, desktop, onItem, onScrolls, onBuilds }: { snapshot: SaveSnapshot; desktop: boolean; onItem: (item: MobileItem) => void; onScrolls: () => void; onBuilds: () => void }) {
  const shareAction = useShareTextAction();
  const ordered = [...snapshot.currentLoadout].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  const sets = new Map<string, number>();
  for (const item of ordered) if (item.setOrGrace && item.setOrGrace !== '-') sets.set(item.setOrGrace, (sets.get(item.setOrGrace) ?? 0) + 1);
  const shownSets = privateLightAllPreview && !desktop ? (isSample(snapshot) ? [] : [...sets].filter(([name]) => mobileSetLabel(name))) : [...sets];
  const overview = <>
    <div className="nm-build-head"><div>{ordered[0] ? <GameIcon item={ordered[0]} /> : null}<h1>当前配装</h1></div><p>存档已装备记录 · 点击装备查看完整属性</p></div>
    {shownSets.length ? <div className="nm-set-grid">{shownSets.map(([name, count]) => <div key={name}><b>{privateLightAllPreview && !desktop ? mobileSetLabel(name) : localizeSetOrGrace(name)}</b><small>当前装备 {count} 件 · 非触发档位</small></div>)}</div> : null}
  </>;
  return <>
    {privateLightAllPreview && !desktop ? <section className="nm-loadout-overview">{overview}</section> : desktop ? <section className="nd-loadout-overview">{overview}</section> : overview}
    <div className="nm-loadout-list">{ordered.map(item => <EquipmentRow compact key={item.slot} item={item} onOpen={() => onItem(item)} />)}{ordered.length === 0 ? <p className="nm-note">尚无已解析的装备槽记录。</p> : null}
      <button className="nm-equipment-row nm-compact" onClick={onScrolls}><span className="nm-icon-slot"><MobileAssetImage src={categoryIcon('绘卷')} fallback={<span className="nm-icon-text" aria-hidden="true">绘卷</span>} /></span><span className="nm-item-copy"><b>装备中的绘卷尚未识别</b><small>查看绘卷库 · {snapshot.scrolls?.length ?? 0} 张</small></span><span className="nm-chevron">›</span></button>
      <button onClick={onBuilds}>我的配装册</button><button className="nm-primary" disabled={shareAction.busy} onClick={() => void shareAction.run('Nioh 当前配装', buildShareText(snapshot))}>{shareAction.busy ? '正在分享…' : '分享当前配装'}</button>{shareAction.error ? <p role="alert">{shareAction.error}</p> : null}
    </div>
  </>;
}

function Warehouse({ snapshot, onItem, initialCategory, onFiltering, focusSearchRequest }: { snapshot: SaveSnapshot; onItem: (item: MobileItem) => void; initialCategory: string; onFiltering: (value: boolean) => void; focusSearchRequest: number }) {
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const filterPanel = useRef<HTMLElement>(null);
  const filterButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const filterOrigin = useRef(0);
  const wasFiltering = useRef(false);
  const [tab, setTab] = useState('装备');
  const [query, setQuery] = useState('');
  const needle = useDeferredValue(query.trim().toLowerCase());
  const [category, setCategory] = useState(initialCategory);
  const [rarity, setRarity] = useState('全部');
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftRarity, setDraftRarity] = useState(rarity);
  const [filtering, setFiltering] = useState(false);
  const [sort, setSort] = useState('等级');
  const [itemCategory, setItemCategory] = useState('全部');
  const [itemSort, setItemSort] = useState('数量');
  const [limit, setLimit] = useState(60);
  useEffect(() => { onFiltering(filtering); }, [filtering, onFiltering]);
  useLayoutEffect(() => {
    if (filtering) filterPanel.current?.querySelector('button')?.focus({ preventScroll: true });
    else if (wasFiltering.current) filterButtons.current[filterOrigin.current]?.focus({ preventScroll: true });
    wasFiltering.current = filtering;
  }, [filtering]);
  useLayoutEffect(() => { if (focusSearchRequest > 0 && !filtering) searchInput.current?.focus({ preventScroll: true }); }, [focusSearchRequest]);
  const inventory = useMemo(() => {
    const rows = new Map<string, MobileItem>();
    for (const group of [snapshot.equipmentInventory ?? [], snapshot.currentLoadout, snapshot.scrolls ?? []]) for (const item of group) rows.set(itemKey(item), item);
    return [...rows.values()];
  }, [snapshot]);
  const equipped = useMemo(() => new Set(snapshot.currentLoadout.map(itemKey)), [snapshot.currentLoadout]);
  const searchIndex = useMemo(() => inventory.map(item => {
    const name = nameOf(item);
    return { item, name, category: equipmentCategory(item), rarity: mobileRarity(item.rarity),
      text: [name, !isScroll(item) ? localizeSetOrGrace(item.setOrGrace) : '', ...(item.effects ?? []).map((effect, i) => localizeEffect(effect, item.effectsZh?.[i]))].join(' ').toLowerCase() };
  }), [inventory]);
  const rows = useMemo(() => searchIndex.filter(row => (category === '全部' || row.category === category)
    && (rarity === '全部' || row.rarity === rarity) && (!needle || row.text.includes(needle)))
    .sort((a, b) => sort === '名称' ? a.name.localeCompare(b.name, 'zh-CN')
      : b.item.level - a.item.level || (isScroll(b.item) ? 0 : b.item.plus) - (isScroll(a.item) ? 0 : a.item.plus)).map(row => row.item), [searchIndex, category, rarity, needle, sort]);
  const itemIndex = useMemo(() => (snapshot.inventoryItems ?? []).map(item => {
    const name = localizeItemName(item.id, item.nameZh), category = localizeItemType(item.type);
    return { item, name, category, text: (name + ' ' + category).toLowerCase() };
  }), [snapshot.inventoryItems]);
  const itemCategories = useMemo(() => ['全部', ...new Set(itemIndex.map(row => row.category))], [itemIndex]);
  const items = useMemo(() => itemIndex.filter(row => (itemCategory === '全部' || row.category === itemCategory)
    && (!needle || row.text.includes(needle))).sort((a, b) => itemSort === '数量' ? b.item.quantity - a.item.quantity : a.name.localeCompare(b.name, 'zh-CN')).map(row => row.item), [itemIndex, itemCategory, needle, itemSort]);
  const openFilters = (origin: number) => { filterOrigin.current = origin; setDraftCategory(category); setDraftRarity(rarity); setFiltering(true); };
  const reset = () => { setCategory('全部'); setRarity('全部'); setItemCategory('全部'); setQuery(''); setLimit(60); };
  if (filtering) return <section ref={filterPanel} id={`${id}-filter-region`} className="nm-filter" role="region" aria-labelledby={`${id}-filter-title`} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); setFiltering(false); } }}>
    <button className="nm-back" onClick={() => setFiltering(false)}>关闭 ×</button><h1 id={`${id}-filter-title`}>筛选装备</h1><h2>类别</h2>
    <div className="nm-filter-grid" role="group" aria-label="装备类别">{CATEGORIES.map(c => <button aria-pressed={draftCategory === c} key={c} onClick={() => setDraftCategory(c)}><MobileAssetImage src={categoryIcon(c)} />{c}</button>)}</div>
    <h2>稀有度</h2><div className="nm-filter-grid nm-rarity-grid" role="group" aria-label="装备稀有度">{['全部', '普通', '名器', '上等', '大名物', '神器', '神宝', '未知'].map(r => <button key={r} aria-pressed={draftRarity === r} onClick={() => setDraftRarity(r)}>{r}</button>)}</div>
    <div className="nm-two-buttons"><button onClick={() => { setDraftCategory('全部'); setDraftRarity('全部'); }}>重置</button><button className="nm-primary" onClick={() => { setCategory(draftCategory); setRarity(draftRarity); setLimit(60); setFiltering(false); }}>应用筛选</button></div>
    <p className="nm-note">武器细分类按明确名称识别；无法确认的记录保留在“未分类武器”，不会丢弃。</p>
  </section>;
  return <section className="nm-warehouse">
    <div className="nm-two-buttons" role="tablist" aria-label="仓库内容" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : tab === '装备' ? 1 : 0;
      setTab(next === 0 ? '装备' : '物品'); setQuery(''); setLimit(60);
      (event.currentTarget.querySelectorAll('button')[next] as HTMLButtonElement).focus();
    }}>{['装备', '物品'].map((t, index) => <button role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel`} aria-selected={t === tab} tabIndex={t === tab ? 0 : -1} className={t === tab ? 'nm-primary' : ''} key={t} onClick={() => { setTab(t); setQuery(''); setLimit(60); }}>{t}</button>)}</div>
    <div className="nm-warehouse-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab === '装备' ? 0 : 1}`}>
    <input ref={searchInput} aria-label="搜索仓库" type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }} placeholder={tab === '装备' ? '搜索装备名称、恩宠或词条' : '搜索物品名称、类别'} />
    {tab === '装备' ? <div className="nm-filter-bar"><button ref={node => { filterButtons.current[0] = node; }} aria-expanded={filtering} aria-controls={`${id}-filter-region`} onClick={() => openFilters(0)}>类别：{category}</button><button ref={node => { filterButtons.current[1] = node; }} aria-expanded={filtering} aria-controls={`${id}-filter-region`} onClick={() => openFilters(1)}>稀有度：{rarity}</button><button onClick={() => setSort(s => s === '等级' ? '名称' : '等级')}>排序：{sort}</button></div>
      : <div className="nm-two-buttons"><label className="nm-item-category">类别：<select aria-label="物品类别" value={itemCategory} onChange={e => { setItemCategory(e.target.value); setLimit(60); }}>{itemCategories.map(c => <option value={c} key={c}>{c}</option>)}</select></label><button onClick={() => setItemSort(s => s === '数量' ? '名称' : '数量')}>排序：{itemSort}</button></div>}
    <div className="nm-list-heading"><h2>{tab === '装备' ? (category === '全部' ? '全部装备' : category) + ' · ' + rows.length + ' 件' : '物品 · ' + items.length + ' 种'}</h2><small>{isSample(snapshot) ? '示例库 · 非存档读取' : '档案记录'}</small></div>
    <div className="nm-warehouse-list">{tab === '装备' ? rows.slice(0, limit).map(item => <EquipmentRow item={item} key={itemKey(item)} suppressUnverifiedSets={privateLightAllPreview && isSample(snapshot)} equipped={equipped.has(itemKey(item))} onOpen={() => onItem(item)} />)
      : items.slice(0, limit).map(item => { const name = localizeItemName(item.id, item.nameZh); const icon = inventoryItemIcon(name); return <div className="nm-inventory-row" key={item.recordIndex + ':' + item.id}>{icon ? <span className="nm-icon-slot"><MobileAssetImage src={icon} fallback={<span className="nm-icon-text" aria-hidden="true">物品</span>} /></span> : null}<div className="nm-inventory-copy"><b>{name}</b><small>{localizeItemType(item.type)}</small></div><strong>× {number(item.quantity)}</strong></div>; })}</div>
    {(tab === '装备' ? rows.length : items.length) === 0 ? <div className="nm-empty-state"><p className="nm-note">没有符合条件的记录，请更换搜索条件或重置筛选。</p><button onClick={reset}>重置筛选</button></div> : null}
    {(tab === '装备' ? rows.length : items.length) > limit ? <button className="nm-load-more" onClick={() => setLimit(n => n + 60)}>加载更多</button> : null}
    </div>
  </section>;
}

function DesktopMain({desktop,children}:{desktop:boolean;children:ReactNode}) { return desktop ? <div className="nd-main">{children}</div> : <>{children}</>; }

interface Props {
  onRemoteSnapshot?: (snapshot: SaveSnapshot | null) => void;
  snapshot: SaveSnapshot | null; archiveInfo: DeviceArchiveInfo | null; notice?: string; noticeWarning?: boolean; error: string; importing: boolean; onRetryLoad?: () => void;
  onArchive: (archive: CharacterAssetPackage) => Promise<ArchiveReceipt>; onBackup: () => void; onExport: () => void; children: ReactNode; builds: ReactNode;
  desktop?: { tools: ReactNode; importPanel: ReactNode; notices: ReactNode; refreshing: boolean; newerSave: boolean; onRefresh: () => void };
}
/** Figma 02–08 presentation; the existing App owns all validated persistence. */
export function MobileApp({ snapshot, archiveInfo, notice, noticeWarning, error, importing, onRetryLoad, onArchive, onBackup, onExport, children, builds, desktop, onRemoteSnapshot }: Props) {
  const [tab, setTab] = useState('角色');
  const [detail, setDetail] = useState<ItemSelection | null>(null);
  const [initialCategory, setInitialCategory] = useState('全部');
  const [showBuilds, setShowBuilds] = useState(false);
  const [warehouseFiltering, setWarehouseFiltering] = useState(false);
  const [warehouseVisit, setWarehouseVisit] = useState(0);
  const [focusSearchRequest, setFocusSearchRequest] = useState(0);
  const focusPage = useRef(false);
  const scroller = useRef<HTMLElement>(null);
  const detailReturnScroll = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const desktopImportWasBusy = useRef(false);
  const desktopImportSourceId = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!desktop) return;
    if (importing && !desktopImportWasBusy.current) {
      desktopImportSourceId.current = snapshot?.snapshotId;
      setTab('更多'); setDetail(null); setShowBuilds(false); focusPage.current = true;
    } else if (!importing && desktopImportWasBusy.current && snapshot?.snapshotId !== desktopImportSourceId.current) {
      setTab('角色'); setDetail(null); setShowBuilds(false); focusPage.current = true;
    }
    desktopImportWasBusy.current = importing;
  }, [Boolean(desktop), importing, snapshot?.snapshotId]);
  const currentDetail = selectedItem(snapshot, detail);
  // Keep only identity in state, not an outdated equipment object. Once removed or
  // switched to another character, a selection must not reopen itself later.
  if (detail && !currentDetail) setDetail(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = pendingScroll.current ?? 0;
    pendingScroll.current = null;
    if (focusPage.current) {
      const search = tab === '仓库' && !detail && focusSearchRequest > 0 ? scroller.current?.querySelector<HTMLInputElement>('input[type=search]') : null;
      (search ?? scroller.current)?.focus({ preventScroll: true });
    }
    focusPage.current = false;
  }, [tab, detail, showBuilds, warehouseVisit, focusSearchRequest]);
  const navigate = (next: string) => { focusPage.current = true; setTab(next); setDetail(null); setShowBuilds(false); setWarehouseFiltering(false); if (next === '仓库') { setInitialCategory('全部'); setWarehouseVisit(value => value + 1); } };
  const openItem = (item: MobileItem) => {
    focusPage.current = true;
    detailReturnScroll.current = scroller.current?.scrollTop ?? 0;
    if (snapshot) setDetail({ snapshotId: snapshot.snapshotId, key: itemKey(item),
      slot: tab === '配装' && 'slot' in item && typeof item.slot === 'string' ? item.slot : null });
  };
  const navigation = <nav className={desktop ? 'nd-nav' : 'nm-bottom-nav'} aria-label={desktop ? '电脑主要导航' : '手机主要导航'}>{['角色', '配装', '仓库', '更多'].map((label, index) => <button key={label} disabled={!desktop && !snapshot && label !== '更多'} aria-current={label === (snapshot ? tab : '更多') ? 'page' : undefined} onClick={() => navigate(label)}>{desktop ? <small>0{index + 1}</small> : null}{label}</button>)}</nav>;
  const viewClass = warehouseFiltering && tab === '仓库' ? 'nm-view-filters' : currentDetail && isScroll(currentDetail) ? 'nm-view-scroll' : snapshot && tab === '角色' ? 'nm-view-character' : 'nm-view-other';
  return <DesktopBitmapTextLayout enabled={Boolean(desktop)}><div data-synthetic-preview={!desktop && privateLightAllPreview && snapshot && isSample(snapshot) ? '1' : undefined} className={`nm-shell${desktop ? ' nd-shell' : ' ' + viewClass}${!desktop && (privateVisualPreview || bundledPrivateUi) ? ' nm-materials' : ''}${!desktop && privateColorPreview ? ' nm-color-scenes' : ''}${!desktop && privateGameFramesPreview ? ' nm-game-frames' : ''}${!desktop && privateRoleLightPreview && snapshot && tab === '角色' ? ' nm-role-light' : ''}${!desktop && privateLightAllPreview ? ' nm-light-all' : ''}`} style={!desktop || bundledPrivateUi ? privateVisualStyle() : undefined}>
    {desktop ? <aside className="nd-sidebar"><div className="nd-brand"><b>存档资产</b></div>{navigation}<div className="nd-sidebar-foot"><small>版本</small><small className="nd-version-value">{packageInfo.version}</small></div></aside> : null}
    <DesktopMain desktop={Boolean(desktop)}>
    {desktop ? <header className="nd-toolbar"><div><span>电脑应用 / 拖入 SAVEDATA.BIN 自动解析</span><strong>{tab === '更多' ? '导入与设备管理' : tab}</strong></div><div><button disabled={desktop.refreshing || importing} onClick={desktop.onRefresh}>{desktop.refreshing ? '刷新中' : desktop.newerSave ? '读取新存档' : '读取存档'}</button><button className="nm-primary" disabled={importing} onClick={() => { navigate('更多'); scroller.current?.querySelector<HTMLInputElement>('[aria-label="选择 SAVEDATA.BIN"]')?.click(); }}>导入存档</button></div></header> : null}
    <main className="nm-scroll" ref={scroller} tabIndex={-1} aria-label={currentDetail ? (isScroll(currentDetail) ? '绘卷详情' : '装备详情') : warehouseFiltering ? '筛选装备' : (snapshot ? tab : '更多') + '内容'}>
      {!desktop && (tab === '更多' || !snapshot) ? <header className="nm-import-brand"><strong>存档资产 Save Asset</strong><span>{privateImage('offlineDot') ? <MobileAssetImage src={privateImage('offlineDot')} /> : null}支持离线查看</span></header> : null}
      {!desktop && snapshot && tab !== '角色' && tab !== '更多' ? <header className="nm-topbar"><button aria-label="打开更多" onClick={() => navigate('更多')}><MobileAssetImage src={privateImage('ui:menu') ?? menuIcon} fallback={<span className="nm-control-text" aria-hidden="true">更多</span>} /></button><strong>{currentDetail ? (isScroll(currentDetail) ? '绘卷详情' : '装备详情') : warehouseFiltering && tab === '仓库' ? '筛选装备' : `存档资产${tab === '仓库' ? ' · 仓库' : ''}`}</strong><button aria-label="搜索仓库" disabled={!snapshot} onClick={() => { navigate('仓库'); setFocusSearchRequest(value => value + 1); }}><MobileAssetImage src={privateImage('ui:search') ?? searchIcon} fallback={<span className="nm-control-text" aria-hidden="true">搜索</span>} /></button><button aria-label="同步状态" onClick={() => navigate('更多')}><MobileAssetImage src={privateImage('ui:bell') ?? bellIcon} fallback={<span className="nm-control-text" aria-hidden="true">状态</span>} /></button></header> : null}
      {error ? <div className="nm-alert" role="alert">{!desktop && privateImage('alert') ? <MobileAssetImage className="nm-alert-icon" src={privateImage('alert')} /> : null}<div><strong>{onRetryLoad ? '本机档案读取未完成' : '操作未完成'}</strong><p>{error}</p>{snapshot ? <small>当前角色资料仍可查看。</small> : null}</div></div> : null}
      {!desktop && importing ? <section className="nm-saving-state" role="status" aria-live="polite"><span className="nm-loading-line" aria-hidden="true" /><strong>正在保存档案…</strong><p>保存完成后再切换角色资料。</p></section> : null}
      {onRetryLoad ? <button className="nm-primary" disabled={importing} onClick={onRetryLoad}>重试读取本机档案</button> : null}
      {desktop?.notices}
      {!desktop && notice ? <details className="nm-notice" open={noticeWarning || undefined}><summary>{noticeWarning ? '接收尚未全部完成' : '接收结果'}</summary><p role={noticeWarning ? 'alert' : 'status'}>{notice}</p></details> : null}
      {snapshot && tab === '角色' ? <CharacterPage snapshot={snapshot} archiveInfo={archiveInfo} desktop={Boolean(desktop)} /> : null}
      {snapshot && (tab === '配装' || tab === '仓库') && currentDetail ? <ItemDetail key={itemKey(currentDetail)} item={currentDetail} snapshot={snapshot} light={privateLightAllPreview && !desktop} returnLabel={isScroll(currentDetail) ? '返回绘卷库' : tab === '配装' ? '返回配装' : '返回仓库'} onBack={() => { focusPage.current = true; pendingScroll.current = detailReturnScroll.current; setDetail(null); }} /> : null}
      {snapshot && tab === '配装' && !currentDetail ? showBuilds ? <div className="nm-legacy-builds"><button onClick={() => setShowBuilds(false)}>‹ 返回当前配装</button>{builds}</div> : <LoadoutPage snapshot={snapshot} desktop={Boolean(desktop)} onItem={openItem} onBuilds={() => setShowBuilds(true)} onScrolls={() => { setInitialCategory('绘卷'); setTab('仓库'); }} /> : null}
      {snapshot && tab === '仓库' ? <div hidden={Boolean(currentDetail)}><Warehouse key={`${snapshot.snapshotId}:${initialCategory}:${warehouseVisit}`} snapshot={snapshot} initialCategory={initialCategory} onItem={openItem} onFiltering={setWarehouseFiltering} focusSearchRequest={focusSearchRequest} /></div> : null}
      <div hidden={Boolean(snapshot) && tab !== '更多'} className="nm-more">
        {desktop ? <><div className="nd-workflow"><span>01 / 电脑读取副本</span><span>02 / 账号与连接状态</span><span>03 / 手机离线展示</span></div>{desktop.importPanel}{desktop.tools}
          <details><summary>高级：从已有备份恢复（可选）</summary><button disabled={importing} onClick={onBackup}>导入我的档案包</button>{snapshot ? <button disabled={importing} onClick={onExport}>导出备份档案包</button> : null}</details>
          <p className="nm-note">版本 {packageInfo.version} · 原始存档只读<br />与 Koei Tecmo、Team Ninja、Valve 无隶属关系。</p></>
          : <MobileMore onRemoteSnapshot={onRemoteSnapshot} snapshot={snapshot} archiveInfo={archiveInfo} active={tab === '更多' || !snapshot} importing={importing} onArchive={onArchive} onBackup={onBackup} onExport={onExport} onPageChange={() => { if (scroller.current) scroller.current.scrollTop = 0; }} />}
      </div>
      {children}
    </main>
    </DesktopMain>
    {!desktop ? navigation : null}
  </div></DesktopBitmapTextLayout>;
}
