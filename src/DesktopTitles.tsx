import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SaveSnapshot } from './types';
import { titleDefinitions, titleText } from './titles';
import type { TitleCategory } from './titles';
import { BundledBitmapFontProvider, GameBitmapText, planBitmapText } from './GameBitmapText';
import { useDesktopScale } from './DesktopTypography';
import { titleDesignAsset as asset, titleDesignManifest, titleNativeFont, titleAgyoMotif } from './titleDesignAssets';
import './desktopTitles.css';

type ArtKey = keyof typeof titleDesignManifest;
function Glyph({id,label}:{id:ArtKey;label:string}) {
  const metadata=titleDesignManifest[id];
  return <span className="dt-glyph" aria-label={label}><img src={asset(id)} width={metadata.width} height={metadata.height} alt=""/><span className="sr-only">{label}</span></span>;
}
function Native({text,wrapWidth}:{text:string;wrapWidth?:number}) {
  const lines:string[]=[];let line='';
  for(const c of text){
    if(c==='\n'){lines.push(line);line='';continue;}
    if(wrapWidth && line && planBitmapText(line+c,titleNativeFont).width>wrapWidth){lines.push(line);line=c;}else line+=c;
  }
  lines.push(line);
  return <span className="dt-native">{lines.map((value,i)=><span className="dt-native-line" key={i}><GameBitmapText>{value||' '}</GameBitmapText></span>)}</span>;
}
const perkLabels=['获得金钱','体力','精力','精力恢复速度','忍术  术力','阴阳术  术力','装备品掉落率','药物恢复体力效果'];
const perkArt=['overview-imgG014','overview-imgG016','overview-imgG017','overview-imgG018','overview-imgG019','overview-imgG020','overview-imgG021','overview-imgG022'] as const;

