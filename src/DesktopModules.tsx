import { useState } from 'react';
import type { SaveSnapshot } from './types';
import { DesktopText as T } from './DesktopTypography';
import { desktopAssets, imageUrl } from './desktopAssets';
import { equippedSlots, equipmentName, firstPersistedGuardianKey } from './desktopPresentation';
import './desktopModules.css';

type PendingModule = 'warehouse' | 'equipment-skills' | 'underworld';
const names = { warehouse:'仓库', 'equipment-skills':'装备技能', underworld:'奈洛狱' };
/** Current Figma module structures. Missing save fields are explicitly unknown. */
export function DesktopPendingModule({page}:{page:PendingModule}) {
  return <><header><h1><T>{names[page]}</T></h1></header>
    <div className={'dm-layout dm-'+page} data-figma-node={page==='warehouse'?'516:3900':page==='underworld'?'516:4359':'516:4049'}>
      {page==='warehouse'?<section className="dm-paper dm-single" aria-label="仓库记录">
        <nav className="dm-categories" aria-label="仓库分类">{['武器','防具','饰品','魂核'].map(label=><span key={label}><T>{label}</T></span>)}</nav>
        <p className="dm-warehouse-wait"><T>仓库记录待读取</T></p>
      </section>:page==='underworld'?<section className="dm-paper dm-single" aria-label="层数与进度">
        <h2><T>层数与进度</T></h2><dl className="dm-unknown-rows">{['当前层数','最高到达层数','地狱深处进度'].map(label=><div key={label}><dt><T>{label}</T></dt><dd><T>—</T></dd></div>)}</dl>
        <p className="dm-footnote"><T>数据未解析</T></p>
      </section>:<>
        <section className="dm-paper"><h2><T>武技自定义</T></h2><p><T>武器类别 —</T></p><dl className="dm-unknown-rows">{['上段','中段','下段'].map(label=><div key={label}><dt><T>{label}</T></dt><dd><T>招式槽位 —</T></dd></div>)}</dl><p className="dm-footnote"><T>配置记录待读取</T></p></section>
        <section className="dm-paper"><h2><T>技能装配</T></h2><p><T>武器类别 —</T></p><dl className="dm-unknown-rows">{[0,1,2].map(i=><div key={i}><dt><T>可装配技能</T></dt><dd><T>—</T></dd></div>)}</dl><p className="dm-footnote"><T>配置记录待读取</T></p></section>
      </>}
    </div></>;
}

/** Only current equipment is bound; presets and prepared jutsu remain unknown. */
export function DesktopPreparation({snapshot}:{snapshot:SaveSnapshot}) {
  const [selected,setSelected]=useState(0);
  const guardian=desktopAssets.guardians.find(g=>g.key===firstPersistedGuardianKey(snapshot));
  return <><header><h1><T>战斗准备</T></h1></header><div className="dm-preparation" data-figma-node="591:4341">
    <nav className="df-panel dm-prep-directory" aria-label="战斗准备记录">{[0,1,2,3].map(index=><button key={index} className="dm-prep-choice" aria-pressed={selected===index} onClick={()=>setSelected(index)}>
      <h2><T>{index===0?'当前装备':'战斗准备 '+index}</T></h2>
      {index===0?<div className="dm-prep-slots" aria-hidden="true">{[0,1,2,3].map(i=><span key={i}/>)}<span>{guardian?<img src={imageUrl(guardian)} alt=""/>:null}</span><span className="dm-slot-circle"/></div>:<><p><T>预设状态：未知</T></p><p><T>保存日期：待读取</T></p></>}
    </button>)}</nav>
    <section className="df-panel dm-prep-records" aria-label="战斗准备装备"><h2><T>{selected===0?'当前装备':'战斗准备 '+selected}</T></h2>
      {selected===0?<div className="dm-prep-equipment">{equippedSlots(snapshot).map(({slot,item})=><div key={slot}><T wrap>{equipmentName(item)}</T></div>)}</div>:<p><T>配置记录待读取</T></p>}
    </section>
    <section className="df-panel dm-prep-jutsu"><h2><T>准备术</T></h2><p><T>配置记录待读取</T></p></section>
  </div><p className="dm-readonly"><T>仅展示存档记录，不写回游戏</T></p></>;
}
