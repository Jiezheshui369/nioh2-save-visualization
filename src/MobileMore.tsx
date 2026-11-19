import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { CharacterAssetPackage } from './assetPackage';
import { isCharacterStatus } from './characterStatus';
import { NativeAccountPanel } from './NativeAccountPanel';
import type { ArchiveReceipt } from './SyncPanel';
import type { DeviceArchiveInfo, SaveSnapshot } from './types';
import packageInfo from '../package.json';
import { privateImage, privateVisualPreview, privateColorPreview, privateGameFramesPreview, privateLightAllPreview, privateVisualStyle } from './privateVisualAssets';

type Page = 'home' | 'settings' | 'source' | 'about';
const dateText = (value?: string) => {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '时间未知';
};
const sourceText = (snapshot: SaveSnapshot | null, info: DeviceArchiveInfo | null) => {
  if (!snapshot) return '尚无本机档案';
  if (snapshot.snapshotId.startsWith('synthetic-')) return '合成示例 · 非存档读取';
  if (!info || info.sourceSnapshotId !== snapshot.snapshotId) return '本机记录 · 导入来源未记录';
  return info.source === 'computer-sync' ? '电脑安全同步' : info.source === 'asset-package' ? '角色档案包' : '旧版单快照';
};

export function MobileLoadingScreen() {
  return <div className={`nm-shell nm-view-other nm-loading-shell${privateVisualPreview ? ' nm-materials' : ''}${privateColorPreview ? ' nm-color-scenes' : ''}${privateGameFramesPreview ? ' nm-game-frames' : ''}${privateLightAllPreview ? ' nm-light-all' : ''}`} style={privateVisualStyle()}>
    <main className="nm-scroll nm-loading-page" aria-busy="true" aria-live="polite">
      <section className="nm-state-card"><strong className="nm-loading-brand">存档资产</strong><span className="nm-loading-line" aria-hidden="true" /><h1>正在读取本机档案</h1><p>请稍候，保存后的角色资料可离线查看。</p></section>
    </main>
  </div>;
}

interface Props {
  snapshot: SaveSnapshot | null;
  archiveInfo: DeviceArchiveInfo | null;
  active: boolean;
  importing: boolean;
  onArchive: (archive: CharacterAssetPackage) => Promise<ArchiveReceipt>;
  onBackup: () => void;
  onExport: () => void;
  onPageChange: () => void;
  onRemoteSnapshot?: (snapshot: SaveSnapshot | null) => void;
}

