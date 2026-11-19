"""Product boundary for pinned ordinary-source models, never live actor values."""
from __future__ import annotations

import hashlib
import importlib
import json
import struct
from pathlib import Path
from types import SimpleNamespace
from typing import Any

VERSION = 'v1127-20261026T051755899930Z'
ROOT = Path(__file__).parent / 'data/research-v1'


class MemoryInput:
    """Legacy model path contract, backed only by this invocation's bytes."""
    def __init__(self, data: bytes): self.data = data
    def read_bytes(self): return self.data
    def stat(self): return SimpleNamespace(st_size=len(self.data), st_mtime_ns=0)
    def __str__(self): return 'supplied-in-memory-save-copy'


def validate_container(data: bytes) -> None:
    """Structural validation only; no gameplay caps or legitimacy checks."""
    if len(data) < 0x148 or data[:8] != b'NIOHUSR\0':
        raise ValueError('不是有效的已解密 NIOHUSR 存档容器')
    header, payload = struct.unpack_from('<II', data, 0x14)
    if header != 0x148 or header + payload != len(data):
        raise ValueError('存档容器长度与头部记录不一致')
    if struct.unpack_from('<I', data, 8)[0] != 0x21030200:
        raise ValueError('未支持的存档序列化版本')


def derive_status(data: bytes, paired_system_path: Path | None = None) -> dict[str, Any]:
    """Every nested system consumer gets this invocation's explicit dependency.

    None remains None. No research fixture path is present in the product modules.
    Unsupported families fail independently while direct parsing stays available.
    """
    from agent.research_models.read_system_organization_context import SYSTEM_INPUT, SYSTEM_CACHE
    panel_catalog = json.loads((ROOT/'panel-capabilities.json').read_text(encoding='utf-8'))
    effect_catalog = json.loads((ROOT/'effect-capabilities.json').read_text(encoding='utf-8'))
    result = {
        'version': 1, 'researchVersion': VERSION,
        'inputSha256': hashlib.sha256(data).hexdigest(),
        'scope': 'ordinary-persisted-source-projection',
        'liveRuntimeVerified': False,
        'runtime': {'activeMeleeSlot': None, 'activeRangedSlot': None, 'actorBE8': None,
                    'triggeredEffects': None, 'currentAnima': None},
        'panel': [dict(index=x['index'], label=x['field'], state='unknown', display=None,
                       reason='该输入尚未通过对应普通场景模型', liveValue=None) for x in panel_catalog],
        'effects': [], 'guardianSources': None, 'errors': [],
    }
    fields = {x['index']:x for x in result['panel']}
    source = MemoryInput(data)
    token = SYSTEM_INPUT.set(paired_system_path)
    cache_token = SYSTEM_CACHE.set({})
    try:
        native = importlib.import_module('agent.research_models.reconstruct_native_life').Native()
    except (OSError, ValueError, KeyError) as error:
        native = None
        result['errors'].append({'model':'resources','reason':str(error)[:500]})

    def run(module, function):
        if native is None: return None
        try:
            return getattr(importlib.import_module('agent.research_models.'+module), function)(source, native, input_bytes=data)
        except (ValueError, AssertionError, KeyError, StopIteration, IndexError, struct.error, OSError, OverflowError) as error:
            result['errors'].append({'model':module, 'reason':str(error)[:500] or type(error).__name__})
            return None

    def put(index, value, model, state='ordinary', **extra):
        if value is not None:
            fields[index].update(state=state, display=str(value), reason=None, model=model, **extra)

    try:
        common = run('reconstruct_native_life','reconstruct')
        if common:
            put(1,common['ordinary_loadout_life'],'reconstruct_native_life')
            ki=common['independent_ki_cross_check']
            values={x['ordinary_ki'] for x in ki}
            if len(ki)==2 and len(values)==1 and None not in values:
                put(2,next(iter(values)),'reconstruct_native_life')
            else:
                fields[2].update(reason='武器类别上下文不同或不受支持；活动武器未知',contexts=ki)
            # Definitions are game-table data; cores are separate saved instances.
            result['guardianSources']={'status':'persisted-sources-only', 'activeSlot':None, 'liveTriggered':None,
                'guardians':[{'savedKey':g.get('save_key'), 'fixedSource':'GuardianSpiritDatabase',
                   'fixedDefinitions':[d for d in g.get('fixed_definitions',[]) if d!='0x0'],
                   'coreSource':'per-instance-BIN', 'coreInstances':g.get('core_effects',[])} for g in common['guardians'] if g.get('save_key') is not None]}
            from agent.research_models.render_native_effect_names import render_name
            from agent.research_models.bind_additional_native_messages import AdditionalMessages
            from agent.research_models.reconstruct_training_panels import normalized_effect
            from agent.research_models.reconstruct_native_life import u16
            from agent.research_models.project_native_effect_list import project_rows
            from agent.research_models.localize_native_effect_subset import localize
            messages=AdditionalMessages(native)
            fixed=run('reconstruct_guardian_fixed_sources','guardian_fixed_sources')
            fixed_sources=fixed['sources'] if fixed else []
            for guardian in result['guardianSources']['guardians']:
                def named(definition, value=None):
                    label=render_name(native,messages,int(definition,16))['text'] or definition
                    display=None
                    if value is not None:
                        projected=project_rows(native,[{'definition':definition,'applied_value':value}])['rows']
                        display=localize(native,messages,projected[0])['localized_value'] if projected else None
                    return {'definition':definition,'label':label,'ordinarySourceDisplay':display,
                            'sourceParameter':value,'liveValue':None}
                guardian['fixedEntries']=[]
                for definition in guardian['fixedDefinitions']:
                    eligible=next((x for x in fixed_sources if x['definition']==definition and x['guardian_evidence']['guardian_key']==guardian['savedKey']),None)
                    guardian['fixedEntries'].append(named(definition,eligible['value'] if eligible else None))
                for core in guardian['coreInstances']:
                    core['entries']=[]
                    off=int(core['offset'],16);raw=data[off:off+144]
                    try:
                        _,item=native.row('ItemDatabase',u16(raw,0))
                        for effect in native.effects(raw):
                            norm=normalized_effect(native,raw,item,effect['slot'])
                            core['entries'].append(named(effect['definition'],norm['native_recomputed_value']))
                    except (ValueError,KeyError,IndexError,struct.error) as error:
                        core['reason']=str(error)[:500]
        training=run('reconstruct_training_panels','panels')
        if training:
            put(3,training['ki_recovery']['rounded_display'],'reconstruct_training_panels')
            put(32,training['onmyo']['sum'],'reconstruct_training_panels')
        anima=run('reconstruct_anima_maximum','anima_maximum')
        if anima:
            maximum=anima['ordinary_maximum']['display']
            put(4,'0/'+maximum,'reconstruct_anima_maximum','scene-default', maximum=maximum,
                current=0,currentSource='user_specified_main_menu_default', currentReadFromBin=False)
        armor=run('reconstruct_armor_panels','armor_panels')
        if armor:
            weight=armor['weight']
            put(5,weight['used_display']+'/'+weight['max_display'],'reconstruct_armor_panels')
            put(6,weight['ratio_display'],'reconstruct_armor_panels')
            put(19,armor['toughness']['sum'],'reconstruct_armor_panels')
            put(30,armor['ninjutsu']['sum'],'reconstruct_armor_panels')
        capacity=run('reconstruct_capacity_agility','capacity_agility')
        if capacity:
            put(7,capacity['agility']['display_grade'],'reconstruct_capacity_agility')
            put(31,capacity['capacities']['ninjutsu'],'reconstruct_capacity_agility')
            put(33,capacity['capacities']['onmyo'],'reconstruct_capacity_agility')
        weapons=run('reconstruct_weapon_break_block','weapon_break_block')
        if weapons:
            for index,key in [(9,'weapon1Break'),(10,'weapon1Block'),(12,'weapon2Break'),(13,'weapon2Block'),(15,'weapon3Break'),(17,'weapon4Break')]:
                put(index,weapons['ordinary_fields'][key],'reconstruct_weapon_break_block')
        for index in (8,11,14,16): fields[index]['reason']='最终攻击力计算链尚未闭合'
        defense=run('reconstruct_defense_panel','defense_panel')
        if defense:put(18,defense['ordinary_defense'],'reconstruct_defense_panel')
        resist=run('reconstruct_six_resistances','six_resistances')
        if resist:
            for index,key in enumerate(['physical','fire','water','lightning','poison','paralysis'],20):
                put(index,resist['ordinary_fields'][key],'reconstruct_six_resistances')
        adjacent=run('reconstruct_adjacent_panels','adjacent_panels')
        if adjacent:
            for index,key in [(26,'ninjutsuResistance'),(27,'onmyoResistance')]:
                put(index,adjacent['ordinary_fields'][key]['display'],'reconstruct_adjacent_panels')
            for index,key in [(35,'initialKiPulse'),(37,'astralWisdom')]:
                put(index,adjacent['ordinary_fields'][key]['value'],'reconstruct_adjacent_panels')
        fall=run('reconstruct_resistance_fall','resistance_fall')
        if fall:
            for index,key in [(28,'yokaiResistance'),(29,'purityResistance'),(36,'fallDamageReduction')]:
                put(index,fall['ordinary_fields'][key],'reconstruct_resistance_fall')
        luck=run('reconstruct_luck_snapshot','luck_snapshot')
        if luck:
            put(34,luck['ordinary_luck'],'reconstruct_luck_snapshot')
            result['pairedSystemSha256']=luck['system_input']['encrypted_sha256']
        else:fields[34]['reason']='需要同账户的有效配对系统存档与已支持的势力/茶器条件'

        # Merge independent source families at the native ID boundary, then map
        # the fixed catalog by IDs. Numeric sample results never enter this path.
        by_definition={}
        batch=run('reconstruct_effect_catalog_batch','effect_batch')
        if batch:
            from agent.research_models.project_native_effect_list import project_rows
            from agent.research_models.localize_native_effect_subset import localize
            from agent.research_models.bind_additional_native_messages import AdditionalMessages
            m=AdditionalMessages(native)
            for row in project_rows(native,batch['native_merge']['records'])['rows']:
                localized=localize(native,m,row)
                by_definition[row['definition']]=localized
            ki_contexts=[]
            for context in batch['ki_contexts']:
                rows=project_rows(native,context['source_merge']['records'])['rows']
                ki_contexts.append({'label':'melee'+str(context['weapon_slot_context']),
                                   'rows':[localize(native,m,row) for row in rows]})
            for c in ki_contexts:
                for row in c['rows']:
                    old=by_definition.setdefault(row['definition'],dict(row,contexts=[]))
                    old['contexts'].append({'label':c['label'],'display':row['localized_value']})
        for module,function,key in [('reconstruct_ultimate_effect_family','ultimate_family','native_list_projection'),
                                    ('reconstruct_onmyo_effect_list','onmyo_effect_list','list_rows'),
                                    ('reconstruct_absent_source_effects','absent_source_effects','list_rows')]:
            family=run(module,function)
            if family:
                for row in family[key]: by_definition[row['definition']]=row
        contexts=run('reconstruct_weapon_affix_contexts','weapon_affix_contexts')
        context_cases=contexts['cases'] if contexts else []
        for item in effect_catalog:
            status=item['status']
            category='weapon-context' if 'context_source_projections' in status else 'no-qualified-source' if ('absent' in status) else 'ordinary'
            ids=item['native_definition_ids']
            row={'id':item['catalog_id'],'label':item['label'],'definitions':ids,'category':category,
                 'state':'unknown','display':None,'liveValue':None,'reason':None,'contexts':[]}
            if category=='weapon-context':
                for case in context_cases:
                    values=[x for x in case.get('list_rows') or [] if x['definition'] in ids]
                    label=f"近战{case['projected_melee_slot']+1} / 远程{case['projected_ranged_slot']-8}"
                    row['contexts'].append({'label':label,'state':case['status'],
                                            'display':' / '.join(x['localized_value'] for x in values) if values else None})
                row.update(state='context-unknown',reason='活动武器、运行态触发与 BE8 未知；按槽位分别投影')
            elif category=='no-qualified-source':
                row.update(reason='普通场景无合格来源或未激活；运行态未知')
            else:
                matches=[by_definition[d] for d in ids if d in by_definition]
                if len(matches)==1:
                    row.update(state='ordinary',display=matches[0]['localized_value'] or '条件条目',
                               sources=matches[0].get('sources',[]), contexts=matches[0].get('contexts',[]))
                else:row['reason']='该输入的来源、资格或配对系统条件尚未通过'
            result['effects'].append(row)
        result['counts']={'panelOrdinary':sum(x['state']=='ordinary' for x in result['panel']),
                          'panelSceneDefault':sum(x['state']=='scene-default' for x in result['panel']),
                          'effectOrdinary':sum(x['state']=='ordinary' for x in result['effects']),
                          'historicalCatalog':{'ordinary':97,'weaponContext':15,'noQualifiedSource':4}}
        result['assumptions']=['普通持久化来源；无等级同步、临时状态或替代表',
                               '武器情景使用明确的单位倍率 1.0；不推断活动槽',
                               '妖力当前 0 是用户指定大界面场景默认；BIN 实时当前值未知']
        return result
    finally:
        SYSTEM_CACHE.reset(cache_token)
        SYSTEM_INPUT.reset(token)
