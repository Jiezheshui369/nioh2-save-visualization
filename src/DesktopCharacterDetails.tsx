import './characterDetails.css';
import { matchingResearchStatus } from './researchStatus';
import { useId, useRef } from 'react';
import type { SaveSnapshot } from './types';
import { isCharacterStatus, deduplicateEntries, formatPanelValue } from './characterStatus';
import type { StatusEntry, StatusGroup } from './characterStatus';
import { CHARACTER_PANEL_CATALOG, CHARACTER_EFFECT_CATALOG } from './characterStatusCatalog';
import type { StatusFieldCatalogGroup } from './characterStatusCatalog';
import { GameBitmapText } from './GameBitmapText';

const BASIC: [string, (snapshot: SaveSnapshot) => number][] = [
  ['等级', s => s.character.level], ['体', s => s.character.attributes.constitution],
  ['心', s => s.character.attributes.heart], ['勇', s => s.character.attributes.courage],
  ['刚', s => s.character.attributes.stamina], ['武', s => s.character.attributes.strength],
  ['技', s => s.character.attributes.skill], ['忍', s => s.character.attributes.dexterity],
  ['咒', s => s.character.attributes.magic], ['精华', s => s.character.amrita], ['持有金钱', s => s.character.gold],
];
interface DisplayRow { id:string; label:string; entry?:StatusEntry; value?:string }
interface DisplayGroup { id:string; title:string; kind:'panel'|'effect'|'basic'; rows:DisplayRow[] }

/** Match within the same group and preserve repeated labels by occurrence.
 * Extra observations remain visible; absent entries never become numeric zero or enabled flags. */
export function catalogGroups(catalog:StatusFieldCatalogGroup[], observations:StatusGroup[], kind:'panel'|'effect'):DisplayGroup[] {
  const normalized = observations.map(group => ({ ...group, entries:deduplicateEntries(group.entries) }));
  const used = new Set<StatusEntry>();
  const result:DisplayGroup[] = catalog.map((group, gi) => ({
    id:`${kind}-${gi}`, title:group.title, kind,
    rows:group.entries.map((field, ri) => {
      const entry=normalized.filter(g => g.title===group.title).flatMap(g => g.entries).find(e => e.label===field.label && !used.has(e));
      if(entry)used.add(entry);
      return { id:`${kind}-${gi}-${ri}`, label:field.label, entry };
    }),
  }));
  normalized.forEach((group, gi) => {
    const extras=group.entries.filter(entry => !used.has(entry));
    if(extras.length)result.push({id:`${kind}-extra-${gi}`,title:group.title,kind,rows:extras.map((entry,ri)=>({id:`${kind}-extra-${gi}-${ri}`,label:entry.label,entry}))});
  });
  return result;
}

