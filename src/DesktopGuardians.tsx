import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { SaveSnapshot } from './types';
import { desktopAssets, designImage, imageUrl } from './desktopAssets';
import { DesktopText as T } from './DesktopTypography';
import { firstPersistedGuardianKey, persistedGuardian } from './desktopPresentation';
import { CoreRows } from './DesktopHome';
/** Resize a native texture band with its content row; source pixels stay intact. */
function coreBand([x,y,width,height]:readonly [number,number,number,number]):CSSProperties {
  return {backgroundImage:`url("${designImage('459-2652','img1329522')}")`,
    backgroundSize:`${560/width*100}% ${820/height*100}%`,
    backgroundPosition:`${x/(560-width)*100}% ${y/(820-height)*100}%`,backgroundRepeat:'no-repeat'};
}
/** Keep keyboard scrolling when the visual scrollbar is hidden; child buttons retain their keys. */
export function scrollGuardianRegion(event: KeyboardEvent<HTMLElement>) {
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const element = event.currentTarget;
  const moves: Record<string, number> = { ArrowDown: 60, ArrowUp: -60, PageDown: element.clientHeight * .85, PageUp: -element.clientHeight * .85 };
  if (event.key === 'Home' || event.key === 'End') {
    element.scrollTop = event.key === 'Home' ? 0 : element.scrollHeight; event.preventDefault();
  } else if (event.key in moves) { element.scrollTop += moves[event.key]; event.preventDefault(); }
}
export function DesktopGuardians({ snapshot }: { snapshot: SaveSnapshot }) {
  const first = firstPersistedGuardianKey(snapshot);
  const [selectedKey, setSelectedKey] = useState(first ?? desktopAssets.guardians[0].key);
  const [core, setCore] = useState<number | null>(null);
  const info = useRef<HTMLElement>(null), previousCore = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (previousCore.current !== null && core === null) info.current?.querySelector<HTMLButtonElement>('[aria-label="魂核记录' + (previousCore.current + 1) + '"]')?.focus();
    previousCore.current = core;
  }, [core]);
  const directory = useRef<HTMLDivElement>(null);
  const selected = desktopAssets.guardians.find(g => g.key === selectedKey)!;
  const saved = persistedGuardian(snapshot, selectedKey);
  const instance = core === null ? undefined : saved?.coreInstances[core];
  const entries = instance?.entries.slice(0, 5).map(entry => /\?{2,}/.test(entry.label) ? undefined : entry) ?? [];
  return <>
    <header><h1><T>守护灵</T></h1></header>
    <div className={'df-guardian-layout' + (instance ? ' df-guardian-layout-core' : '')}>
      <section className="df-panel df-guardian-directory"><h2><T>全部守护灵 · 37</T></h2><p className="df-muted"><T>资料目录；获得状态 —</T></p>
        <div className="df-guardian-scroll" ref={directory} role="region" aria-label="守护灵目录" tabIndex={0} onKeyDown={scrollGuardianRegion}>
          {desktopAssets.guardians.map(guardian => <button key={guardian.key} className="df-guardian-row" aria-pressed={guardian.key === selectedKey}
            onClick={() => { setSelectedKey(guardian.key); setCore(null); }}>
            <img src={imageUrl(guardian)} alt="" /><span><T>{guardian.name}</T></span>
          </button>)}
        </div><p className="df-muted"><T>主副身份、获得与活动状态各自独立</T></p>
      </section>
      <section ref={info} className="df-panel df-guardian-info" aria-label="守护灵信息" tabIndex={0} onKeyDown={scrollGuardianRegion}>
        <div className="df-guardian-info-heading"><img src={imageUrl(selected)} alt={selected.name} /><h2><T>{selected.name}</T></h2></div>
        <h3><T>守护灵庇佑</T></h3><p className="df-muted"><T>当前生效状态 —</T></p>
        <dl className="df-data-list df-guardian-fixed" tabIndex={0} aria-label="守护灵庇佑记录" onKeyDown={scrollGuardianRegion}>
          {saved?.fixedEntries.length ? saved.fixedEntries.map((entry,index) => <div className="df-value-row" key={index}><dt><T wrap>{entry.label}</T></dt><dd><T>{entry.ordinarySourceDisplay ?? '—'}</T></dd></div>) : <div className="df-value-row"><dt><T>固定词条</T></dt><dd><T>—</T></dd></div>}
        </dl>
        <h3><T>凭附魂核</T></h3><CoreRows snapshot={snapshot} guardianKey={selected.key} onCore={setCore} />
        <p className="df-muted"><T>凭附容量 — / —</T></p>
      </section>
      {instance ? <section className="df-core-details" aria-label="魂核信息">
        <img className="df-core-detail-base" src={designImage('459-2652','img1329521')} alt="" />
        <div className="df-core-level"><T>LV —</T></div>
        <div className="df-core-unknown-portrait" aria-label="魂核图像未解析"><T>—</T></div>
        <h2 className="df-core-name"><T>{'魂核记录' + ((core ?? 0) + 1)}</T></h2>
        <dl className="df-core-stats">{['攻击力','防御力','魂核阶级'].map(label => <div key={label}><dt><T>{label}</T></dt><dd><T>—</T></dd></div>)}</dl>
        <p className="df-core-type"><T>名称 / 类型 / 活动状态 —</T></p>
        <div className="df-core-body" tabIndex={0} aria-label="魂核详情内容" onKeyDown={scrollGuardianRegion}>
          <h3 className="df-core-effects-title"><T>特殊效果</T></h3>
          <dl className="df-data-list df-core-effects" tabIndex={0} aria-label="魂核特殊效果" onKeyDown={scrollGuardianRegion}>{[0,1,2,3,4].map(index => <div className="df-value-row" style={coreBand([29,242,503,30])} key={index}><dt><T wrap>{entries[index]?.label ?? '—'}</T></dt><dd><T>{entries[index]?.ordinarySourceDisplay ?? '—'}</T></dd></div>)}</dl>
          <div className="df-core-ability"><h3><T>妖怪技</T></h3><p className="df-core-ability-name" style={coreBand([28,430,504,30])}><T>—</T></p><p className="df-core-ability-cost" style={coreBand([80,480,400,27])}><T>COST</T><T>—</T></p></div>
        </div>
        <p className="df-core-attunement" style={coreBand([39,747,484,60])}><T>凭附COST</T><T>—</T></p>
        <button className="df-detail-close df-core-close" onClick={() => setCore(null)}><T>关闭魂核</T></button>
      </section> : null}
    </div>
  </>;
}
