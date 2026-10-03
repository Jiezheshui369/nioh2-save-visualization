"""Static project wiring checks, NOT Swift compilation or iOS device tests."""
import json
from pathlib import Path
import plistlib
import re
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'ios/App/App'


class NativeProjectTests(unittest.TestCase):
    def test_every_swift_file_is_in_sources_phase(self):
        project = (ROOT / 'ios/App/App.xcodeproj/project.pbxproj').read_text(encoding='utf-8')
        sources = project.split('/* Begin PBXSourcesBuildPhase section */')[1].split('/* End PBXSourcesBuildPhase section */')[0]
        for source in APP.glob('*.swift'):
            with self.subTest(source=source.name):
                self.assertIn(f'/* {source.name} in Sources */', sources)
                self.assertRegex(project, rf'path = {re.escape(source.name)};')
        resources = project.split('/* Begin PBXResourcesBuildPhase section */')[1].split('/* End PBXResourcesBuildPhase section */')[0]
        self.assertIn('PrivacyInfo.xcprivacy in Resources', resources)

    def test_both_app_entry_points_register_custom_bridge(self):
        scene = (APP / 'SceneDelegate.swift').read_text(encoding='utf-8')
        self.assertIn('rootViewController = NiohBridgeViewController()', scene)
        storyboard = ET.parse(APP / 'Base.lproj/Main.storyboard')
        controller = storyboard.find('.//viewController')
        self.assertEqual(controller.attrib['customClass'], 'NiohBridgeViewController')
        self.assertEqual(controller.attrib['customModule'], 'App')
        plugin = (APP / 'LocalSyncPlugin.swift').read_text(encoding='utf-8')
        self.assertIn('registerPluginInstance(LocalSyncPlugin())', plugin)
        for method in ['status', 'forget', 'scan', 'receive']:
            self.assertIn(f'CAPPluginMethod(name: "{method}"', plugin)

    def test_privacy_manifest_and_permissions_are_scoped(self):
        with (APP / 'Info.plist').open('rb') as file:
            info = plistlib.load(file)
        self.assertTrue(info['NSCameraUsageDescription'])
        self.assertTrue(info['NSLocalNetworkUsageDescription'])
        self.assertEqual(info['NSAppTransportSecurity'], {'NSAllowsLocalNetworking': True})
        with (APP / 'PrivacyInfo.xcprivacy').open('rb') as file:
            privacy = plistlib.load(file)
        self.assertFalse(privacy['NSPrivacyTracking'])
        self.assertEqual(privacy['NSPrivacyCollectedDataTypes'], [])
        self.assertIn({'NSPrivacyAccessedAPIType': 'NSPrivacyAccessedAPICategoryFileTimestamp',
                       'NSPrivacyAccessedAPITypeReasons': ['C617.1']}, privacy['NSPrivacyAccessedAPITypes'])

    def test_platform_versions_and_packages_match(self):
        package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
        version = package['version']
        android = (ROOT / 'android/app/build.gradle').read_text(encoding='utf-8')
        self.assertIn(f'versionName "{version}"', android)
        project = (ROOT / 'ios/App/App.xcodeproj/project.pbxproj').read_text(encoding='utf-8')
        self.assertIn(f'MARKETING_VERSION = {version.split("-")[0]};', project)
        for platform in ['android', 'ios']:
            self.assertEqual(package['dependencies'][f'@capacitor/{platform}'], package['dependencies']['@capacitor/core'])
        spm = (ROOT / 'ios/App/CapApp-SPM/Package.swift').read_text(encoding='utf-8')
        self.assertIn(f'exact: "{package["dependencies"]["@capacitor/core"]}"', spm)


if __name__ == '__main__':
    unittest.main()
