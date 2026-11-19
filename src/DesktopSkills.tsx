import { useLayoutEffect, useRef, useState } from 'react';
import { desktopAssets, designImage, imageUrl } from './desktopAssets';
import positions from './desktopSkillPositions.json';
import { DesktopText as T } from './DesktopTypography';
import { ninjutsuCatalogue } from './desktopPresentation';
import type { SaveSnapshot } from './types';
import { skillDefinitions, skillDisplayName } from './skills';
export function DesktopSkills({ onMenu, snapshot }: { onMenu: () => void; snapshot?: SaveSnapshot }) {
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null), previous = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (previous.current !== null && selected === null) root.current?.querySelector<HTMLButtonElement>('[data-skill-index="' + previous.current + '"]')?.focus();
    previous.current = selected;
  }, [selected]);
  const back=()=>{setCategory(null);setSelected(null);};
  const background=<img className="df-skills-background" src={designImage('508-1653','img1330643')} alt="" />;
  if (category === null) return <section className="df-skills-home" aria-label="技能类别">
    {background}
    <div className="df-skills-title"><h1><T>技能类别</T></h1><p><T>选择类别查看技能记录</T></p></div>
    <div className="df-skill-hotspots">{positions.map(position => <button key={position.category} className="df-skill-hotspot"
      aria-label={position.label} style={{ left: 'calc(' + position.x + 'px * var(--df-scale))', top: 'calc(' + position.y + 'px * var(--df-scale))' }}
      onClick={() => { setCategory(position.label); setSelected(null); }}>
      <span className="df-skill-inner"><img className="df-skill-circle" src={designImage('508-1653','img')} alt="" />
      <img className="df-skill-base" src={imageUrl(desktopAssets.skillCategories.find(row => row.category === position.category))} alt="" /></span>
    </button>)}</div>
    <div className="df-skills-actions"><button onClick={onMenu}><T>呼出菜单</T></button><span><T>未知不等于未点</T></span></div>
  </section>;
  const categoryId=positions.find(row=>row.label===category)?.category;
  const definitions=skillDefinitions.filter(d=>d.category===categoryId);
  const saved=new Map(snapshot?.skills?.entries.map(e=>[e.skillId,e]));
  const records=snapshot?.skills?definitions.map(d=>({name:skillDisplayName(d.name),definition:d,saved:saved.get(d.skillId)})):ninjutsuCatalogue.map(name=>({name,definition:undefined,saved:undefined}));
  const learning=(index:number)=>records[index]?.saved?.learned===true?'已学':records[index]?.saved?.learned===false?'未学':'未知';
  if(category!=='忍术'&&!snapshot?.skills) {
    const position=positions.find(row=>row.label===category)!;
    return <section className="df-skills-home df-skills-pending" aria-label={category+' · 技能记录待读取'}>
      {background}<div className="df-skills-title"><h1><T>技能类别</T></h1></div>
      <div className="df-skill-hotspots">
        <div className="df-skill-pending-marker" aria-label={'已选择类别 '+category}>
          <img className="df-skill-circle" src={designImage('508-1653','img')} alt="" />
          <img className="df-skill-base" src={imageUrl(desktopAssets.skillCategories.find(row=>row.category===position.category))} alt="" />
          <span><T>{category}</T></span>
        </div>
        <section className="df-skill-pending-card"><h2><T>{category}</T></h2><h3><T>技能记录待读取</T></h3>
          <p><T>当前解析接口尚未提供此类别记录</T></p><p><T>未知不等于未点</T></p>
          <button onClick={back}><T>返回技能类别</T></button>
        </section>
      </div>
      <div className="df-skills-actions"><button onClick={onMenu}><T>呼出菜单</T></button><span><T>未知不等于未点</T></span></div>
    </section>;
  }
  return <>
    <header><h1><T>{category}</T></h1></header>
    <div ref={root} className={'df-detail-layout df-skill-layout' + (selected !== null ? ' df-detail-layout-open' : '')}>
      <section className="df-skill-records df-skill-paper"><h2><T>技能记录</T></h2>
        <div className="df-skill-points"><T>当前存档点数</T><T>—</T></div>
        <p className="df-skill-provenance"><T>{snapshot?.skills?'存档学习记录；当前资格未知':'资料目录；当前等级待读取'}</T></p>
        <div className="df-skill-record-list">{records.map((record,index) => <button className="df-skill-record-row" data-skill-index={index} data-skill-id={record.definition?.skillId} key={record.definition?.skillId??record.name} aria-pressed={selected === index} onClick={() => setSelected(index)} data-learning-state={record.saved?.learned==null?'unknown':record.saved.learned?'learned':'unlearned'}>
          <span><T wrap>{record.name}</T></span><span><T>{snapshot?.skills?learning(index)+' '+(record.saved?.storedRank??'—'):'—'}</T></span>
        </button>)}</div><p className="df-skill-provenance"><T>未知不等于未点；不使用示例等级</T></p>
      </section>
      {selected !== null ? <section className="df-skill-records df-skill-paper df-skill-detail" aria-label="技能详情">
        <div className="df-detail-topline"><h2><T wrap>{records[selected]?.name??'—'}</T></h2><button className="df-detail-close" onClick={() => setSelected(null)}><T>关闭详情</T></button></div>
        <p className="df-skill-provenance"><T>{snapshot?.skills?'存档学习记录；当前资格未知':'当前解析接口未提供此技能记录'}</T></p>
        <dl className="df-data-list">{[['学习状态',learning(selected)],['当前等级',records[selected]?.saved?.storedRank??'—'],['最高等级',snapshot?.skills?records[selected]?.definition?.maxRank??'—':'—'],['前置条件','—']].map(([label,value]) => <div className="df-skill-detail-row" key={label}><dt><T>{label}</T></dt><dd><T>{value}</T></dd></div>)}</dl>
        <section className="df-skill-reference" aria-label="一阶效果资料">
          <h3><T>一阶效果 · 资料参考</T></h3>
          <p><T wrap>{records[selected]?.definition?.baseDescription??'—'}</T></p>
          <p className="df-skill-provenance"><T>非当前生效效果</T></p>
        </section>
        <p className="df-skill-provenance"><T>未知不等于未点；不使用示例等级</T></p>
      </section> : null}
    </div>
    <div className="df-footer"><button onClick={onMenu}><T>呼出菜单</T></button><button onClick={back}><T>返回技能类别</T></button></div>
  </>;
}
