import type { SaveSnapshot } from './types';

export interface DerivedEntry {
  state: 'ordinary' | 'scene-default' | 'context-unknown' | 'unknown';
  display: string | null;
  liveValue: null;
  reason: string | null;
  contexts?: Array<{label:string; display:string|null; state?:string}>;
}
export interface ResearchStatus {
  version: 1;
  researchVersion: 'v1127-20261026T051755899930Z';
  inputSha256: string;
  scope: 'ordinary-persisted-source-projection';
  liveRuntimeVerified: false;
  runtime: {activeMeleeSlot:null; activeRangedSlot:null; actorBE8:null; triggeredEffects:null; currentAnima:null};
  panel: Array<DerivedEntry & {index:number; label:string; current?:0; currentReadFromBin?:false; currentSource?:string}>;
  effects: Array<DerivedEntry & {id:string; label:string; category:'ordinary'|'weapon-context'|'no-qualified-source'; definitions:string[]}>;
  guardianSources: null | {status:'persisted-sources-only';activeSlot:null;liveTriggered:null;guardians:Array<{
    savedKey:number;fixedEntries:SourceEntry[];coreInstances:Array<{entries:SourceEntry[]}>;
  }>};
  pairedSystemSha256?: string;
}
interface SourceEntry {label:string;ordinarySourceDisplay:string|null;liveValue:null}
const rec=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v);
const text=(v:unknown,max=1024):v is string=>typeof v==='string' && v.length<=max;
function entry(v:unknown):v is DerivedEntry {
  return rec(v) && ['ordinary','scene-default','context-unknown','unknown'].includes(String(v.state))
    && (v.display===null || text(v.display,100)) && v.liveValue===null
    && (v.reason===null || text(v.reason))
    && (v.contexts===undefined || Array.isArray(v.contexts) && v.contexts.length<=8 && v.contexts.every(x=>rec(x)&&text(x.label,100)&&(x.display===null||text(x.display,100))));
}
export function isResearchStatus(v:unknown):v is ResearchStatus {
  if(!rec(v)||v.version!==1||v.researchVersion!=='v1127-20261026T051755899930Z'
    ||v.scope!=='ordinary-persisted-source-projection'||v.liveRuntimeVerified!==false
    ||typeof v.inputSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.inputSha256)||!rec(v.runtime))return false;
  if(!['activeMeleeSlot','activeRangedSlot','actorBE8','triggeredEffects','currentAnima'].every(k=>v.runtime && (v.runtime as Record<string,unknown>)[k]===null))return false;
  if(!Array.isArray(v.panel)||v.panel.length!==37||!Array.isArray(v.effects)||v.effects.length!==116)return false;
  const ids=new Set<number>();
  for(const p of v.panel){
    if(!entry(p)||!rec(p)||!Number.isInteger(p.index)||(p.index as number)<1||(p.index as number)>37||ids.has(p.index as number)||!text(p.label,160))return false;
    ids.add(p.index as number);
    if([8,11,14,16].includes(p.index as number)&&(p.state!=='unknown'||p.display!==null))return false;
    if(p.state==='unknown' && p.display!==null)return false;
    if(p.index===4 && !['unknown','scene-default'].includes(p.state))return false;
    if(p.state==='ordinary' && p.display===null)return false;
    if(p.state==='scene-default'&&(p.index!==4||p.current!==0||p.currentReadFromBin!==false||p.currentSource!=='user_specified_main_menu_default'||typeof p.display!=='string'||!/^0\/\d+(?:\.\d+)?$/.test(p.display)))return false;
  }
  const effects=new Set<string>();
  for(const e of v.effects){
    if(!entry(e)||!rec(e)||!text(e.id,60)||!/^effect-\d+-\d+$/.test(e.id)||effects.has(e.id)||!text(e.label,160)
      ||!['ordinary','weapon-context','no-qualified-source'].includes(String(e.category))||!Array.isArray(e.definitions)
      ||e.definitions.length>4||!e.definitions.every(x=>typeof x==='string'&&/^0x[a-f0-9]{1,4}$/.test(x)))return false;
    effects.add(e.id);
    if(e.category!=='ordinary'&&e.display!==null)return false;
    if(e.state==='unknown'&&e.display!==null)return false;
  }
  if(v.guardianSources!==null){
    const g=v.guardianSources;
    const source=(x:unknown)=>rec(x)&&text(x.label,160)&&(x.ordinarySourceDisplay===null||text(x.ordinarySourceDisplay,100))&&x.liveValue===null;
    if(!rec(g)||g.status!=='persisted-sources-only'||g.activeSlot!==null||g.liveTriggered!==null||!Array.isArray(g.guardians)||g.guardians.length>2
      ||!g.guardians.every(x=>rec(x)&&typeof x.savedKey==='number'&&Array.isArray(x.fixedEntries)&&x.fixedEntries.length<=6&&x.fixedEntries.every(source)
        &&Array.isArray(x.coreInstances)&&x.coreInstances.length<=3&&x.coreInstances.every(c=>rec(c)&&Array.isArray(c.entries)&&c.entries.length<=7&&c.entries.every(source))))return false;
  }
  return v.pairedSystemSha256===undefined || typeof v.pairedSystemSha256==='string' && /^[a-f0-9]{64}$/.test(v.pairedSystemSha256);
}
export function matchingResearchStatus(snapshot:SaveSnapshot):ResearchStatus|undefined {
  const value=snapshot.researchStatus;
  return isResearchStatus(value) && value.inputSha256===snapshot.safety.snapshotCopySha256?.toLowerCase()?value:undefined;
}
