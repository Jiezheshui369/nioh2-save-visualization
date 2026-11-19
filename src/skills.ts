import catalog from './skillDefinitions.json';
export const skillDefinitions=catalog.nodes;
export const skillDisplayName=(name:string)=>name.replace(/%[-+0-9.$]*[dsf]/g,'—');
export interface SavedSkill { skillId:number; savedRecordPresent:boolean|null; learned:boolean|null; storedRank:number|null }
export interface Skills {
  version:1;gameId:'nioh2';definitionVersion:string;inputSha256:string;
  state:'verified-saved-learning'|'unknown';reason:string|null;entries:SavedSkill[];
  current:{canPurchase:null;visible:null;questEligibility:null;dlcEligibility:null};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function isSkills(value:unknown):value is Skills {
  if(!object(value)||value.version!==1||value.gameId!=='nioh2'||value.definitionVersion!==catalog.version||typeof value.inputSha256!=='string'||!(/^[0-9a-f]{64}$/).test(value.inputSha256))return false;
  const known=value.state==='verified-saved-learning';
  if(!known&&value.state!=='unknown'||value.reason!==(known?null:'unsupported-layout-or-chain'))return false;
  const current=value.current;
  if(!object(current)||Object.keys(current).length!==4||!['canPurchase','visible','questEligibility','dlcEligibility'].every(k=>current[k]===null))return false;
  if(!Array.isArray(value.entries)||value.entries.length!==skillDefinitions.length)return false;
  const bounds=new Map(skillDefinitions.map(n=>[n.skillId,n.maxRank]));const seen=new Set<number>();
  return value.entries.every(e=>{
    if(!object(e)||typeof e.skillId!=='number'||!bounds.has(e.skillId)||seen.has(e.skillId))return false;
    seen.add(e.skillId);
    if(!known)return e.savedRecordPresent===null&&e.learned===null&&e.storedRank===null;
    if(typeof e.savedRecordPresent!=='boolean'||typeof e.learned!=='boolean')return false;
    if(!e.savedRecordPresent)return e.learned===false&&e.storedRank===null;
    return typeof e.storedRank==='number'&&Number.isInteger(e.storedRank)&&e.storedRank>=0&&e.storedRank<=bounds.get(e.skillId)!&&(!e.learned||e.storedRank>=1);
  });
}
