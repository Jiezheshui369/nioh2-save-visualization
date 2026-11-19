import { desktopContextHeaders, sameDesktopContext } from './desktopDataContext';
import type { DesktopDataContext } from './desktopDataContext';
import { saveDesktopSnapshot, loadDesktopSnapshotIndex } from './desktopSnapshotCache';
import { isSupportedSnapshot as isSupportedRemoteSnapshot } from './snapshotValidation';
import { ExperimentalScrollPanel } from "./ExperimentalScrollPanel";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { isNativeApp } from "./runtime";
import { effectText } from "./effectValues";
import { shareOrDownloadFile, shareText } from "./fileSharing";
import { useFileShareAction } from './useFileShareAction';
import {
  Archive,
  AppWindow,
  BookmarkPlus,
  BookOpenCheck,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Copy,
  Database,
  Download,
  FileUp,
  FileText,
  Fingerprint,
  Gem,
  History,
  ImageDown,
  Library,
  Menu,
  MonitorDown,
  PackageSearch,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  ScrollText,
  Swords,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { ApiRequestError, cacheRecentSnapshots, getLastLoadSource, loadLatestSnapshot, loadSaveSources, loadSnapshot, loadSnapshotIndex, refreshSnapshot } from "./api";
import { useAgentStatus } from "./useAgentStatus";
import type { SnapshotLoadSource } from "./api";
import { diffSnapshots } from "./diff";
import { createSavedBuildShareCardBlob, createShareCardBlob } from "./shareCard";
import { buildShareText, buildSavedBuildShareText } from "./shareSummary";
import { deleteSavedBuild, importSavedBuilds, loadSavedBuilds, saveCurrentBuild } from "./buildLibrary";
import type { ArchiveReceipt } from "./SyncPanel";
import type { SavedBuild } from "./buildLibrary";
import { createAssetPackage, isAssetPackage, readAssetFile } from "./assetPackage";
import type { CharacterAssetPackage } from "./assetPackage";
import { createResearchDiff } from "./researchExport";
import { clearCachedSnapshot, loadCachedSnapshotIndex, loadDeviceArchiveInfo, saveImportedSnapshot, SNAPSHOT_CACHE_UPDATED_EVENT } from "./snapshotCache";
import { calculateCoverage } from "./coverage";
import { isSourceNewer } from "./freshness";
import {
  localizeItemName,
  localizeItemType,
  localizeLimitation,
  localizeProficiency,
  localizeRarity,
  localizeSetOrGrace,
} from "./localization";
import type { AgentStatus, AttributeKey, DeviceArchiveInfo, EquipmentItem, LoadoutItem, SaveSnapshot, SaveSourceOption, SnapshotSummary, ViewName } from "./types";
import packageJson from "../package.json";
import { CharacterStatusPanel } from "./CharacterStatusPanel";
import { MobileReceivePanel } from "./SyncPanel";
import { DesktopApp } from './DesktopApp';
import type { DesktopReadState } from './DesktopApp';
import { DesktopImport } from "./DesktopImport";
import { MobileApp } from "./MobileApp";
import { MobileLoadingScreen } from "./MobileMore";
import { privateMobilePresentation, privateLightAllPreview } from './privateVisualAssets';
import { mobileSetLabel } from './mobileSetPresentation';
import "./desktop.css";

const NAV: Array<{ id: ViewName; label: string; icon: typeof Archive }> = [
  { id: "overview", label: "我的角色", icon: Archive },
  { id: "builds", label: "我的配装册", icon: Library },
  { id: "loadout", label: "当前配装", icon: Swords },
  { id: "equipment", label: "资产仓库", icon: Boxes },
  { id: "inventory", label: "物品", icon: PackageSearch },
  { id: "scrolls", label: "绘卷", icon: ScrollText },
  { id: "history", label: "快照对比", icon: History },
  { id: "pairing", label: "手机连接", icon: Smartphone },
  { id: "install", label: "安装应用", icon: AppWindow },
  { id: "progress", label: "旅途进度", icon: BookOpenCheck },
  { id: "safety", label: "安全记录", icon: ShieldCheck },
];

const ATTRIBUTE_NAMES: Record<AttributeKey, string> = {
  constitution: "体",
  heart: "心",
  courage: "勇",
  stamina: "刚",
  strength: "武",
  skill: "技",
  dexterity: "忍",
  magic: "咒",
};

const SLOT_NAMES: Record<string, string> = {
  melee1: "主武器",
  melee2: "副武器",
  ranged1: "远程一",
  ranged2: "远程二",
  head: "头部",
  torso: "胸甲",
  arms: "臂甲",
  legs: "膝甲",
  feet: "腿甲",
  accessory1: "饰品一",
  accessory2: "饰品二",
};

const EQUIPMENT_SLOT_ORDER = ["melee1", "melee2", "head", "torso", "arms", "legs", "feet", "accessory1", "accessory2", "ranged1", "ranged2"] as const;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function loadoutFingerprint(snapshot: SaveSnapshot): string {
  return snapshot.currentLoadout
    .map((item) => `${item.equipIndex}:${item.id}:${item.plus}:${item.setOrGrace}`)
    .sort()
    .join("|");
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function summarizeSets(items: LoadoutItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.setOrGrace, (counts.get(item.setOrGrace) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function LoadingScreen() {
  return (
    <main className="loading-shell" aria-live="polite">
      <div className="loading-mark nioh-wordmark">存档资产</div>
      <p>正在展开角色卷轴…</p>
    </main>
  );
}

export function EmptyLibrary({ error, onImport, importing = false }: { error?: string; onImport: () => void; importing?: boolean }) {
  return (
    <main className="empty-library">
      <section className="empty-library-card">
        <div className="empty-library-mark nioh-wordmark" aria-hidden="true">存档资产</div>
        <div className="empty-library-copy">
          <p className="eyebrow">随身档案 · 我的角色资产</p>
          <h1>这里等待的是<br /><em>你的存档</em></h1>
          <p>本应用不会用演示人物冒充你的资料。在电脑选择游戏存档并分析独立副本，保存后可离线查看。跨网功能以账号与连接状态为准；已有档案包可用于备份恢复。</p>
          {error ? <div className="empty-library-error" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span></div> : null}
          <button type="button" disabled={importing} onClick={onImport}><FileUp aria-hidden="true" />{importing ? "正在保存档案…" : "导入我的档案包"}</button>
        </div>
        <ol aria-label="导入步骤">
          <li><span>01</span><strong>电脑读取</strong><small>只解析独立副本</small></li>
          <li><span>02</span><strong>电脑发布</strong><small>只发送分析结果</small></li>
          <li><span>03</span><strong>确认账号连接</strong><small>无需搬运 JSON</small></li>
          <li><span>04</span><strong>离线查看</strong><small>资料只留在设备上</small></li>
        </ol>
      </section>
      <p className="empty-library-footnote"><ShieldCheck aria-hidden="true" />应用不会要求 Steam 密码，也不会把档案自动上传到服务器。</p>
    </main>
  );
}

function StatSeal({ name, value, max }: { name: string; value: number; max: number }) {
  const level = Math.max(8, Math.round((value / max) * 100));
  return (
    <div className="stat-seal" aria-label={`${name} ${value}`}>
      <div className="stat-ring" style={{ "--level": `${level}%` } as React.CSSProperties}>
        <span>{value}</span>
      </div>
      <strong>{name}</strong>
    </div>
  );
}

export function Overview({ snapshot, archiveInfo, onOpenBuilds, onImport }: { snapshot: SaveSnapshot; archiveInfo: DeviceArchiveInfo | null; onOpenBuilds: () => void; onImport: () => void }) {
  const attributes = Object.entries(snapshot.character.attributes) as Array<[AttributeKey, number]>;
  const maxAttribute = Math.max(...attributes.map(([, value]) => value));
  const topSkills = useMemo(
    () => Object.entries(snapshot.character.proficiency).sort((a, b) => b[1] - a[1]).slice(0, 4),
    [snapshot.character.proficiency],
  );

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">我的角色 · 随身档案</p>
          <h1>我的仁王<br /><em>角色资产</em></h1>
          <div className="hero-level">
            <span>等级</span>
            <strong>{snapshot.character.level}</strong>
          </div>
        </div>
        <div className="hero-resources" aria-label="角色资源">
          <div><Sparkles aria-hidden="true" /><span>精华</span><strong>{formatNumber(snapshot.character.amrita)}</strong></div>
          <div><Gem aria-hidden="true" /><span>金钱</span><strong>{formatNumber(snapshot.character.gold)}</strong></div>
          <div><Swords aria-hidden="true" /><span>当前配装</span><strong>{snapshot.currentLoadoutName ?? "存档装备"}</strong></div>
        </div>
      </section>

      <section className="paper-section">
        <div className="section-heading"><div><span>01</span><h2>八项能力</h2></div><p>数值越高，环形朱砂越完整</p></div>
        <div className="stat-grid">
          {attributes.map(([key, value]) => <StatSeal key={key} name={ATTRIBUTE_NAMES[key]} value={value} max={maxAttribute} />)}
        </div>
      </section>

      <CharacterStatusPanel key={snapshot.snapshotId} snapshot={snapshot} />
      <section>
        <div className="paper-section compact">
          <div className="section-heading"><div><span>03</span><h2>修行倾向</h2></div></div>
          <div className="skill-bars">
            {topSkills.map(([name, value], index) => (
              <div key={name} className="skill-row">
                <div><span>{localizeProficiency(name)}</span><b>{formatNumber(value)}</b></div>
                <div className="ink-track"><i style={{ width: `${Math.max(6, 100 - index * 18)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="asset-callout">
        <div><span>随身资产</span><strong>把当前装备收藏为一套独立配装</strong><p>命名、备注并保存在这台设备上，之后可以当面展示或复制中文摘要。</p></div>
        <button type="button" onClick={onOpenBuilds}><Library aria-hidden="true" />打开我的配装册</button>
      </section>
      {archiveInfo ? <section className="archive-status-card">
        <div><span>手机档案状态</span><strong>真实角色资料已保存在本机</strong><p>上次导入 {new Date(archiveInfo.importedAt).toLocaleString("zh-CN")} · 游戏存档 {new Date(archiveInfo.sourceLastWriteLocal).toLocaleString("zh-CN")}</p></div>
        <dl><div><dt>档案来源</dt><dd>{archiveInfo.source === "computer-sync" ? "电脑安全同步" : archiveInfo.source === "asset-package" ? "角色档案包" : "旧版单快照"}</dd></div><div><dt>随包配装</dt><dd>{archiveInfo.buildCount} 套</dd></div><div><dt>设备状态</dt><dd>可离线查看</dd></div></dl>
        {!isNativeApp() ? <button type="button" onClick={onImport}><FileUp aria-hidden="true" />导入新版档案</button> : null}
      </section> : null}
    </div>
  );
}

export function BuildsView({ snapshot }: { snapshot: SaveSnapshot }) {
  const mobileLight = privateLightAllPreview && privateMobilePresentation();
  const syntheticCurrent = snapshot.snapshotId.startsWith('synthetic-');
  const [builds, setBuilds] = useState<SavedBuild[]>([]);
  const [title, setTitle] = useState(mobileLight && syntheticCurrent ? '' : snapshot.currentLoadoutName ?? snapshot.savedEquipmentPresetName ?? "我的仁王配装");
  const [note, setNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [storageFailure, setStorageFailure] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [writing, setWriting] = useState(false);
  const writeLock = useRef(false);
  const selected = builds.find((build) => build.id === selectedId) ?? builds[0] ?? null;
  const cardAction = useFileShareAction(selected);
  const cardState = cardAction.state;
  const currentSets = useMemo(() => summarizeSets(snapshot.currentLoadout), [snapshot.currentLoadout]);
  const selectedSets = useMemo(() => selected ? summarizeSets(selected.equipment) : [], [selected]);
  const syntheticSelected = selected?.sourceSnapshotId.startsWith('synthetic-') ?? false;
  const shownCurrentSets = mobileLight ? (syntheticCurrent ? [] : currentSets.filter(([name]) => mobileSetLabel(name))) : currentSets;
  const shownSelectedSets = mobileLight ? (syntheticSelected ? [] : selectedSets.filter(([name]) => mobileSetLabel(name))) : selectedSets;
  const shownSetName = (name: string) => mobileLight ? mobileSetLabel(name) : localizeSetOrGrace(name);

  useEffect(() => {
    setTitle(mobileLight && syntheticCurrent ? '' : snapshot.currentLoadoutName ?? snapshot.savedEquipmentPresetName ?? "我的仁王配装");
  }, [snapshot.currentLoadoutName, snapshot.savedEquipmentPresetName, snapshot.snapshotId, mobileLight, syntheticCurrent]);

  useEffect(() => {
    let active = true;
    void loadSavedBuilds().then((items) => {
      if (!active) return;
      setBuilds(items);
      setLoaded(true);
      setStorageFailure("");
      setSelectedId((current) => current ?? items[0]?.id ?? null);
    }).catch((reason: unknown) => {
      if (active) setStorageFailure(reason instanceof Error ? reason.message : "配装册读取失败，请重试。不要清除应用数据。");
    });
    return () => { active = false; };
  }, [loadAttempt]);

  async function handleSave() {
    if (writeLock.current || !loaded) return;
    writeLock.current = true; setWriting(true); setStorageFailure("");
    try {
      const next = await saveCurrentBuild(snapshot, title, note);
      setBuilds(next);
      setSelectedId(next[0]?.id ?? null);
      setSaveState("saved");
      setNote("");
    } catch (reason) {
      setSaveState("failed");
      setStorageFailure(reason instanceof Error ? reason.message : "保存失败，原配装仍保留。");
    } finally { writeLock.current = false; setWriting(false); }
    window.setTimeout(() => setSaveState("idle"), 2400);
  }

  async function handleCopy(build: SavedBuild) {
    setCopyState(await writeTextToClipboard(buildSavedBuildShareText(build)) ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2400);
  }

  async function handleBuildCard(build: SavedBuild) {
    await cardAction.run(() => createSavedBuildShareCardBlob(build), `Nioh配装-${build.title}.png`, `Nioh 配装｜${build.title}`);
  }

  async function handleDelete(id: string) {
    if (writeLock.current || !loaded) return;
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }
    writeLock.current = true; setWriting(true); setStorageFailure("");
    try {
      const next = await deleteSavedBuild(id);
      setBuilds(next);
      setSelectedId(next[0]?.id ?? null);
      setPendingDelete(null);
    } catch (reason) {
      setStorageFailure(reason instanceof Error ? reason.message : "移除失败，配装仍保留，请重试。");
    } finally { writeLock.current = false; setWriting(false); }
  }

  return (
    <div className="page-stack">
      <section className="page-intro build-library-intro"><p className="eyebrow">随身配装资产</p><h1>我的配装册</h1><p>把存档中的当前装备保存成独立卡片。它不会随着下一次读取被覆盖，也不依赖时间快照继续存在。</p></section>
      <section className="build-capture">
        <div className="build-capture-summary">
          <span>当前可收藏</span>
          <strong>{mobileLight ? '当前配装' : snapshot.currentLoadoutName ?? "存档记录的当前装备"}</strong>
          <p>等级 {snapshot.character.level} · {snapshot.currentLoadout.length} 个已装备槽位</p>
          {shownCurrentSets.length ? <div>{shownCurrentSets.slice(0, 4).map(([name, count]) => <i key={name}>{shownSetName(name)} {count}</i>)}</div> : null}
        </div>
        <div className="build-capture-form">
          <label><span>配装名称</span><input aria-label="配装名称" maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mobileLight ? '输入配装名称' : '例如：深层大山阴阳'} /></label>
          <label><span>备注</span><textarea aria-label="配装备注" maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="用途、打法、需要注意的词条……" /></label>
          <button type="button" disabled={writing || !loaded} onClick={() => void handleSave()}><BookmarkPlus aria-hidden="true" />{writing ? "正在保存…" : saveState === "saved" ? "已收藏到配装册" : saveState === "failed" ? "保存失败" : "收藏当前配装"}</button>
        </div>
      </section>

      {storageFailure ? <section className="build-library-empty" role="alert"><strong>{storageFailure}</strong>{!loaded ? <button type="button" onClick={() => { setStorageFailure(""); setLoadAttempt(value => value + 1); }}>重试读取配装册</button> : null}</section> : null}
      {!loaded ? (!storageFailure ? <p role="status">正在读取配装册…</p> : null) : builds.length === 0 ? (
        <section className="build-library-empty"><Library aria-hidden="true" /><strong>配装册还是空的</strong><p>给当前配装起一个名字并收藏，它就会成为可以随时展示的独立资产。</p></section>
      ) : (
        <section className="build-library-layout">
          <div className="build-card-list" aria-label="已收藏配装">
            <header><span>已收藏配装</span><strong>{builds.length}</strong></header>
            {builds.map((build) => (
              <button type="button" key={build.id} className={selected?.id === build.id ? "active" : ""} onClick={() => { setSelectedId(build.id); setPendingDelete(null); }}>
                <span>{new Date(build.createdAt).toLocaleDateString("zh-CN")}</span>
                <strong>{build.title}</strong>
                <small>等级 {build.level} · {build.equipment.length} 件装备</small>
              </button>
            ))}
          </div>
          {selected ? (
            <article className="saved-build-detail">
              <header><div><span>设备本地配装</span><h2>{selected.title}</h2><p>{selected.note || "尚未添加备注"}</p></div><b>Lv.{selected.level}</b></header>
              {shownSelectedSets.length ? <div className="saved-build-sets">{shownSelectedSets.slice(0, 5).map(([name, count]) => <i key={name}>{shownSetName(name)} <b>{count}</b></i>)}</div> : null}
              <div className="saved-build-stats">{Object.entries(selected.attributes).map(([key, value]) => <span key={key}><small>{ATTRIBUTE_NAMES[key as AttributeKey]}</small><strong>{value}</strong></span>)}</div>
              <div className="saved-build-equipment">{EQUIPMENT_SLOT_ORDER.map((slot) => {
                const item = selected.equipment.find((entry) => entry.slot === slot);
                const setName = item && !(mobileLight && syntheticSelected) ? shownSetName(item.setOrGrace) : '';
                return <div key={slot}><span>{SLOT_NAMES[slot]}</span><strong>{item ? localizeItemName(item.id, item.nameZh) : "未装备"}</strong><small>{item ? `${setName ? setName + ' · ' : ''}+${item.plus}` : "空槽"}</small></div>;
              })}</div>
              <div className="saved-build-actions">
                <button type="button" onClick={() => void handleBuildCard(selected)} disabled={cardState === "working"}><ImageDown aria-hidden="true" />{cardState === "working" ? "正在生成" : cardState === "shared" ? "已打开分享" : cardState === "saved" ? "图片已保存" : cardState === "failed" ? "生成失败" : "分享配装图片"}</button>
                <button type="button" onClick={() => void handleCopy(selected)}>{copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copyState === "copied" ? "摘要已复制" : copyState === "failed" ? "复制失败" : "复制分享摘要"}</button>
                <button type="button" disabled={writing} className={pendingDelete === selected.id ? "confirm-delete" : ""} onClick={() => void handleDelete(selected.id)}><Trash2 aria-hidden="true" />{pendingDelete === selected.id ? "再次点击确认删除" : "移除这套配装"}</button>
              </div>
            </article>
          ) : null}
        </section>
      )}
    </div>
  );
}

function Loadout({ snapshot }: { snapshot: SaveSnapshot }) {
  const [active, setActive] = useState(snapshot.currentLoadout[0]?.equipIndex ?? 0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareFailed, setShareFailed] = useState(false);
  const cardAction = useFileShareAction(snapshot);
  const cardState = cardAction.state;
  const selected = snapshot.currentLoadout.find((item) => item.equipIndex === active);
  const selectedSlot = EQUIPMENT_SLOT_ORDER[active] ?? selected?.slot;
  const loadoutByIndex = useMemo(() => new Map(snapshot.currentLoadout.map((item) => [item.equipIndex, item])), [snapshot.currentLoadout]);

  async function handleCopyBuild() {
    const text = buildShareText(snapshot);
    setCopyState(await writeTextToClipboard(text) ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2400);
  }

  async function handleShareBuild() {
    try {
      await shareText(`仁王2构筑｜${snapshot.currentLoadoutName ?? "当前装备"}`, buildShareText(snapshot));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setShareFailed(true);
      window.setTimeout(() => setShareFailed(false), 2400);
    }
  }

  async function handleSaveCard() {
    await cardAction.run(() => createShareCardBlob(snapshot), 'Nioh当前配装.png', 'Nioh 当前配装');
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">构筑档案</p><h1>存档记录的当前装备</h1><p>依据物品记录中的装备槽标记还原十一个槽位；存档真正写入空槽后会明确显示未装备。已验证编码类型的词条会显示数值，其余保持留空。</p>{snapshot.savedEquipmentPresetName ? <p className="preset-note">另检测到已保存预设“{snapshot.savedEquipmentPresetName}”，它不等同于当前装备。</p> : null}</section>
      <section className="share-strip">
        <div><span>交流模式</span><strong>生成纯中文构筑摘要</strong><p>内容只写入本机剪贴板，不会上传存档或角色数据。</p></div>
        <div className="share-actions">
          {isNativeApp() || typeof navigator.share === "function" ? <button type="button" onClick={() => void handleShareBuild()}><Share2 aria-hidden="true" />{shareFailed ? "分享失败" : "系统分享"}</button> : null}
          <button type="button" onClick={() => void handleSaveCard()} disabled={cardState === "working"}><ImageDown aria-hidden="true" />{cardState === "working" ? "生成中" : cardState === "shared" ? "已打开分享" : cardState === "saved" ? "已保存" : cardState === "failed" ? "生成失败" : "保存构筑卡"}</button>
          <button type="button" onClick={() => void handleCopyBuild()} aria-live="polite">
            {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制构筑摘要"}
          </button>
        </div>
      </section>
      <section className="loadout-layout">
        <div className="gear-list" role="list" aria-label="装备列表">
          {EQUIPMENT_SLOT_ORDER.map((slot, equipIndex) => {
            const item = loadoutByIndex.get(equipIndex);
            return (
              <button key={slot} className={`${equipIndex === active ? "gear-row selected" : "gear-row"}${item ? "" : " empty"}`} onClick={() => setActive(equipIndex)}>
                <span className="slot-mark">{String(equipIndex + 1).padStart(2, "0")}</span>
                <span><small>{SLOT_NAMES[slot]}</small><strong>{item ? localizeItemName(item.id, item.nameZh) : "未装备"}</strong><em>{item ? localizeSetOrGrace(item.setOrGrace) : "实时槽位为空"}</em></span>
                <b>{item ? `+${item.plus}` : "—"}</b><ChevronRight aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {selected ? (
          <aside className="gear-detail" aria-live="polite">
            <p>{SLOT_NAMES[selected.slot] ?? "未知部位"}</p>
            <h2>{localizeItemName(selected.id, selected.nameZh)}</h2>
            <div className="rarity">{localizeRarity(selected.rarity)}</div>
            <dl>
              <div><dt>基础等级</dt><dd>{selected.level}</dd></div>
              <div><dt>强化值</dt><dd>+{selected.plus}</dd></div>
              <div><dt>物品编号</dt><dd>{selected.id}</dd></div>
            </dl>
            <div className="grace-stamp"><span>套装 / 恩宠</span><strong>{localizeSetOrGrace(selected.setOrGrace)}</strong></div>
            {selected.effects?.length ? (
              <div className="effect-list">
                <span>已识别词条</span>
                {selected.effects.map((effect, index) => <p key={`${effect}-${index}`}>{effectText(selected, index)}</p>)}
              </div>
            ) : null}
            <p className="confidence"><Check aria-hidden="true" /> 名称、等级、强化与恩宠已经过当前样本验证</p>
          </aside>
        ) : (
          <aside className="gear-detail gear-detail-empty" aria-live="polite">
            <p>{SLOT_NAMES[selectedSlot] ?? "装备槽位"}</p>
            <h2>未装备</h2>
            <div className="empty-slot-mark">空</div>
            <p>最新存档中的装备标记显示这个槽位为空。</p>
            <p className="confidence"><Check aria-hidden="true" /> 空槽不会从仓库物品中猜测填充</p>
          </aside>
        )}
      </section>
    </div>
  );
}

function EquipmentInventoryView({ snapshot }: { snapshot: SaveSnapshot }) {
  const items = snapshot.equipmentInventory ?? [];
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [type, setType] = useState("全部");
  const [rarity, setRarity] = useState("全部");
  const [sort, setSort] = useState("slot");
  const [visibleLimit, setVisibleLimit] = useState(60);
  const types = useMemo(() => [...new Set(items.map((item) => item.type))].sort((a, b) => localizeItemType(a).localeCompare(localizeItemType(b), "zh-CN")), [items]);
  const rarities = useMemo(() => [...new Set(items.map((item) => item.rarity))], [items]);
  const graceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const localized = localizeSetOrGrace(item.setOrGrace);
      if (!item.setOrGrace || item.setOrGrace === "未识别套装" || localized.startsWith("未识别")) continue;
      counts.set(localized, (counts.get(localized) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 8);
  }, [items]);
  const visibleItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase("zh-CN");
    const filtered = items.filter((item) => {
      if (type !== "全部" && item.type !== type) return false;
      if (rarity !== "全部" && item.rarity !== rarity) return false;
      if (!normalized) return true;
      const searchable = [
        localizeItemName(item.id, item.nameZh),
        item.id,
        localizeSetOrGrace(item.setOrGrace),
        ...(item.effects ?? []).map((_, index) => effectText(item, index)),
      ].join(" ").toLocaleLowerCase("zh-CN");
      return searchable.includes(normalized);
    });
    return [...filtered].sort((a, b) => {
      if (sort === "plus") return b.plus - a.plus || b.level - a.level || a.recordIndex - b.recordIndex;
      if (sort === "level") return b.level - a.level || b.plus - a.plus || a.recordIndex - b.recordIndex;
      if (sort === "name") return localizeItemName(a.id, a.nameZh).localeCompare(localizeItemName(b.id, b.nameZh), "zh-CN") || a.recordIndex - b.recordIndex;
      return a.recordIndex - b.recordIndex;
    });
  }, [deferredQuery, items, rarity, sort, type]);
  const shownItems = visibleItems.slice(0, visibleLimit);
  useEffect(() => setVisibleLimit(60), [query, rarity, sort, type]);

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">武具藏</p><h1>装备仓库</h1><p>浏览存档中的武器、防具、饰品与魂核。名称、等级、强化和已识别词条来自独立解密副本，全程只读。</p></section>
      {items.length === 0 ? (
        <section className="notice-panel"><CircleAlert aria-hidden="true" /><div><strong>该历史快照尚未包含装备仓库</strong><p>使用 0.7.0 或更新的解析器读取存档后即可查看。</p></div></section>
      ) : (
        <>
          {graceCounts.length > 0 ? (
            <section className="grace-overview" aria-label="仓库恩宠盘点">
              <header><div><span>构筑储备</span><h2>仓库恩宠盘点</h2></div><p>点击恩宠可立即筛出对应装备；数量按已解析的装备记录统计。</p></header>
              <div>{graceCounts.map(([name, count]) => <button type="button" key={name} onClick={() => { setQuery(name); setType("全部"); setRarity("全部"); }}><span>{name}</span><strong>{count}</strong></button>)}</div>
            </section>
          ) : null}
          <section className="equipment-toolbar" aria-label="装备筛选">
            <label className="inventory-search"><Search aria-hidden="true" /><span className="sr-only">搜索装备</span><input aria-label="搜索装备" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、编号、恩宠或词条" /></label>
            <label><span>装备类别</span><select aria-label="装备类别" value={type} onChange={(event) => setType(event.target.value)}><option value="全部">全部类别</option>{types.map((itemType) => <option key={itemType} value={itemType}>{localizeItemType(itemType)}</option>)}</select></label>
            <label><span>稀有度</span><select aria-label="稀有度" value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="全部">全部稀有度</option>{rarities.map((itemRarity) => <option key={itemRarity} value={itemRarity}>{localizeRarity(itemRarity)}</option>)}</select></label>
            <label><span>排列方式</span><select aria-label="装备排列方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="slot">存档槽位顺序</option><option value="plus">强化值从高到低</option><option value="level">等级从高到低</option><option value="name">中文名称</option></select></label>
            <div className="equipment-tally"><span>筛选结果</span><strong>{visibleItems.length}</strong><small>共解析 {items.length} 件装备</small></div>
          </section>
          {visibleItems.length > 0 ? <section className="equipment-grid" aria-label="装备仓库清单">{shownItems.map((item: EquipmentItem) => {
            const effects = (item.effects ?? []).map((_, index) => effectText(item, index));
            return <article key={item.recordIndex}><header><span>{localizeItemType(item.type)} · 槽位 {String(item.recordIndex + 1).padStart(3, "0")}</span><strong>{localizeRarity(item.rarity)}</strong></header><h2>{localizeItemName(item.id, item.nameZh)}</h2><code>{item.id}</code><dl><div><dt>等级</dt><dd>{item.level}</dd></div><div><dt>强化</dt><dd>+{item.plus}</dd></div></dl>{item.setOrGrace !== "未识别套装" ? <p className="equipment-grace">{localizeSetOrGrace(item.setOrGrace)}</p> : null}{effects.length > 0 ? <div className="equipment-effects">{effects.slice(0, 3).map((effect, index) => <span key={`${effect}-${index}`}>{effect}</span>)}{effects.length > 3 ? <small>另有 {effects.length - 3} 条词条</small> : null}</div> : null}</article>;
          })}</section> : <section className="inventory-empty"><Search aria-hidden="true" /><strong>没有匹配的装备</strong><p>换一个中文名称、编号、恩宠或词条试试。</p></section>}
          {shownItems.length < visibleItems.length ? <button className="inventory-more" type="button" onClick={() => setVisibleLimit((current) => current + 60)}>再显示 {Math.min(60, visibleItems.length - shownItems.length)} 项<small>已显示 {shownItems.length} / {visibleItems.length}</small></button> : null}
          <p className="inventory-note"><ShieldCheck aria-hidden="true" /> 已验证的平面数值与百分比会显示；字母等级和部分魂核专用字段仍保守留空。</p>
        </>
      )}
    </div>
  );
}

function InventoryView({ snapshot }: { snapshot: SaveSnapshot }) {
  const items = snapshot.inventoryItems ?? [];
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [type, setType] = useState("全部");
  const [sort, setSort] = useState("slot");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const types = useMemo(
    () => [...new Set(items.map((item) => item.type))].sort((a, b) => localizeItemType(a).localeCompare(localizeItemType(b), "zh-CN")),
    [items],
  );
  const visibleItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase("zh-CN");
    const filtered = items.filter((item) => {
      if (type !== "全部" && item.type !== type) return false;
      const name = localizeItemName(item.id, item.nameZh);
      return !normalized || name.toLocaleLowerCase("zh-CN").includes(normalized) || item.id.toLowerCase().includes(normalized);
    });
    return [...filtered].sort((a, b) => {
      if (sort === "quantity") return b.quantity - a.quantity || a.recordIndex - b.recordIndex;
      if (sort === "name") return localizeItemName(a.id, a.nameZh).localeCompare(localizeItemName(b.id, b.nameZh), "zh-CN") || a.recordIndex - b.recordIndex;
      return a.recordIndex - b.recordIndex;
    });
  }, [deferredQuery, items, sort, type]);
  const totalQuantity = useMemo(() => visibleItems.reduce((sum, item) => sum + item.quantity, 0), [visibleItems]);
  const uniqueItemCount = useMemo(() => new Set(visibleItems.map((item) => item.id)).size, [visibleItems]);
  const shownItems = visibleItems.slice(0, visibleLimit);
  useEffect(() => setVisibleLimit(80), [query, sort, type]);

  async function handleCopyInventory() {
    const merged = new Map<string, { name: string; quantity: number }>();
    for (const item of visibleItems) {
      const current = merged.get(item.id);
      merged.set(item.id, {
        name: localizeItemName(item.id, item.nameZh),
        quantity: (current?.quantity ?? 0) + item.quantity,
      });
    }
    const heading = type === "全部" ? "全部类别" : localizeItemType(type);
    const lines = [...merged.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "zh-CN"))
      .map(([id, item]) => `${item.name} × ${formatNumber(item.quantity)}（${id}）`);
    const copied = await writeTextToClipboard([
      `《仁王2》随身物品｜${heading}${query.trim() ? `｜搜索：${query.trim()}` : ""}`,
      `${merged.size} 种物品｜合计 ${formatNumber(totalQuantity)} 件`,
      "",
      ...lines,
      "",
      `快照：${snapshot.snapshotId}（本地只读解析）`,
    ].join("\n"));
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2400);
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">行囊簿</p><h1>随身物品</h1><p>读取存档中的堆叠物品槽位，可按官方中文名或物品编号查找。这里只展示，不会修改数量。</p></section>
      <section className="inventory-toolbar" aria-label="物品筛选">
        <label className="inventory-search"><Search aria-hidden="true" /><span className="sr-only">搜索物品</span><input aria-label="搜索物品" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索中文名或编号" /></label>
        <label><span>物品类别</span><select aria-label="物品类别" value={type} onChange={(event) => setType(event.target.value)}><option value="全部">全部类别</option>{types.map((itemType) => <option key={itemType} value={itemType}>{localizeItemType(itemType)}</option>)}</select></label>
        <label><span>排列方式</span><select aria-label="排列方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="slot">存档槽位顺序</option><option value="name">中文名称</option><option value="quantity">数量从多到少</option></select></label>
        <div className="inventory-tally"><span>当前槽位</span><strong>{visibleItems.length}</strong><small>{uniqueItemCount} 种物品 · 共 {formatNumber(totalQuantity)} 件</small></div>
      </section>
      {items.length > 0 && visibleItems.length > 0 ? (
        <section className="inventory-share">
          <div><span>交流清单</span><strong>按编号合并当前筛选结果</strong><p>只写入本机剪贴板，不会上传任何存档数据。</p></div>
          <button type="button" onClick={() => void handleCopyInventory()}>{copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : `复制 ${uniqueItemCount} 种物品`}</button>
        </section>
      ) : null}
      {items.length === 0 ? (
        <section className="notice-panel"><CircleAlert aria-hidden="true" /><div><strong>该历史快照尚未包含物品清单</strong><p>点击“读取存档”生成新版快照后即可查看。</p></div></section>
      ) : visibleItems.length === 0 ? (
        <section className="inventory-empty"><Search aria-hidden="true" /><strong>没有匹配的物品</strong><p>换一个中文名称、编号或类别试试。</p></section>
      ) : (
        <section className="inventory-grid" aria-label="物品清单">
          {shownItems.map((item) => (
            <article key={item.recordIndex}>
              <div className="inventory-item-index">{String(item.recordIndex + 1).padStart(3, "0")}</div>
              <div><span>{localizeItemType(item.type)}</span><h2>{localizeItemName(item.id, item.nameZh)}</h2><code>{item.id}</code></div>
              <strong>× {formatNumber(item.quantity)}</strong>
            </article>
          ))}
        </section>
      )}
      {shownItems.length < visibleItems.length ? (
        <button className="inventory-more" type="button" onClick={() => setVisibleLimit((current) => current + 80)}>
          再显示 {Math.min(80, visibleItems.length - shownItems.length)} 项
          <small>已显示 {shownItems.length} / {visibleItems.length}</small>
        </button>
      ) : null}
      <p className="inventory-note"><ShieldCheck aria-hidden="true" /> 共解析 {items.length} 个已占用槽位；数量来自独立解密副本。</p>
    </div>
  );
}

function ScrollsView({ snapshot }: { snapshot: SaveSnapshot }) {
  const scrolls = snapshot.scrolls ?? [];
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [copiedScroll, setCopiedScroll] = useState<number | null>(null);
  const normalized = deferredQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleScrolls = useMemo(() => scrolls.filter((scroll) => {
    if (!normalized) return true;
    const name = localizeItemName(scroll.id, scroll.nameZh);
    const effects = scroll.effects.map((_, index) => effectText(scroll, index));
    return name.toLocaleLowerCase("zh-CN").includes(normalized)
      || scroll.id.toLowerCase().includes(normalized)
      || effects.some((effect) => effect.toLocaleLowerCase("zh-CN").includes(normalized));
  }), [normalized, scrolls]);
  const damnedCount = scrolls.filter((scroll) => scroll.id === "DEA7").length;
  const niohCount = scrolls.filter((scroll) => scroll.id === "F40C").length;

  async function handleCopyScroll(recordIndex: number) {
    const scroll = scrolls.find((item) => item.recordIndex === recordIndex);
    if (!scroll) return;
    const effects = scroll.effects.map((_, index) => effectText(scroll, index));
    const text = [
      `${localizeItemName(scroll.id, scroll.nameZh)}｜等级 ${scroll.level}｜${localizeRarity(scroll.rarity)}`,
      `剩余挑战 ${scroll.attemptsRemaining} 次`,
      `词条：${effects.join("、")}`,
    ].join("\n");
    if (await writeTextToClipboard(text)) {
      setCopiedScroll(recordIndex);
      window.setTimeout(() => setCopiedScroll(null), 2400);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">绘卷簿</p><h1>百鬼绘卷</h1><p>查看存档中的绘卷等级、剩余挑战次数与已识别词条。数据来自独立解密副本，全程只读。</p></section>
      {scrolls.length === 0 ? (
        <section className="notice-panel"><CircleAlert aria-hidden="true" /><div><strong>该历史快照尚未包含绘卷详情</strong><p>点击“读取存档”生成新版快照后即可查看。</p></div></section>
      ) : (
        <>
          <section className="scroll-summary" aria-label="绘卷概况">
            <article><span>绘卷总数</span><strong>{scrolls.length}</strong><small>已占用槽位</small></article>
            <article><span>地狱绘卷</span><strong>{damnedCount}</strong><small>百鬼夜行绘卷·地狱</small></article>
            <article><span>仁王绘卷</span><strong>{niohCount}</strong><small>百鬼夜行绘卷·仁王</small></article>
          </section>
          <label className="scroll-search"><Search aria-hidden="true" /><span className="sr-only">搜索绘卷</span><input aria-label="搜索绘卷" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索绘卷名称、编号或词条" /><strong>{visibleScrolls.length} / {scrolls.length}</strong></label>
          {visibleScrolls.length ? (
            <section className="scroll-grid" aria-label="绘卷清单">
              {visibleScrolls.map((scroll) => (
                <article key={scroll.recordIndex}>
                  <header><div><span>槽位 {String(scroll.recordIndex + 1).padStart(3, "0")} · {localizeRarity(scroll.rarity)}</span><h2>{localizeItemName(scroll.id, scroll.nameZh)}</h2></div><strong>等级 {scroll.level}</strong></header>
                  <div className="scroll-effects">{scroll.effects.map((effect, index) => <p key={`${effect}-${index}`}>{effectText(scroll, index)}</p>)}</div>
                  <footer><code>{scroll.id}</code><span>剩余挑战 {scroll.attemptsRemaining} 次</span><button type="button" onClick={() => void handleCopyScroll(scroll.recordIndex)}>{copiedScroll === scroll.recordIndex ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copiedScroll === scroll.recordIndex ? "已复制" : "复制摘要"}</button></footer>
                </article>
              ))}
            </section>
          ) : (
            <section className="inventory-empty"><Search aria-hidden="true" /><strong>没有匹配的绘卷</strong><p>可以按中文名称、编号或词条继续查找。</p></section>
          )}
        </>
      )}
      <p className="inventory-note"><ShieldCheck aria-hidden="true" /> 已验证的平面数值与百分比会显示；锁定状态与字母等级仍待验证。</p>
    </div>
  );
}

function HistoryView({ snapshot, snapshots }: { snapshot: SaveSnapshot; snapshots: SnapshotSummary[] }) {
  const currentIndex = snapshots.findIndex((item) => item.snapshotId === snapshot.snapshotId);
  const candidates = currentIndex >= 0 ? snapshots.slice(currentIndex + 1) : [];
  const defaultPreviousId = candidates[0]?.snapshotId ?? "";
  const [previousId, setPreviousId] = useState(defaultPreviousId);
  const [previous, setPrevious] = useState<SaveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => setPreviousId(defaultPreviousId), [defaultPreviousId, snapshot.snapshotId]);

  useEffect(() => {
    if (!previousId) {
      setPrevious(null);
      setLoadError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    loadSnapshot(previousId, controller.signal)
      .then(setPrevious)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLoadError("无法读取上一份历史快照。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [previousId]);

  const comparison = useMemo(() => previous ? diffSnapshots(snapshot, previous) : null, [previous, snapshot]);
  const hasChanges = comparison
    ? comparison.resources.some((item) => item.delta !== 0) || comparison.attributes.length > 0 || comparison.inventory.length > 0 || comparison.loadout.length > 0 || comparison.scrollDelta !== 0
    : false;
  const resourceNames: Record<string, string> = { level: "人物等级", amrita: "持有精华", gold: "持有金钱" };

  async function handleCopyComparison() {
    if (!previous || !comparison) return;
    const lines = [
      "《仁王2》存档变化摘要",
      `${previous.snapshotId} → ${snapshot.snapshotId}`,
      "",
    ];
    const resourceChanges = comparison.resources.filter((item) => item.delta !== 0);
    if (!hasChanges) {
      lines.push("可比较字段没有变化。\n");
    } else {
      for (const item of resourceChanges) lines.push(`${resourceNames[item.key]}：${formatNumber(item.before)} → ${formatNumber(item.after)}（${item.delta > 0 ? "+" : ""}${formatNumber(item.delta)}）`);
      if (comparison.scrollDelta !== 0) lines.push(`绘卷数量：${previous.scrolls?.length ?? previous.inventorySummary.scrollRecordsDetected} → ${snapshot.scrolls?.length ?? snapshot.inventorySummary.scrollRecordsDetected}（${comparison.scrollDelta > 0 ? "+" : ""}${comparison.scrollDelta}）`);
      for (const item of comparison.attributes) lines.push(`${ATTRIBUTE_NAMES[item.key as AttributeKey] ?? item.key}：${item.before} → ${item.after}（${item.delta > 0 ? "+" : ""}${item.delta}）`);
      for (const item of comparison.loadout) lines.push(`${SLOT_NAMES[item.after?.slot ?? item.before?.slot ?? ""] ?? `槽位 ${item.equipIndex + 1}`}：${item.before ? localizeItemName(item.before.id, item.before.nameZh) : "空"} → ${item.after ? localizeItemName(item.after.id, item.after.nameZh) : "空"}`);
      for (const item of comparison.inventory.slice(0, 50)) lines.push(`${localizeItemName(item.id, item.nameZh)}：${formatNumber(item.before)} → ${formatNumber(item.after)}（${item.delta > 0 ? "+" : ""}${formatNumber(item.delta)}）`);
      if (comparison.inventory.length > 50) lines.push(`另有 ${comparison.inventory.length - 50} 种物品变化未列出。`);
    }
    if (!comparison.inventoryComparable) lines.push("物品差异：旧快照缺少详情，未比较。\n");
    lines.push("本摘要由本地只读快照生成，不含原始存档文件。");
    const copied = await writeTextToClipboard(lines.join("\n"));
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2400);
  }

  function handleExportComparison() {
    if (!previous) return;
    const report = createResearchDiff(snapshot, previous);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nioh2-diff-${previous.snapshotId}-${snapshot.snapshotId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">时间轴</p><h1>快照对比</h1><p>将当前选择的快照与它之前的一份记录比较，只展示解析器能够可靠说明的变化。</p></section>
      {candidates.length > 0 ? <label className="history-baseline"><span>对比基准</span><select aria-label="对比基准" value={previousId} onChange={(event) => setPreviousId(event.target.value)}>{candidates.map((item, index) => <option key={item.snapshotId} value={item.snapshotId}>{index === 0 ? "上一份 · " : ""}{item.researchLabel ? `${item.researchLabel} · ` : ""}{item.snapshotId} · 等级 {item.level ?? "—"}</option>)}</select><small>可选择任意一份更早的结构化快照。</small></label> : null}
      {!previousId ? (
        <section className="notice-panel"><History aria-hidden="true" /><div><strong>没有更早的快照可供比较</strong><p>读取两次存档后，这里会自动生成变化记录。</p></div></section>
      ) : loading ? (
        <section className="notice-panel"><RefreshCw className="spinning" aria-hidden="true" /><div><strong>正在读取上一份快照</strong><p>{previousId}</p></div></section>
      ) : loadError ? (
        <section className="notice-panel"><CircleAlert aria-hidden="true" /><div><strong>{loadError}</strong><p>可以从页面底部重新选择快照。</p></div></section>
      ) : previous && comparison ? (
        <>
          <section className="history-pair" aria-label="对比时间范围">
            <div><span>上一份</span><strong>{previous.snapshotId}</strong><small>{new Date(previous.sourceLastWriteLocal).toLocaleString("zh-CN")}</small></div>
            <ChevronRight aria-hidden="true" />
            <div><span>当前</span><strong>{snapshot.snapshotId}</strong><small>{new Date(snapshot.sourceLastWriteLocal).toLocaleString("zh-CN")}</small></div>
          </section>
          <section className="inventory-share history-share">
            <div><span>交流摘要</span><strong>复制这两份快照之间的可靠变化</strong><p>仅写入本机剪贴板，不包含原始存档文件。</p></div>
            <div className="history-share-actions"><button type="button" onClick={handleExportComparison}><Download aria-hidden="true" />下载差分报告</button><button type="button" onClick={() => void handleCopyComparison()}>{copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制变化摘要"}</button></div>
          </section>
          {previous.schemaVersion !== snapshot.schemaVersion ? <p className="history-schema-note"><CircleAlert aria-hidden="true" /> 数据结构版本不同，只比较两边都存在的字段：{previous.schemaVersion} → {snapshot.schemaVersion}</p> : null}
          <section className="history-resource-grid" aria-label="资源变化">
            {comparison.resources.map((item) => <article key={item.key}><span>{resourceNames[item.key]}</span><strong className={item.delta > 0 ? "gain" : item.delta < 0 ? "loss" : "steady"}>{item.delta > 0 ? "+" : ""}{formatNumber(item.delta)}</strong><small>{formatNumber(item.before)} → {formatNumber(item.after)}</small></article>)}
            <article><span>绘卷数量</span><strong className={comparison.scrollDelta > 0 ? "gain" : comparison.scrollDelta < 0 ? "loss" : "steady"}>{comparison.scrollDelta > 0 ? "+" : ""}{comparison.scrollDelta}</strong><small>{previous.scrolls?.length ?? previous.inventorySummary.scrollRecordsDetected} → {snapshot.scrolls?.length ?? snapshot.inventorySummary.scrollRecordsDetected}</small></article>
          </section>
          {!hasChanges ? <section className="history-no-change"><Check aria-hidden="true" /><div><strong>可比较字段没有变化</strong><p>{comparison.inventoryComparable ? "两份快照在人物资源、能力、装备、物品与绘卷数量上完全一致。" : "人物资源、能力、装备与绘卷数量没有变化；物品因旧结构缺失而未比较。"}</p></div></section> : null}
          {comparison.attributes.length > 0 ? <section className="history-change-section"><header><span>能力变化</span><strong>{comparison.attributes.length} 项</strong></header><div className="history-attribute-list">{comparison.attributes.map((item) => <p key={item.key}><b>{ATTRIBUTE_NAMES[item.key as AttributeKey] ?? item.key}</b><span>{item.before} → {item.after}</span><em>{item.delta > 0 ? "+" : ""}{item.delta}</em></p>)}</div></section> : null}
          {comparison.loadout.length > 0 ? <section className="history-change-section"><header><span>装备变化</span><strong>{comparison.loadout.length} 个槽位</strong></header><div className="history-loadout-list">{comparison.loadout.map((item) => <article key={item.equipIndex}><b>{SLOT_NAMES[item.after?.slot ?? item.before?.slot ?? ""] ?? `槽位 ${item.equipIndex + 1}`}</b><span>{item.before ? localizeItemName(item.before.id, item.before.nameZh) : "空"}</span><ChevronRight aria-hidden="true" /><span>{item.after ? localizeItemName(item.after.id, item.after.nameZh) : "空"}</span></article>)}</div></section> : null}
          {comparison.inventoryComparable && comparison.inventory.length > 0 ? <section className="history-change-section"><header><span>物品数量变化</span><strong>{comparison.inventory.length} 种</strong></header><div className="history-inventory-list">{comparison.inventory.slice(0, 100).map((item) => <p key={item.id}><span>{localizeItemName(item.id, item.nameZh)}<code>{item.id}</code></span><small>{formatNumber(item.before)} → {formatNumber(item.after)}</small><em className={item.delta > 0 ? "gain" : "loss"}>{item.delta > 0 ? "+" : ""}{formatNumber(item.delta)}</em></p>)}</div>{comparison.inventory.length > 100 ? <small className="history-truncated">仅显示变化量最大的前 100 种物品。</small> : null}</section> : null}
          {!comparison.inventoryComparable ? <section className="notice-panel"><CircleAlert aria-hidden="true" /><div><strong>旧快照没有物品详情</strong><p>为避免把字段缺失误认为物品减少，本次不计算物品差异。</p></div></section> : null}
        </>
      ) : null}
    </div>
  );
}

function ProgressView({ snapshot, refreshing, onCapture }: { snapshot: SaveSnapshot; refreshing: boolean; onCapture: (label: string) => Promise<void> }) {
  const future = ["任务与周目", "奈落狱与深部", "木灵与温泉", "遗发与称号", "武家与贡献", "技能树节点"];
  const proficiencyEntries = Object.entries(snapshot.character.proficiency);
  const trainedDisciplines = proficiencyEntries.filter(([, value]) => value > 0).length;
  const skillPointEntries = Object.entries(snapshot.character.skillPointCounters ?? {});
  const coverage = calculateCoverage(snapshot);
  const coverageNames = { equipmentNames: "装备中文名", inventoryNames: "物品中文名", effects: "词条中文名", effectMagnitudes: "词条数值" } as const;
  const [researchLabel, setResearchLabel] = useState("");
  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">旅途簿</p><h1>旅途进度</h1><p>已验证的成长记录与仍待映射的进度字段分开展示，不会把未知字节伪装成准确进度。</p></section>
      <ExperimentalScrollPanel snapshot={snapshot} />
      <section className="verified-progress" aria-label="已验证的成长记录">
        <article><span>已解析</span><strong>{proficiencyEntries.length}</strong><h2>修行熟练度</h2><p>{trainedDisciplines} 类已有修行记录，包含武器、忍术与阴阳术。</p></article>
        <article><span>已解析</span><strong>{snapshot.inventorySummary.scrollRecordsDetected}</strong><h2>绘卷记录</h2><p>已读取名称、等级、剩余挑战次数与已识别词条。</p></article>
        <article><span>已索引</span><strong>{snapshot.inventorySummary.stackedItemRecords}</strong><h2>堆叠物品</h2><p>可作为后续收集品差分研究的基线。</p></article>
      </section>
      <section className="coverage-panel" aria-label="数据解析覆盖率">
        <header><div><span>透明度报告</span><h2>数据解析覆盖率</h2></div><p>名称统计中文目录匹配；数值只统计有已验证编码的词条，不包含条件、未知档位或待复核单位，不代表最终人物面板的完成率。</p></header>
        <div className="coverage-grid">
          {coverage.map((item) => (
            <article key={item.key}>
              <div><span>{coverageNames[item.key]}</span><strong>{item.percent}%</strong></div>
              <div className="coverage-track"><i style={{ width: `${item.percent}%` }} /></div>
              <small>{item.verified} / {item.total} 个字段已识别</small>
            </article>
          ))}
        </div>
      </section>
      {skillPointEntries.length > 0 ? (
        <section className="skill-point-panel" aria-label="技能点研究计数">
          <div className="skill-point-heading">
            <div><span>研究字段</span><h2>技能点计数</h2></div>
            <p>“临时 / 永久”为社区字段名，尚不能直接等同于可用点数。</p>
          </div>
          <div className="skill-point-grid">
            {skillPointEntries.map(([name, value]) => (
              <article key={name}>
                <strong>{localizeProficiency(name)}</strong>
                <dl><div><dt>临时</dt><dd>{value.temporary}</dd></div><div><dt>永久</dt><dd>{value.permanent}</dd></div></dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {snapshot.backupComparison ? (
        <section className="backup-lab" aria-label="备份副本自测">
          <header><div><span>副本实验室</span><h2>自动备份自测</h2></div><strong>{snapshot.backupComparison.copyHashesUnchangedAfterParsing === false ? "校验失败" : "只读校验通过"}</strong></header>
          <p>电脑端读取时同时比较游戏的 BACKUP.BIN 与当前 SAVEDATA.BIN；两份文件都只在独立解密副本上分析。</p>
          <div>
            <article><span>变化字节</span><strong>{formatNumber(snapshot.backupComparison.binaryChangedBytes ?? 0)}</strong><small>合并为 {formatNumber(snapshot.backupComparison.binaryChangedRanges ?? 0)} 个区域</small></article>
            <article><span>装备槽标记</span><strong>{snapshot.backupComparison.loadoutChanged ? "有变化" : "无变化"}</strong><small>用于判断游戏是否真正写入装备状态</small></article>
            <article><span>物品数量</span><strong>{snapshot.backupComparison.inventoryChanged ? "有变化" : "无变化"}</strong><small>用于后续定位收集品与消耗品字段</small></article>
          </div>
          {snapshot.backupComparison.inventoryQuantityChanges?.length ? (
            <section className="backup-changes" aria-label="备份以来的物品变化">
              <h3>备份以来的物品变化</h3>
              <p>按物品编号汇总；正数表示当前存档比 BACKUP.BIN 更多。</p>
              <ul>{snapshot.backupComparison.inventoryQuantityChanges.map((item) => <li key={item.id}><span>{item.nameZh ?? `未翻译物品（编号 ${item.id}）`}</span><code>{formatNumber(item.before)} → {formatNumber(item.after)}</code><strong className={item.delta > 0 ? "gain" : "loss"}>{item.delta > 0 ? "+" : ""}{formatNumber(item.delta)}</strong></li>)}</ul>
            </section>
          ) : null}
        </section>
      ) : null}
      <section className="research-capture" aria-label="建立受控研究快照">
        <div><span>差分采样</span><h2>建立受控研究快照</h2><p>一次只改变一个游戏状态，并分别读取“前 / 后”快照。标签只进入结构化研究记录。</p></div>
        <label><span className="sr-only">研究快照标签</span><input aria-label="研究快照标签" maxLength={80} value={researchLabel} onChange={(event) => setResearchLabel(event.target.value)} placeholder="例如：拾取木灵前" /></label>
        <button type="button" disabled={refreshing || !researchLabel.trim()} onClick={() => void onCapture(researchLabel.trim())}><RefreshCw className={refreshing ? "spinning" : ""} aria-hidden="true" />{refreshing ? "正在读取" : "读取并标记"}</button>
      </section>
      <div className="research-heading"><span>研究队列</span><p>需要控制变量样本才能确认</p></div>
      <section className="research-board">
        {future.map((name, index) => (
          <article key={name}>
            <span>{String(index + 1).padStart(2, "0")}</span><div><h2>{name}</h2><p>等待多样本差分与回归验证</p></div><span className="research-state"><CircleAlert aria-hidden="true" />研究中</span>
          </article>
        ))}
      </section>
      <section className="notice-panel"><CloudOff aria-hidden="true" /><div><strong>离线优先</strong><p>进度模块完成前，应用仍可完整查看角色基础数据和当前构筑。</p></div></section>
    </div>
  );
}


function InstallView({ installPrompt, onInstall }: { installPrompt: BeforeInstallPromptEvent | null; onInstall: () => Promise<void> }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installed, setInstalled] = useState(() => window.matchMedia?.("(display-mode: standalone)").matches || Boolean((navigator as NavigatorWithStandalone).standalone));
  const [cachedSnapshotCount, setCachedSnapshotCount] = useState(0);
  const [installState, setInstallState] = useState<"idle" | "opening" | "dismissed">("idle");
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isLocalhost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const secureForInstall = window.isSecureContext || isLocalhost;

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const updateInstalled = () => setInstalled(true);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("appinstalled", updateInstalled);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("appinstalled", updateInstalled);
    };
  }, []);

  useEffect(() => {
    const updateCount = () => { void loadCachedSnapshotIndex().then((items) => setCachedSnapshotCount(items.length)); };
    updateCount();
    window.addEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, updateCount);
    return () => window.removeEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, updateCount);
  }, []);

  async function handleInstall() {
    setInstallState("opening");
    await onInstall();
    setInstallState("dismissed");
  }

  const steps = isIos
    ? ["用 Safari 打开正式的 HTTPS 地址。", "点底部分享按钮。", "选择“添加到主屏幕”。"]
    : ["用 Chrome 或 Edge 打开应用。", "点击下方安装按钮或浏览器地址栏的安装图标。", "安装后可像普通 App 一样从桌面启动。"];

  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">iPhone 随身卷轴</p><h1>安装应用</h1><p>电脑只负责解析和生成角色档案包。档案包进入 iPhone 后，关闭电脑、离开家庭 Wi‑Fi，也能继续查看与分享。</p></section>
      <section className="install-hero">
        <div className="install-mark"><AppWindow aria-hidden="true" /><span>可安装状态</span><strong>{installed ? "已经安装" : installPrompt ? "可以安装" : secureForInstall ? "等待浏览器" : "需要 HTTPS"}</strong></div>
        <div className="install-copy">
          <span>渐进式网页应用 · PWA</span>
          <h2>{installed ? "存档伴侣已在这台设备上安家" : "把角色档案装进口袋"}</h2>
          <p>{installed ? "你可以从桌面、开始菜单或手机主屏幕启动。" : "安装不会复制原始存档，也不会获得 Steam 密码或系统写入权限。"}</p>
          {!installed && installPrompt ? <button type="button" onClick={() => void handleInstall()} disabled={installState === "opening"}><MonitorDown aria-hidden="true" />{installState === "opening" ? "正在打开…" : installState === "dismissed" ? "再次尝试安装" : "安装到这台设备"}</button> : null}
        </div>
      </section>
      <section className="install-status" aria-label="应用能力检查">
        <article className={secureForInstall ? "ready" : "pending"}><span>01</span><strong>{secureForInstall ? "安全来源就绪" : "等待 HTTPS"}</strong><p>{isLocalhost ? "电脑本机地址可直接测试安装。" : secureForInstall ? "当前地址满足浏览器安装要求。" : "局域网 HTTP 地址只能测试功能，不能正式安装。"}</p></article>
        <article className={"serviceWorker" in navigator ? "ready" : "pending"}><span>02</span><strong>{"serviceWorker" in navigator ? "离线外壳可用" : "浏览器不支持离线外壳"}</strong><p>页面、样式和图标会完整保存在设备上；原始游戏存档不会进入浏览器缓存。</p></article>
        <article className={cachedSnapshotCount > 0 ? "ready" : "pending"}><span>03</span><strong>{cachedSnapshotCount > 0 ? `已保存 ${cachedSnapshotCount} 份角色档案` : "等待导入角色档案"}</strong><p>点击顶部“导入档案包”即可从 iPhone“文件”中选择；导入后会长期保留在本机。</p></article>
        <article className={online ? "ready" : "pending"}><span>04</span><strong>{online ? "当前已联网" : "离线查看已就绪"}</strong><p>{online ? "现在可以安装、导入或更新档案。" : cachedSnapshotCount > 0 ? "可以继续查看已保存的角色和配装。" : "尚未保存角色档案。"}</p></article>
      </section>
      {isIos ? <section className="iphone-route"><header><span>iPhone 首版数据路线</span><h2>电脑导出一次，手机便可独立保存</h2></header><ol><li><b>电脑</b><strong>读取真实存档</strong><small>只读副本解析，不改动 SAVEDATA.BIN。</small></li><li><b>电脑</b><strong>导出档案包</strong><small>包含角色、装备仓库、物品、绘卷与已收藏配装。</small></li><li><b>传输</b><strong>发送到 iPhone“文件”</strong><small>可用 iCloud Drive、聊天软件文件传输或数据线。</small></li><li><b>iPhone</b><strong>导入并离线使用</strong><small>之后无需让电脑保持开机，也不依赖同一 Wi‑Fi。</small></li></ol></section> : null}
      {!installed && !installPrompt ? <section className="install-guide"><div><span>{isIos ? "iPhone / iPad" : "手动安装"}</span><h2>{isIos ? "Safari 不显示自动安装按钮" : "浏览器尚未提供安装按钮"}</h2><p>{secureForInstall ? "按下面步骤操作；若刚打开页面，可稍等几秒或刷新一次。" : "当前是局域网 HTTP 测试地址。正式手机安装需要后续提供 HTTPS 地址或原生封装。"}</p></div><ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol></section> : null}
      <section className="notice-panel"><ShieldCheck aria-hidden="true" /><div><strong>安装不改变只读边界</strong><p>App 只读取结构化 JSON。存档复制、解密和解析仍在电脑上的独立副本中完成。</p></div></section>
    </div>
  );
}

export function SafetyView({ snapshot, agentStatus, sources, refreshing, onReadSource }: { snapshot: SaveSnapshot; agentStatus: AgentStatus | null; sources: SaveSourceOption[]; refreshing: boolean; onReadSource: (sourceId: string) => Promise<void> }) {
  const [cacheState, setCacheState] = useState<"idle" | "clearing" | "cleared" | "failed">("idle");
  const cacheAction = useRef(false);
  const [prefetchState, setPrefetchState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [cachedSnapshotCount, setCachedSnapshotCount] = useState(0);
  const [selectedSource, setSelectedSource] = useState(sources.find((item) => item.active)?.id ?? sources[0]?.id ?? "");
  useEffect(() => {
    setSelectedSource(sources.find((item) => item.active)?.id ?? sources[0]?.id ?? "");
  }, [sources]);
  useEffect(() => {
    const updateCount = () => { void loadCachedSnapshotIndex().then((items) => setCachedSnapshotCount(items.length)); };
    updateCount();
    window.addEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, updateCount);
    return () => window.removeEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, updateCount);
  }, [snapshot.snapshotId]);
  const checks = [
    ["源文件只读打开", snapshot.safety.sourceOpenedReadOnly],
    ["仅解析独立副本", snapshot.safety.parsedFromCopy],
    ["处理后原哈希不变", snapshot.safety.originalHashUnchangedAfterProcessing],
    ["不上传原始存档", true],
  ] as const;
  const cloudState = agentStatus?.steamCloud?.state;
  const cloudLabel = cloudState === "synchronized" ? "本机元数据一致" : cloudState === "local-newer" ? "本机存档较新" : cloudState === "cloud-newer" ? "缓存记录较新" : cloudState === "unknown" ? "状态待确认" : "未检测到";
  const unavailableMetadata = agentStatus ? "旧版服务未提供" : "当前不可用";
  async function downloadHistory() {
    if (cacheAction.current) return;
    cacheAction.current = true; setPrefetchState("saving"); setCacheState("idle");
    try { setCachedSnapshotCount(await cacheRecentSnapshots(20)); setPrefetchState("saved"); }
    catch { setPrefetchState("failed"); }
    finally { cacheAction.current = false; }
  }
  async function clearHistory() {
    if (cacheAction.current || !window.confirm("清除这台设备保存的全部离线结构化快照？不清除独立配装册，也不修改电脑上的游戏存档。当前页面会保留到关闭或刷新为止。")) return;
    cacheAction.current = true; setCacheState("clearing");
    try { await clearCachedSnapshot(); setCachedSnapshotCount(0); setCacheState("cleared"); setPrefetchState("idle"); }
    catch { setCacheState("failed"); }
    finally { cacheAction.current = false; }
  }
  return (
    <div className="page-stack">
      <section className="page-intro"><p className="eyebrow">校验记录</p><h1>安全记录</h1><p>每次快照都保留来源、哈希和解析版本，让“没有动过原档”成为可以验证的事实。</p></section>
      {snapshot.privacy?.redactedForSharing ? <section className="notice-panel"><ShieldCheck aria-hidden="true" /><div><strong>这是隐私处理后的分享副本</strong><p>原档与解析副本的 SHA-256 指纹已在导出时移除。</p></div></section> : null}
      <section className="safety-card">
        <div className="fingerprint"><Fingerprint aria-hidden="true" /><span>原档指纹（SHA-256）</span><code>{snapshot.safety.originalMainSaveSha256}</code></div>
        <div className="check-list">
          {checks.map(([name, passed]) => <div key={name}><span className={passed ? "pass" : "fail"}>{passed ? <Check /> : <X />}</span><strong>{name}</strong><em>{passed ? "通过" : "失败"}</em></div>)}
        </div>
      </section>
      <section className="safety-metadata" aria-label="解析版本">
        <div><span>快照编号</span><code>{snapshot.snapshotId}</code></div>
        <div><span>数据结构</span><code>{snapshot.schemaVersion}</code></div>
        <div><span>解析器</span><code>{snapshot.parserVersion ?? "旧版快照"}</code></div>
        <div><span>副本指纹</span><code>{snapshot.safety.snapshotCopySha256 ?? "旧版快照未记录"}</code></div>
      </section>
      <section className="agent-status" aria-label="电脑 Agent 状态">
        <div><span>电脑 Agent</span><strong>{agentStatus ? agentStatus.apiVersion ? `已连接 · API ${agentStatus.apiVersion}` : "已连接 · 兼容模式" : "当前不可用"}</strong></div>
        <div><span>存档来源</span><strong>{agentStatus?.source ? agentStatus.source.configured ? `Steam 账户 ${agentStatus.source.accountHint ?? "已识别"}` : "未配置" : unavailableMetadata}</strong></div>
        <div><span>角色槽位</span><strong>{agentStatus?.source ? agentStatus.source.saveSlots.length ? agentStatus.source.saveSlots.join("、") : "尚未发现" : unavailableMetadata}</strong></div>
        <div><span>最近写入</span><strong>{agentStatus?.source?.latestWriteLocal ? new Date(agentStatus.source.latestWriteLocal).toLocaleString("zh-CN") : "未知"}</strong></div>
        <div><span>本地保护副本</span><strong>{agentStatus?.backupCopies ? `${agentStatus.backupCopies.completeCopies} 份完整${agentStatus.backupCopies.incompleteCopies ? ` · ${agentStatus.backupCopies.incompleteCopies} 份未完成` : ""}` : unavailableMetadata}</strong></div>
        <div><span>Steam 本机元数据</span><strong>{agentStatus?.steamCloud ? cloudLabel : unavailableMetadata}</strong></div>
        <p>为保护隐私，手机端只显示账户尾号和槽位，不返回电脑上的完整存档路径。</p>
      </section>
      <section className="sync-chain" aria-label="存档来源诊断">
        <header><span>来源诊断</span><h2>本机存档、当前档案与 Steam 元数据</h2><p>Steam 元数据仅用于诊断，不是手机同步的中转站。手机接收以电脑主动发布为准，读取时间不能证明手机已保存。</p></header>
        <div>
          <article><MonitorDown aria-hidden="true" /><span>01 · 游戏本机存档</span><strong>{agentStatus?.source?.latestWriteLocal ? new Date(agentStatus.source.latestWriteLocal).toLocaleString("zh-CN") : "未检测到"}</strong><small>游戏实际写入磁盘</small></article>
          <i aria-hidden="true">·</i>
          <article><FileText aria-hidden="true" /><span>02 · 当前显示档案</span><strong>{new Date(snapshot.sourceLastWriteLocal).toLocaleString("zh-CN")}</strong><small>这份档案记录的来源存档时间</small></article>
          <i aria-hidden="true">·</i>
          <article><Wifi aria-hidden="true" /><span>03 · Steam 本机缓存元数据</span><strong>{agentStatus?.steamCloud ? cloudLabel : "当前不可用"}</strong><small>{agentStatus?.steamCloud?.lastRemoteWriteLocal ? new Date(agentStatus.steamCloud.lastRemoteWriteLocal).toLocaleString("zh-CN") : "不是云端实时查询"}</small></article>
        </div>
      </section>
      {sources.length > 0 ? (
        <section className="source-selector" aria-label="角色存档来源">
          <div><span>角色存档来源</span><strong>{sources.length} 个可读取槽位</strong><p>选择只会改变下一次读取所使用的来源；原始存档仍以只读方式复制后解析。</p></div>
          <label><span className="sr-only">选择角色槽位</span><select aria-label="选择角色槽位" value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>{sources.map((item) => <option key={item.id} value={item.id}>Steam {item.accountHint ?? "账户"} · {item.slot}{item.active ? " · 当前" : ""}</option>)}</select></label>
          <button type="button" disabled={!selectedSource || refreshing || !agentStatus?.refreshAvailable} onClick={() => void onReadSource(selectedSource)}><RefreshCw className={refreshing ? "spinning" : ""} aria-hidden="true" />{refreshing ? "读取中" : "读取所选槽位"}</button>
        </section>
      ) : null}
      <section className="local-data-control">
        <div className="local-data-copy"><span>设备离线副本</span><strong>{cachedSnapshotCount > 0 ? `${cachedSnapshotCount} 份已保存` : "尚无已保存快照"}</strong><p>浏览器最多保存最近实际打开过的 20 份结构化快照，供断网切换查看。这里不包含原始 SAVEDATA.BIN，但仍属于你的角色隐私数据。</p></div>
        <div className="local-data-actions">
          <button className="cache-recent" type="button" disabled={!agentStatus || prefetchState === "saving" || cacheState === "clearing"} onClick={() => void downloadHistory()}><Download aria-hidden="true" />{prefetchState === "saving" ? "正在保存…" : prefetchState === "saved" ? "最近快照已保存" : prefetchState === "failed" ? "保存失败，请重试" : "保存最近 20 份"}</button>
          <button className="clear-cache" type="button" disabled={cacheState === "clearing" || prefetchState === "saving"} onClick={() => void clearHistory()}><Trash2 aria-hidden="true" />{cacheState === "clearing" ? "正在清除…" : cacheState === "cleared" ? "离线副本已清除" : cacheState === "failed" ? "清除失败，重试" : "清除离线副本"}</button>
        </div>
        {cacheState === "failed" ? <p role="alert">离线副本未能清除，设备上可能仍有角色资料；请重试。</p> : null}
        {prefetchState === "failed" ? <p role="alert">历史档案未全部保存。已成功保存的仍保留，当前角色不会被历史下载切换。</p> : null}
      </section>
      <section className="limits"><h2>当前解析边界</h2>{snapshot.limitations.map((item) => <p key={item}>{localizeLimitation(item)}</p>)}</section>
    </div>
  );
}

export default function App() {
  const nativeApp = isNativeApp();
  const desktopMode = !nativeApp && !privateMobilePresentation();
  const [view, setView] = useState<ViewName>("overview");
  const [snapshot, setSnapshot] = useState<SaveSnapshot | null>(null);
  const remoteDisplayed = useRef(false);
  const acceptRemoteSnapshot = (next: SaveSnapshot | null) => {
    if (next === null) { if (remoteDisplayed.current) { setSnapshot(null); setArchiveInfo(null); } remoteDisplayed.current = false; return; }
    if (!isSupportedRemoteSnapshot(next)) return;
    remoteDisplayed.current = true; setSnapshot(next); setArchiveInfo(null); setError(''); setStartupFailed(false);
  };
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [startupFailed, setStartupFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [snapshotSource, setSnapshotSource] = useState<SnapshotLoadSource>("api");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const { agentStatus, refreshAgentStatus } = useAgentStatus(nativeApp);
  const [saveSources, setSaveSources] = useState<SaveSourceOption[]>([]);
  const [archiveInfo, setArchiveInfo] = useState<DeviceArchiveInfo | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<{ kind: "unchanged" | "saved" | "equipment" | "partial"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const [importing, setImporting] = useState(false);
  const [desktopReadState, setDesktopReadState] = useState<DesktopReadState>('idle');
  const [desktopContext, setDesktopContext] = useState<DesktopDataContext | null>(null);
  const desktopContextRef = useRef<DesktopDataContext | null>(null), desktopEpoch = useRef(0);
  const operationOwner = useRef<object | null>(null), fileOperation = useRef<{ epoch:number } | null>(null);
  const changeDesktopContext = useCallback((next:DesktopDataContext | null) => {
    if (sameDesktopContext(desktopContextRef.current,next)) return;
    desktopEpoch.current++; desktopContextRef.current=next ? {...next} : null;
    setDesktopContext(next ? {...next} : null);
    setSnapshot(null);setArchiveInfo(null);setSnapshots([]);setSaveSources([]);
    setError('');setRefreshNotice(null);setDesktopReadState('idle');setStartupFailed(false);
    setInitialized(!next);setView('overview');
  },[]);
  const currentDesktop = (context:DesktopDataContext | null,epoch:number) =>
    !!context && desktopEpoch.current===epoch && sameDesktopContext(desktopContextRef.current,context);


  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    const controller = new AbortController();
    if (desktopMode) {
      // Login never adopts legacy latest or an old account/session selection.
      const context=desktopContext,epoch=desktopEpoch.current;
      setSnapshot(null);setArchiveInfo(null);setSnapshots([]);setStartupFailed(false);setError('');
      if (!context) { setSaveSources([]);setInitialized(true);return () => controller.abort(); }
      setInitialized(false);
      loadSaveSources(controller.signal,context).then(sources => {
        if (!controller.signal.aborted && currentDesktop(context,epoch)) setSaveSources(sources);
      }).catch(reason => {
        if (!controller.signal.aborted && currentDesktop(context,epoch)) {setStartupFailed(true);setError(reason instanceof Error?reason.message:'无法读取存档来源，请重试。');}
      }).finally(() => {if(!controller.signal.aborted && currentDesktop(context,epoch))setInitialized(true);});
      return () => controller.abort();
    }
    setStartupFailed(false); setError("");
    Promise.all([loadLatestSnapshot(controller.signal), loadSnapshotIndex(controller.signal), loadSaveSources(controller.signal).catch(() => []), loadDeviceArchiveInfo()])
      .then(([latest, index, sources, storedArchiveInfo]) => {
        if (controller.signal.aborted) return;
        setSnapshot(latest); setSnapshots(index); setSaveSources(sources);
        setArchiveInfo(storedArchiveInfo?.sourceSnapshotId === latest?.snapshotId ? storedArchiveInfo : null);
        setSnapshotSource(getLastLoadSource());
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setStartupFailed(true);
        setError(nativeApp ? (reason instanceof Error ? reason.message : "本机档案暂时无法读取，请重试；不要卸载或清除应用数据。") : reason instanceof ApiRequestError && reason.status === 401 ? "手机尚未配对或临时口令已经失效，请重新扫描电脑显示的配对地址。" : "无法加载快照，请确认本地服务正在运行。");
      })
      .finally(() => { if (!controller.signal.aborted) setInitialized(true); });
    return () => controller.abort();
  }, [nativeApp, desktopMode, startupAttempt, desktopContext?.accountScope, desktopContext?.sessionId]);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const clearInstallPrompt = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", clearInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  async function handleImport(file: File | CharacterAssetPackage | undefined, fromSync = false): Promise<ArchiveReceipt> {
    if (!file || importLock.current) return false;
    importLock.current = true;
    setImporting(true);
    try {
      setError("");
      // A native receive callback owns its input; detach before any persistence
      // await so displayed data and the committed archive stay identical.
      const imported = structuredClone(isAssetPackage(file) ? file : await readAssetFile(file));
      const nextSnapshot = isAssetPackage(imported) ? imported.character : imported;
      const nextArchiveInfo: DeviceArchiveInfo = {
        schemaVersion: "1.0.0",
        importedAt: new Date().toISOString(),
        exportedAt: isAssetPackage(imported) ? imported.exportedAt : undefined,
        sourceSnapshotId: nextSnapshot.snapshotId,
        sourceLastWriteLocal: nextSnapshot.sourceLastWriteLocal,
        buildCount: isAssetPackage(imported) ? imported.builds.length : 0,
        source: fromSync ? "computer-sync" : isAssetPackage(imported) ? "asset-package" : "legacy-snapshot",
      };
      await saveImportedSnapshot(nextSnapshot, nextArchiveInfo);
      // Separate databases: a build-library failure must not hide a committed character.
      let buildWarning = "";
      if (isAssetPackage(imported) && imported.builds.length > 0) {
        try { await importSavedBuilds(imported.builds); }
        catch (reason) {
          buildWarning = `角色已保存，但配装册合并失败。${reason instanceof Error ? reason.message : "请检查存储空间。"}${fromSync ? "处理后返回电脑同步页，点击“接收最新角色”重试，无需传文件。" : "请保留档案包，处理后重新导入。"}`;
        }
      }
      setSnapshot(nextSnapshot);
      setStartupFailed(false); setError("");
      setArchiveInfo(nextArchiveInfo);
      setSnapshotSource("import");
      setRefreshNotice({
        kind: buildWarning ? "partial" : "saved",
        text: buildWarning || (fromSync ? "电脑分析结果已同步并保存到手机，关闭电脑后仍可查看。" : isAssetPackage(imported)
          ? `角色档案包已存入这台设备，并合并 ${imported.builds.length} 套配装。`
          : "角色快照已存入这台设备，可在电脑断开后继续查看。"),
      });
      setSnapshots(await loadCachedSnapshotIndex());
      setView("overview");
      return buildWarning ? { warning: buildWarning } : true;
    } catch (reason) {
      setError(reason instanceof Error ? `导入失败：${reason.message}` : "导入失败，请确认文件是本应用导出的快照。");
      return false;
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  }

  async function handleRefresh(sourceId?: string, label?: string) {
    const context=desktopContextRef.current,epoch=desktopEpoch.current;
    if (importLock.current || desktopMode && !context) return false;
    const owner={epoch};operationOwner.current=owner;importLock.current=true;
    try {
      setRefreshing(true);setError('');setRefreshNotice(null);
      const previous=snapshot;
      const next=await refreshSnapshot(sourceId,label,desktopMode?context!:undefined);
      if(desktopMode) {
        if(!currentDesktop(context,epoch))return false;
        await saveDesktopSnapshot(context!,next,undefined,()=>currentDesktop(context,epoch));
        if(!currentDesktop(context,epoch))return false;
      }
      setSnapshot(next);setArchiveInfo(null);
      if(previous) {
        const sameSourceHash=previous.safety.originalMainSaveSha256===next.safety.originalMainSaveSha256;
        const sameLoadout=loadoutFingerprint(previous)===loadoutFingerprint(next);
        setRefreshNotice({kind:sameSourceHash?'unchanged':sameLoadout?'saved':'equipment',
          text:sameSourceHash?'读取完成，但原始存档内容没有变化。':sameLoadout?'已读取新的存档，装备槽标记没有变化。':'已读取新的存档，装备槽变化已经同步。'});
      }
      setSnapshotSource('api');
      const [,sources,index]=await Promise.all([refreshAgentStatus(),loadSaveSources(undefined,desktopMode?context!:undefined).catch(()=>[]),
        desktopMode?loadDesktopSnapshotIndex(context!).catch(()=>[]):loadSnapshotIndex().catch(()=>[])]);
      if(desktopMode && !currentDesktop(context,epoch))return false;
      setSaveSources(sources);setSnapshots(index);setView('overview');return true;
    } catch(reason) {
      if(!desktopMode || currentDesktop(context,epoch))setError(reason instanceof Error?reason.message:'刷新失败，旧档案仍保留。');
      return false;
    } finally {
      if(operationOwner.current===owner){operationOwner.current=null;importLock.current=false;setRefreshing(false);}
    }
  }

  async function handleSnapshotChange(snapshotId: string) {
    if (!snapshotId || snapshotId === snapshot?.snapshotId || importLock.current) return;
    importLock.current = true;
    setRefreshing(true);
    try {
      setError("");
      setSnapshot(await loadSnapshot(snapshotId));
      setArchiveInfo(null);
      setSnapshotSource(getLastLoadSource());
      setView("overview");
    } catch (reason) {
      setError("无法读取该历史快照。");
    } finally {
      importLock.current = false;
      setRefreshing(false);
    }
  }

  async function handleExport() {
    if (!snapshot) return;
    try {
    const builds = await loadSavedBuilds();
    const archive = createAssetPackage(snapshot, builds);
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    await shareOrDownloadFile(blob, `nioh2-assets-${snapshot.snapshotId}.json`, "Nioh 角色档案包");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("档案包导出或分享未完成，请重试；本机档案未改变。");
    }
  }

  if (!initialized && (nativeApp || privateMobilePresentation())) return <MobileLoadingScreen />;
  if (nativeApp || privateMobilePresentation()) return <MobileApp onRemoteSnapshot={acceptRemoteSnapshot} snapshot={snapshot} archiveInfo={archiveInfo} error={error} notice={refreshNotice?.text} noticeWarning={refreshNotice?.kind === "partial"} importing={importing}
    onRetryLoad={startupFailed ? () => { setInitialized(false); setStartupAttempt(value => value + 1); } : undefined}
    onArchive={archive => handleImport(archive, nativeApp)} onBackup={() => fileRef.current?.click()} onExport={() => void handleExport()}
    builds={snapshot ? <BuildsView snapshot={snapshot} /> : null}>
    <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={event => { void handleImport(event.target.files?.[0]); event.currentTarget.value = ""; }} />
  </MobileApp>;
  const contextAtRender=desktopContext,epochAtRender=desktopEpoch.current;
  const acceptDesktop = async (value:SaveSnapshot) => {
    if(!currentDesktop(contextAtRender,epochAtRender))throw new Error('LOCAL_DATA_CONTEXT_CHANGED');
    const info:DeviceArchiveInfo={schemaVersion:'1.0.0',source:'legacy-snapshot',importedAt:new Date().toISOString(),
      sourceSnapshotId:value.snapshotId,sourceLastWriteLocal:value.sourceLastWriteLocal,buildCount:0};
    await saveDesktopSnapshot(contextAtRender!,value,info,()=>currentDesktop(contextAtRender,epochAtRender));
    if(!currentDesktop(contextAtRender,epochAtRender))throw new Error('LOCAL_DATA_CONTEXT_CHANGED');
    setSnapshot(value);setArchiveInfo(info);setSnapshotSource('api');setView('overview');setError('');
    setRefreshNotice({kind:'saved',text:'电脑已解析并保存规范快照；当前未发送到手机。'});
    const index=await loadDesktopSnapshotIndex(contextAtRender!).catch(()=>[]);
    if(currentDesktop(contextAtRender,epochAtRender))setSnapshots(index);
  };
  return <DesktopApp dataContext={desktopContext} onDataContextChange={changeDesktopContext} sourceNewer={isSourceNewer(agentStatus?.source?.latestWriteLocal, snapshot?.sourceLastWriteLocal)} snapshot={snapshot} sources={saveSources} loading={!initialized} error={error} notice={refreshNotice?.text}
    busy={refreshing || importing} readState={desktopReadState} onReadSource={handleRefresh} onDismissRead={() => setDesktopReadState('idle')}
    onRetryLoad={() => { setInitialized(false); setStartupAttempt(value => value + 1); }}
    importPanel={<DesktopImport presentation="figma" hasCurrentSnapshot={Boolean(snapshot)} requestHeaders={desktopContext ? desktopContextHeaders(desktopContext) : {}} onReadState={state => {if(currentDesktop(contextAtRender,epochAtRender))setDesktopReadState(state);}} onSnapshot={acceptDesktop} disabled={refreshing || importing}
      onBegin={() => {
        if(importLock.current || !currentDesktop(contextAtRender,epochAtRender))return false;
        const owner={epoch:epochAtRender};fileOperation.current=owner;operationOwner.current=owner;
        importLock.current=true;setImporting(true);return true;
      }}
      onEnd={() => {
        const owner=fileOperation.current;
        if(owner?.epoch===epochAtRender && operationOwner.current===owner){operationOwner.current=null;fileOperation.current=null;importLock.current=false;setImporting(false);}
      }} />} />;
}
