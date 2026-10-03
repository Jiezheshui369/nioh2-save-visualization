from pathlib import Path
import unittest

from scripts.check_project_contract import FILES, validate


class ProjectContractTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2]
        self.files = {name: (root / name).read_text(encoding='utf-8-sig') for name in FILES}

    def test_current_metadata_is_consistent_but_not_claimed_compiled(self):
        self.assertIn('native compilation', validate(self.files)['status'])

    def test_lock_and_windows_versions_must_match_source(self):
        for name in ('package-lock.json', 'packaging/version_info.txt'):
            changed = dict(self.files)
            changed[name] = changed[name].replace(validate(self.files)['version'], '99.99.99-test')
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate(changed)

    def test_each_ios_configuration_must_match_android(self):
        name = 'ios/App/App.xcodeproj/project.pbxproj'
        for field in ('MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'PRODUCT_BUNDLE_IDENTIFIER'):
            changed = dict(self.files)
            import re
            changed[name] = re.sub(field + r'\s*=\s*[^;]+;', field + ' = wrong;', changed[name], count=1)
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate(changed)

    def test_spm_must_match_the_locked_platform_version(self):
        changed = dict(self.files)
        name = 'ios/App/CapApp-SPM/Package.swift'
        changed[name] = changed[name].replace('exact:', 'from:')
        with self.assertRaises(ValueError):
            validate(changed)

    def test_missing_configuration_is_not_silently_skipped(self):
        for name in FILES[2:]:
            changed = {**self.files, name: ''}
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate(changed)


if __name__ == '__main__':
    unittest.main()