export function MobileMore({ snapshot, archiveInfo, active, importing, onArchive, onBackup, onExport, onPageChange, onRemoteSnapshot }: Props) {
  const [page, setPage] = useState<Page>('home');
  const matchingInfo = snapshot && archiveInfo?.sourceSnapshotId === snapshot.snapshotId ? archiveInfo : null;
  const sample = snapshot?.snapshotId.startsWith('synthetic-') ?? false;
  const sampleLabels = sample && privateLightAllPreview && new URLSearchParams(window.location.search).get('layout') !== 'desktop';
  const status = snapshot && isCharacterStatus(snapshot.characterStatus) && snapshot.characterStatus.referenceSnapshotId === snapshot.snapshotId ? snapshot.characterStatus : null;
  const go = (next: Page) => { setPage(next); onPageChange(); };
  const heading = page === 'settings' ? '档案管理与设置' : page === 'source' ? '数据来源说明' : '关于存档资产';
  return <div className="nm-more-pages">
    {sample && active ? <p className="nm-sample-notice" role="status">示例数据 · 非存档读取 / 模拟预览</p> : null}
    {page !== 'home' ? <><button className="nm-back" onClick={() => go('home')}>‹ 返回更多</button><header className="nm-more-heading"><h1>{heading}</h1><p>你的角色资料，保存在这台设备。</p></header></> : null}
    {page === 'home' ? <>
      <NativeAccountPanel platform={Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'} onSnapshot={onRemoteSnapshot} />
      {snapshot ? <section className="nm-state-card nm-more-archive"><span>本机离线存档</span><h1>等级 {snapshot.character.level}</h1><p>资料来源：{sourceText(snapshot, matchingInfo)}</p><dl className="nm-source-values"><div><dt>{sampleLabels ? '示例时间' : '游戏存档时间'}</dt><dd>{dateText(snapshot.sourceLastWriteLocal)}</dd></div><div><dt>保存到本机</dt><dd>{dateText(matchingInfo?.importedAt)}</dd></div></dl></section>
        : <section className="nm-state-card asset-empty-archive"><h2>本机还没有存档资料</h2><p>跨网同步未启用，当前不会下载电脑存档。已有备份可以在下方恢复；这里不会生成示例角色。</p></section>}
      <details className="nm-backup-options"><summary>从已有备份恢复（可选）</summary><div className="nm-more-actions"><button disabled={importing} onClick={onBackup}>导入我的档案包</button>{snapshot ? <button disabled={importing} onClick={onExport}>导出备份档案包</button> : null}</div></details>
      <p className="nm-note">已保存的本机资料仍可离线查看。卸载或清除应用数据会删除本机档案。</p>
      <Menu go={go} />
    </> : page === 'settings' ? <>
      <section className="nm-state-card"><h2>档案备份</h2><p>{snapshot ? '导出当前角色和配装，或从已有档案包恢复。恢复前会校验格式，保存失败时保留原档案。' : '尚无角色资料。可以连接电脑，或从已有档案包恢复。'}</p><div className="nm-more-actions"><button disabled={importing} onClick={onBackup}>{importing ? '正在保存档案…' : '导入我的档案包'}</button><button disabled={!snapshot || importing} onClick={onExport}>导出备份档案包</button></div></section>
      <section className="nm-state-card"><h2>离线与同步</h2><dl className="nm-source-values"><div><dt>离线查看</dt><dd>{snapshot ? '当前档案可查看' : '等待保存档案'}</dd></div><div><dt>接收新档案</dt><dd>账号跨网同步未启用</dd></div><div><dt>游戏原档</dt><dd>只读</dd></div></dl><p>接收新档案前确认账号和连接状态。连接中断不会删除已保存角色；卸载或清除应用数据会删除本机档案。</p></section>
      <section className="nm-state-card"><h2>显示</h2><dl className="nm-source-values"><div><dt>界面语言</dt><dd>中文</dd></div><div><dt>外观</dt><dd>雾墨 · 轻透面板</dd></div></dl></section>
    </> : page === 'source' ? <>
      <section className="nm-state-card"><h2>当前档案</h2><dl className="nm-source-values"><div><dt>资料来源</dt><dd>{sourceText(snapshot, matchingInfo)}</dd></div><div><dt>{sampleLabels ? '示例时间' : '游戏存档时间'}</dt><dd>{dateText(snapshot?.sourceLastWriteLocal)}</dd></div><div><dt>保存到本机</dt><dd>{dateText(matchingInfo?.importedAt)}</dd></div><div><dt>{sampleLabels ? '示例生成器' : '解析版本'}</dt><dd>{snapshot?.parserVersion || '未记录'}</dd></div></dl><p>档案的保存时间不代表电脑当前在线，也不证明 Steam 云端已经更新。</p></section>
      <section className="nm-state-card"><h2>存档读取</h2><p>{sample ? '当前页面使用合成示例。示例数值只用于界面验证，不是从你的存档读取的结果。' : '等级、加点、装备和物品来自档案中的已解析记录。电脑从独立副本分析，手机只保存结构化资料。'}未知名称或数值继续保留为未解析。</p></section>
      <section className="nm-state-card"><h2>截图记录</h2><p>{sample ? '合成示例，用于展示完整属性结构；不是从截图或存档读取。' : status ? '当前档案附有匹配此快照的截图观察记录。它与存档解析分别标注，不会随装备变化自动重算。' : '当前档案没有匹配此快照的截图观察记录。不会用其他角色或旧快照的记录补齐面板。'}</p><p>截图里的预览、候选研究字段和未识别的佩戴关系，不作为正式装备效果或最终总值。</p></section>
      <section className="nm-state-card"><h2>分类图片</h2><p>武器、防具、绘卷和魂核图片用于分类展示，不代表具体装备外观或稀有度。未确认名称对应的物品图片保持留空。</p></section>
    </> : <>
      <section className="nm-state-card"><h2>存档资产 Save Asset</h2><p>电脑分析，手机展示。带走自己的角色、装备与配装，保存后离线查看。</p><dl className="nm-source-values"><div><dt>版本</dt><dd>{packageInfo.version}</dd></div><div><dt>当前支持</dt><dd>仁王 2</dd></div><div><dt>读取方式</dt><dd>独立副本 · 原档只读</dd></div></dl></section>
      <section className="nm-state-card"><h2>当前功能</h2><p>当前已提供账号登录、本机档案与备份恢复。跨网同步是否可用以连接状态为准；登录不代表已发送或接收档案。</p><p>与 Koei Tecmo、Team Ninja、Valve 无隶属关系。</p></section>
    </>}
    {page === 'home' ? <p className="nm-note">版本 {packageInfo.version} · 原始存档只读<br />与 Koei Tecmo、Team Ninja、Valve 无隶属关系。</p> : <button onClick={() => go('home')}>返回更多</button>}
  </div>;
}

function Menu({ go }: { go: (page: Page) => void }) {
  return <nav className="nm-more-menu" aria-label="档案与应用设置">{([['settings', '档案管理与设置', '备份恢复 · 离线查看'], ['source', '数据来源说明', '存档读取 · 截图记录 · 未解析'], ['about', '关于存档资产', '版本与当前功能']] as const).map(([key, label, hint]) => <button key={key} onClick={() => go(key)}><span><strong>{label}</strong><small>{hint}</small></span><span aria-hidden="true">›</span></button>)}</nav>;
}
