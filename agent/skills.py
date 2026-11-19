"""Validated saved skill learning, independent of live visibility and eligibility."""
import hashlib,json,struct
from pathlib import Path

CATALOG=json.loads((Path(__file__).parent/'data/skills-v1.json').read_text('utf8'))
NEXT,KEYS,STATES,HEAD=0x1C4B94,0x1C6AD4,0x1C7A74,0x1C99B4
CAPACITY,EMPTY=2000,0xFFFFFFFF

def _require(value):
    if not value: raise ValueError('unsupported-skill-layout-or-chain')

def _records(data):
    _require(len(data)==2715432 and data[:8]==b'NIOHUSR\0' and data[-16:]==bytes(16))
    _require(tuple(struct.unpack_from('<I',data,p)[0] for p in (8,0x14,0x18,0x150))==(0x21030200,0x148,0x296de0,0x21030200))
    bounds={r['skillId']:r['maxRank'] for r in CATALOG['definitions']}
    links=struct.unpack_from('<2000I',data,NEXT)
    _require(all(v==EMPTY or v<=CAPACITY for v in links))
    used={i for i,v in enumerate(links) if v!=EMPTY}
    head,tail,count=struct.unpack_from('<III',data,HEAD)
    _require(count==len(used) and count<=CAPACITY)
    if count==0:
        _require(head==tail==CAPACITY); return {}
    _require(head<CAPACITY and tail<CAPACITY)
    records={};seen=set();slot=head;last=None
    while slot!=CAPACITY:
        _require(slot in used and slot not in seen)
        seen.add(slot);key=struct.unpack_from('<H',data,KEYS+slot*2)[0]
        rank,flags=struct.unpack_from('<HH',data,STATES+slot*4)
        _require(key in bounds and key not in records and rank<=bounds[key] and (not flags&1 or rank>=1))
        probe=key%CAPACITY
        for _ in range(CAPACITY):
            _require(probe in used)
            if struct.unpack_from('<H',data,KEYS+probe*2)[0]==key: break
            probe=(probe+1)%CAPACITY
        else: raise ValueError('exhausted-skill-probe')
        _require(probe==slot)
        records[key]=(rank,flags);last=slot;slot=links[slot]
    _require(seen==used and last==tail)
    return records

def derive_skills(data):
    try: records=_records(data)
    except (ValueError,struct.error): records=None
    entries=[]
    for node in CATALOG['nodes']:
        value=None if records is None else records.get(node['skillId'])
        entries.append(dict(skillId=node['skillId'],savedRecordPresent=None if records is None else value is not None,
            learned=None if records is None else bool(value and value[1]&1),storedRank=None if value is None else value[0]))
    return dict(version=1,gameId='nioh2',definitionVersion=CATALOG['version'],inputSha256=hashlib.sha256(data).hexdigest(),
        state='unknown' if records is None else 'verified-saved-learning',reason='unsupported-layout-or-chain' if records is None else None,
        entries=entries,current=dict(canPurchase=None,visible=None,questEligibility=None,dlcEligibility=None))
