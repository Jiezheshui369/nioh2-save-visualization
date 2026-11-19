import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {DesktopCharacterDetails} from './DesktopCharacterDetails';
import {isResearchStatus,matchingResearchStatus} from './researchStatus';
import {isSupportedSnapshot} from './snapshotValidation';
import {CHARACTER_EFFECT_CATALOG} from './characterStatusCatalog';
import type {ResearchStatus} from './researchStatus';
import type {SaveSnapshot} from './types';
const hash='a'.repeat(64);
function fixture():SaveSnapshot {
 const unknown={state:'unknown' as const,display:null,liveValue:null,reason:'unsupported'};
 const status:ResearchStatus={version:1,researchVersion:'v1127-20261026T051755899930Z',inputSha256:hash,scope:'ordinary-persisted-source-projection',liveRuntimeVerified:false,
 runtime:{activeMeleeSlot:null,activeRangedSlot:null,actorBE8:null,triggeredEffects:null,currentAnima:null},
 panel:Array.from({length:37},(_,i)=>({...unknown,index:i+1,label:'panel'+i})),
 effects:CHARACTER_EFFECT_CATALOG.flatMap((g,gi)=>g.entries.map((e,ri)=>({...unknown,id:`effect-${gi}-${ri}`,label:e.label,category:'ordinary' as const,definitions:[]}))),guardianSources:null};
 status.panel[0]={...status.panel[0],state:'ordinary',display:'5678',reason:null};
 status.panel[3]={...status.panel[3],state:'scene-default',display:'0/17.2',current:0,currentReadFromBin:false,currentSource:'user_specified_main_menu_default',reason:null};
 return {schemaVersion:'1.0.0',snapshotId:'synthetic-status-test',game:'Nioh 2',platform:'Steam',sourceLastWriteLocal:'2026-10-01T00:00:00Z',
 safety:{sourceOpenedReadOnly:true,parsedFromCopy:true,originalMainSaveSha256:hash,snapshotCopySha256:hash,originalHashUnchangedAfterProcessing:true},
 character:{level:1,amrita:0,gold:0,attributes:{constitution:1,heart:1,stamina:1,strength:1,skill:1,dexterity:1,magic:1,courage:1},proficiency:{}},currentLoadout:[],
 inventorySummary:{equipmentRecords:0,equipmentUnknownIds:0,equipmentByType:{},stackedItemRecords:0,scrollRecordsDetected:0},limitations:[],researchStatus:status};
}
afterEach(cleanup);
describe('ordinary projection boundary',()=>{
 it('validates a complete bounded catalog',()=>{const s=fixture();expect(isResearchStatus(s.researchStatus)).toBe(true);expect(isSupportedSnapshot(s)).toBe(true);});
 it('rejects invented final attacks and runtime state',()=>{const s=fixture().researchStatus!;s.panel[7].display='9999';s.panel[7].state='ordinary';expect(isResearchStatus(s)).toBe(false);s.panel[7].display=null;s.panel[7].state='unknown';(s.runtime as unknown as Record<string,unknown>).actorBE8=0;expect(isResearchStatus(s)).toBe(false);});
 it('rejects a scene default advertised as a BIN read',()=>{const s=fixture().researchStatus!;(s.panel[3] as unknown as Record<string,unknown>).currentReadFromBin=true;expect(isResearchStatus(s)).toBe(false);});
 it('does not reuse values for a different input hash',()=>{const s=fixture();s.safety.snapshotCopySha256='b'.repeat(64);expect(matchingResearchStatus(s)).toBeUndefined();render(<DesktopCharacterDetails snapshot={s}/>);expect(screen.queryByText('5678')).toBeNull();});
 it('removes projection copy and its nodes while preserving unknowns and metadata',()=>{const value=fixture();const before=JSON.stringify(value);const{container}=render(<DesktopCharacterDetails snapshot={value}/>);expect(JSON.stringify(value)).toBe(before);expect(screen.getByText('5678')).toBeVisible();expect(screen.getByText('0/17.2')).toBeVisible();expect(screen.queryByRole('note')).toBeNull();expect(screen.queryByText('普通投影')).toBeNull();expect(container.querySelector('[data-value-source="ordinary-projection"] dt small')).toBeNull();expect(container.querySelector('[data-value-source="ordinary-projection"]')).not.toHaveAttribute('title');expect(screen.getByText('场景默认')).toBeVisible();expect(container.querySelectorAll('[data-detail-row]')).toHaveLength(164);expect(container.querySelector('[data-detail-row="panel-1-0"]')).toBeTruthy();});
 it('rejects zero as the value of an unknown effect',()=>{const s=fixture().researchStatus!;s.effects[0].display='0';expect(isResearchStatus(s)).toBe(false);});
});