export function CharacterDetails({ snapshot, synthetic=false, mobile=false }: { snapshot:SaveSnapshot; synthetic?:boolean; mobile?:boolean }) {
  const titleId=useId(), scroll=useRef<HTMLDivElement>(null);
  const valid=isCharacterStatus(snapshot.characterStatus);
  const status=valid && snapshot.characterStatus!.referenceSnapshotId===snapshot.snapshotId ? snapshot.characterStatus : undefined;
  const panelGroups=catalogGroups(CHARACTER_PANEL_CATALOG,status?.groups.filter(g=>!['截图中的能力与资源（核对用）','基础能力与资源'].includes(g.title))??[],'panel');
  const effectGroups=catalogGroups(CHARACTER_EFFECT_CATALOG,status?.effects??[],'effect');
  const basicGroup:DisplayGroup={id:'basic',title:'基础能力与资源',kind:'basic',rows:BASIC.map(([label,value],i)=>({id:`basic-${i}`,label,value:value(snapshot).toLocaleString('zh-CN')}))};
  const derived=synthetic?undefined:matchingResearchStatus(snapshot);
  const panelOrder=panelGroups.flatMap(g=>g.rows).map(r=>r.id);
  const groups=[basicGroup,...panelGroups,...effectGroups];
  const categories=[{id:'basic',title:'基础能力与资源',groups:[basicGroup]},{id:'panel',title:'详细属性',groups:panelGroups},{id:'effect',title:'特殊效果',groups:effectGroups}];
  const count=groups.reduce((n,g)=>n+g.rows.length,0);
  const values=(group:DisplayGroup)=><dl className="nd-detail-values">{group.rows.map(row=>{
    const projected=group.kind==='panel'?derived?.panel.find(p=>p.index===panelOrder.indexOf(row.id)+1):group.kind==='effect'?derived?.effects.find(e=>e.id===row.id):undefined;
    const projectionValue=projected?.display;
    const value=projected?(projectionValue??(projected.state==='context-unknown'?'武器情景 · 活动槽未知':'未解析')):group.kind==='basic'?row.value:row.entry?(row.entry.value===null?'无数值记录':group.kind==='panel'?formatPanelValue(row.entry):row.entry.value):'未解析';
    const source=projected?(projected.state==='ordinary'?'ordinary-projection':projected.state==='scene-default'?'user-scene-default':'unparsed'):group.kind==='basic'?(synthetic?'synthetic':'snapshot-basic'):row.entry?(synthetic?'synthetic-observation':'screenshot'):'unparsed';
    return <div key={row.id} data-detail-row={row.id} data-value-source={source} title={projected && projected.state!=='ordinary' ? `${projected.reason??'用户指定大界面场景'}${projected.contexts?.map(c=>`；${c.label}: ${c.display??'未知'}`).join('')??''}`:undefined}><dt>{row.label}{projected ? projected.state==='ordinary' ? null : <small>{projected.state==='scene-default'?'场景默认':'未知'}</small> : row.entry?<small>图{row.entry.pages.join('、')}</small>:null}</dt><dd>{group.kind==='basic'?<GameBitmapText>{value!}</GameBitmapText>:value}</dd></div>;
  })}</dl>;
  return <section className={`nm-section nm-complete-character-details ${mobile?'nm-mobile-character-details':'nd-character-details'}`} aria-labelledby={titleId}>
    <div className="nd-details-heading"><h2 id={titleId}><GameBitmapText>{mobile?'02 人物详细属性':'人物详细属性'}</GameBitmapText></h2>{mobile?<span>48项面板 · 116条效果</span>:null}</div>
    {derived?.guardianSources?<details className="nd-detail-group" data-guardian-source-separation>
      <summary>守护灵固定词条与魂核实例 · 运行态未知</summary>
      {derived.guardianSources.guardians.map((guardian,gi)=><section key={gi}>
        <h4>守护灵{gi+1} · 游戏表固定词条</h4>
        <dl className="nd-detail-values">{guardian.fixedEntries.map((entry,i)=><div key={i}><dt>{entry.label}</dt><dd>{entry.ordinarySourceDisplay??'资格或数值未确认'}</dd></div>)}</dl>
        {guardian.coreInstances.map((core,ci)=><section key={ci}><h4>魂核实例{ci+1} · 存档记录</h4><dl className="nd-detail-values">{core.entries.map((entry,i)=><div key={i}><dt>{entry.label}</dt><dd>{entry.ordinarySourceDisplay??'未解析'}</dd></div>)}</dl></section>)}
      </section>)}
    </details>:null}
    {mobile && !derived?<p className="nd-details-provenance" role="note">
      {synthetic ? '合成预览 · 不代表当前存档解析结果。' : null}
      {status ? `截图记录 · 非自动解析 · ${status.recordedOn} · ${status.screenshotCount}张。` : valid ? '截图记录属于另一快照，未应用到当前角色。' : '37项最终面板与116条总效果尚未自动解析；未知值保持未解析。'}
      {status ? '数值仅代表记录时状态，不证明当前配装或效果仍然生效。' : '字段目录来自已核对的历史截图，不带入历史数值。'}
    </p>:null}
    {mobile?<label className="nd-details-jump">分组<select aria-label="属性分组跳转" defaultValue="category-basic" onChange={event=>{
      const target=scroll.current?.querySelector<HTMLElement>(`[data-group-id="${event.target.value}"]`);
      if(target && scroll.current)scroll.current.scrollTo({top:target.getBoundingClientRect().top-scroll.current.getBoundingClientRect().top+scroll.current.scrollTop,behavior:'auto'});
    }}>{categories.map(category=><option key={category.id} value={`category-${category.id}`}>{category.title}（{category.groups.reduce((n,g)=>n+g.rows.length,0)}）</option>)}<optgroup label="详细分组">{groups.filter(g=>g.kind!=='basic').map(group=><option key={group.id} value={group.id}>{group.kind==='effect'?'特殊效果 · ':''}{group.title}（{group.rows.length}）</option>)}</optgroup></select><span>{count}条可查看</span></label>:null}
    <div ref={scroll} className="nd-details-scroll" tabIndex={0} role="region" aria-label="完整人物属性与特殊效果">
      {categories.map(category=><section key={category.id} className="nm-detail-category" data-detail-category={category.id} data-group-id={`category-${category.id}`}>
        <h3>{category.title}<small>{category.groups.reduce((n,g)=>n+g.rows.length,0)}项</small></h3>
        {category.groups.map(group=><section key={group.id} className="nd-detail-group" data-group-id={group.id} data-detail-kind={group.kind}>
          {group.kind!=='basic'?<h4>{group.title}<small>{group.rows.length}项</small></h4>:null}{values(group)}
        </section>)}
      </section>)}
    </div>
  </section>;
}

// Retain the internal name used by earlier tests; both platforms now render the same component.
export const DesktopCharacterDetails = CharacterDetails;