/** Figma05 geometry; sample progress is replaced with saved membership and unknown runtime values. */
export function DesktopTitles({snapshot,onMenu=()=>{},onBack=()=>{}}:{snapshot:SaveSnapshot;onMenu?:()=>void;onBack?:()=>void}) {
  const [category,setCategory]=useState<TitleCategory>(1);
  const [page,setPage]=useState<'overview'|'list'>('overview');
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const scale=useDesktopScale();
  const titles=snapshot.titles, group=titles?.summary.groups.find(g=>g.category===category);
  const categoryName=category===0?'阿形':'吽形';
  const rows=titleDefinitions.filter(d=>d.category===category);
  const selected=rows.find(d=>d.titleId===selectedId);
  const saved=new Map(titles?.entries.map(e=>[e.titleId,e.savedAwarded])??[]);
  const status=(id:number)=>saved.get(id)===true?'已获得':saved.get(id)===false?'尚未获得':'未知';
  const switchCategory=()=>{setCategory(c=>c===0?1:0);setSelectedId(null);};
  const count=group?.awarded==null?(titles?'未知':'待读取'):`${group.awarded} / ${group.total}`;
  return <BundledBitmapFontProvider font={titleNativeFont}><section className="dt-screen" aria-label="称号">
    <div className={'dt-stage'+(page==='list'?' dt-directory':'')} style={{'--dt-scale':scale} as CSSProperties} data-figma-node={page==='overview'?'405:1038':category===0?'689:3451':'689:5093'}>
      <img className="dt-background" src={asset('overview-img')} width="1920" height="1080" alt=""/>
      <div className="dt-shade"/>
      <h1 className="dt-title"><button aria-label={`切换称号类别：${categoryName}称号`} title="点击或使用左右方向键切换阿形、吽形" onClick={switchCategory}
        onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();switchCategory();}}}>
        {category===1?<Glyph id={page==='overview'?'overview-imgG000':'list-imgG038'} label={page==='overview'?'吽形称号':'吽形称号一览'}/>:<Native text={page==='overview'?'阿形称号':'阿形称号一览'}/>}</button></h1>
      {!titles?<h2 className="sr-only">此快照尚未解析称号</h2>:null}
      {page==='list'?<nav className="dt-category-tabs" aria-label="称号类别">{([0,1] as const).map(value=><button key={value} aria-pressed={category===value} onClick={()=>{setCategory(value);setSelectedId(null);}}><Native text={value===0?'阿形':'吽形'}/></button>)}</nav>:null}
      <span className="sr-only" aria-label="称号汇总">{titles?.summary.awarded??'未知'} / {titles?.summary.total??390}</span>
      <div className="dt-panel" data-design-slot="title-panel">
        <img className="dt-motif" src={category===1?asset('overview-img1311141'):titleAgyoMotif} width="1080" height="880" alt=""/>
        <img className={'dt-frame '+(page==='overview'?'dt-frame-overview':'')} src={asset(page==='overview'?'overview-img1321019':'list-img1321079')} width="1080" height="880" alt=""/>
        {page==='overview'?<>
          <nav className="dt-entrances" aria-label="称号页入口">
            <button onClick={()=>setPage('overview')} aria-label="恩惠总览"><Glyph id="overview-imgG002" label="恩惠总览"/></button>
            <button onClick={()=>{setPage('list');setSelectedId(null);}} aria-label="称号一览"><Glyph id="overview-imgG003" label="称号一览"/></button>
            <button disabled aria-label="游玩记录（尚未接入）"><Glyph id="overview-imgG004" label="游玩记录"/></button>
          </nav>
          <div className="dt-section-caption dt-acquired-caption">{category===1?<Glyph id="overview-imgG005" label="吽形称号 · 获得状况"/>:<Native text="阿形称号 · 获得状况"/>}</div>
          <dl className="dt-counts">
            <div><dt><Glyph id="overview-imgG006" label="获得称号数"/></dt><dd aria-label="当前分组汇总">{titles?<Native text={count}/>:<Glyph id="overview-imgG007" label={count}/>}</dd></div>
            <div><dt><Glyph id="overview-imgG008" label="名声阶级"/></dt><dd><Glyph id="overview-imgG009" label="未知"/></dd></div>
            <div><dt><Glyph id="overview-imgG010" label="名声分数"/></dt><dd><Glyph id="overview-imgG011" label="未知"/></dd></div>
            <div><dt>{category===1?<Glyph id="overview-imgG012" label="吽形恩惠点数"/>:<Native text="阿形恩惠点数"/>}</dt><dd><Glyph id="overview-imgG009" label="未知"/></dd></div>
          </dl>
          <div className="dt-section-caption dt-perks-caption">{category===1?<Glyph id="overview-imgG013" label="吽形称号 · 恩惠"/>:<Native text="阿形称号 · 恩惠"/>}</div>
          <dl className="dt-perks">{category===1?perkLabels.map((label,index)=><div key={label}><dt><Glyph id={perkArt[index]} label={label}/></dt><dd><Glyph id="overview-imgG015" label="未知"/></dd></div>):<div><dt><Native text="恩惠内容未解析"/></dt><dd><Glyph id="overview-imgG015" label="未知"/></dd></div>}</dl>
        </>:<>
          <div className="dt-directory-note"><Native text="存档称号记录 · 实时进度未知"/></div>
          <div className="dt-list-header"><Native text="称号名称"/><Native text="进度 · 状态"/></div>
          <ul className="dt-list" aria-label="称号列表">{rows.map(d=><li key={d.titleId} data-title-id={d.titleId} data-awarded={saved.get(d.titleId)==null?'unknown':String(saved.get(d.titleId))}>
            <button aria-label={`${titleText(d.titleId).name} · ${status(d.titleId)}`} aria-pressed={selected?.titleId===d.titleId} onClick={()=>setSelectedId(d.titleId)}>
              <span className="dt-list-name"><Native text={titleText(d.titleId).name}/></span><span className="dt-list-status"><Native text={`— · ${status(d.titleId)}`}/></span>
            </button></li>)}</ul>
          <section className="dt-selection" aria-label="选中称号详情">
            <h2><Native text={selected?titleText(selected.titleId).name:'选择称号查看达成条件'}/></h2>
            {selected?<div className="dt-condition"><Native text={titleText(selected.titleId).condition} wrapWidth={850*40/24}/></div>:<p><Native text="未知不等于未完成"/></p>}
            <p><Native text={selected?status(selected.titleId):'真实进度待读取'}/><span className="sr-only">。实时进度、可见性及可领取状态：未知</span></p>
          </section>
        </>}
      </div>
      <footer className="dt-footer">
        <button className="dt-menu-trigger" onClick={onMenu} aria-label="呼出菜单"><Glyph id="overview-imgG025" label="呼出菜单"/></button>
        <div className="dt-footer-context">{page==='overview' && category===1?<Glyph id="overview-imgG026" label="吽形 · 恩惠总览"/>:<Native text={`${categoryName} · ${page==='overview'?'恩惠总览':'实时进度未知'}`}/>}</div>
        {page==='list'?<button className="dt-footer-action" onClick={()=>setPage('overview')} aria-label="返回恩惠总览"><Native text="返回称号主界面"/></button>
          :<div className="dt-footer-action">{titles?<Native text="实时状态未知"/>:<Glyph id="overview-imgG027" label="记录待读取"/>}</div>}
      </footer>
      <button className="sr-only dt-back" onClick={onBack}>返回</button>
    </div>
  </section></BundledBitmapFontProvider>;
}
