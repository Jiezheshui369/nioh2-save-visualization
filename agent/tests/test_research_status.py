import unittest
from agent.research_status import validate_container, derive_status

def container(size=0x294080):
    data=bytearray(size)
    data[:8]=b'NIOHUSR\0'
    data[8:12]=(0x21030200).to_bytes(4,'little')
    data[0x14:0x18]=(0x148).to_bytes(4,'little')
    data[0x18:0x1C]=(size-0x148).to_bytes(4,'little')
    return data

class ResearchBoundaryTests(unittest.TestCase):
    def test_same_length_zero_filled_rejected(self):
        with self.assertRaises(ValueError):validate_container(bytes(2715432))
    def test_truncated_or_inconsistent_container_rejected(self):
        data=container()
        for bad in [data[:100],data[:-1],data+bytes(1)]:
            with self.subTest(size=len(bad)),self.assertRaises(ValueError):validate_container(bad)
    def test_structure_accepts_modified_stats_without_gameplay_caps(self):
        data=container();data[0x1C4904:0x1C4908]=(0xFFFFFFFF).to_bytes(4,'little')
        validate_container(data)
    def test_unknown_model_profile_never_defaults_to_zero(self):
        status=derive_status(bytes(container()))
        self.assertTrue(all(x['display'] is None for x in status['panel']))
        self.assertTrue(all(x['liveValue'] is None for x in status['effects']))
        self.assertIsNone(status['runtime']['actorBE8'])
        self.assertIsNone(status['runtime']['activeMeleeSlot'])
    def test_nested_system_consumers_have_no_fixture_default(self):
        import inspect
        from agent.research_models.audit_snapshot_organization import audit_snapshot_organization
        from agent.research_models.audit_tea_reward_sources import tea_reward_sources
        from agent.research_models.read_system_organization_context import read_system,SYSTEM_INPUT
        from agent.research_models.reconstruct_luck_snapshot import luck_snapshot
        for fn,param in [(audit_snapshot_organization,'system_path'),(tea_reward_sources,'system_path'),(luck_snapshot,'system_path'),(read_system,'path')]:
            self.assertIsNone(inspect.signature(fn).parameters[param].default)
        self.assertIsNone(SYSTEM_INPUT.get())
        with self.assertRaises(ValueError):read_system()

if __name__=='__main__':unittest.main()
