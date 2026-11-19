import struct,unittest
from agent.skills import derive_skills,CATALOG,NEXT,KEYS,STATES,HEAD

def container(records=()):
    data=bytearray(2715432);data[:8]=b'NIOHUSR\0'
    for p,v in [(8,0x21030200),(0x14,0x148),(0x18,0x296de0),(0x150,0x21030200)]:struct.pack_into('<I',data,p,v)
    struct.pack_into('<2000I',data,NEXT,*([0xFFFFFFFF]*2000));used=[]
    for key,rank,flags in records:
        slot=key%2000
        while slot in used:slot=(slot+1)%2000
        used.append(slot);struct.pack_into('<H',data,KEYS+slot*2,key);struct.pack_into('<HH',data,STATES+slot*4,rank,flags)
    for i,slot in enumerate(used):struct.pack_into('<I',data,NEXT+slot*4,used[i+1] if i+1<len(used) else 2000)
    struct.pack_into('<III',data,HEAD,used[0] if used else 2000,used[-1] if used else 2000,len(used));return data

class SkillsTests(unittest.TestCase):
    def test_saved_learned_unlearned_absent_and_unknown_are_distinct(self):
        a,b=CATALOG['nodes'][:2];data=bytes(container([(a['skillId'],1,7),(b['skillId'],0,0)]));before=bytes(data)
        result=derive_skills(data);entries={e['skillId']:e for e in result['entries']}
        self.assertEqual(result['state'],'verified-saved-learning');self.assertEqual(len(entries),887)
        self.assertTrue(entries[a['skillId']]['learned']);self.assertEqual(entries[a['skillId']]['storedRank'],1)
        self.assertFalse(entries[b['skillId']]['learned']);self.assertTrue(entries[b['skillId']]['savedRecordPresent'])
        absent=next(e for e in entries.values() if not e['savedRecordPresent']);self.assertFalse(absent['learned']);self.assertIsNone(absent['storedRank'])
        self.assertTrue(all(v is None for v in result['current'].values()));self.assertEqual(data,before)
        self.assertTrue(all(e['learned'] is None for e in derive_skills(bytes(2715432))['entries']))

    def test_chain_count_tail_orphan_rank_and_hash_corruption_are_unknown(self):
        key=CATALOG['nodes'][0]['skillId'];slot=key%2000
        for offset,value in [(HEAD+8,2),(HEAD+4,(slot+1)%2000),(NEXT+slot*4,slot),(NEXT+((slot+1)%2000)*4,2000)]:
            data=container([(key,1,1)]);struct.pack_into('<I',data,offset,value)
            self.assertEqual(derive_skills(bytes(data))['state'],'unknown')
        for rank,flags in [(65535,1),(0,1)]:self.assertEqual(derive_skills(bytes(container([(key,rank,flags)])))['state'],'unknown')
        data=container([(key,1,1)]);struct.pack_into('<H',data,KEYS+slot*2,65535)
        self.assertEqual(derive_skills(bytes(data))['state'],'unknown')

    def test_empty_chain_is_valid_and_not_a_live_eligibility_claim(self):
        result=derive_skills(bytes(container()))
        self.assertEqual(result['state'],'verified-saved-learning');self.assertTrue(all(e['learned'] is False and e['storedRank'] is None for e in result['entries']))

if __name__=='__main__':unittest.main()
