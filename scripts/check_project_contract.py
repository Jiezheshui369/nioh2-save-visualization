"""Read-only cross-platform metadata check; not an Xcode or device build."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

FILES = ('package.json', 'package-lock.json', 'capacitor.config.ts',
         'android/app/build.gradle', 'ios/App/App.xcodeproj/project.pbxproj',
         'ios/App/CapApp-SPM/Package.swift', 'packaging/version_info.txt')


def require(condition: bool, message: str):
    if not condition:
        raise ValueError(message)


def matches(source: str, pattern: str, expected: str, label: str, minimum: int = 1):
    values = re.findall(pattern, source)
    require(len(values) >= minimum and all(value == expected for value in values), label + ' differs or is missing')


def validate(files: dict[str, str]) -> dict:
    package = json.loads(files['package.json'])
    lock = json.loads(files['package-lock.json'])
    version = package.get('version')
    require(isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version) is not None,
            'package.json must contain an explicit version')
    core = version.split('-', 1)[0]
    require(lock.get('version') == version and lock.get('packages', {}).get('', {}).get('version') == version,
            'package-lock.json root versions differ')
    dependencies = package.get('dependencies', {})
    capacitor = dependencies.get('@capacitor/core', '')
    require(re.fullmatch(r'\d+\.\d+\.\d+', capacitor) is not None, 'Capacitor core must be pinned')
    require(all(dependencies.get('@capacitor/' + platform) == capacitor for platform in ('android', 'ios')),
            'Capacitor platform versions differ')
    config = files['capacitor.config.ts']
    app_ids = re.findall(r'appId\s*:\s*["\']([^"\']+)["\']', config)
    require(len(app_ids) == 1, 'Capacitor app ID missing or ambiguous')
    app_id = app_ids[0]
    android = files['android/app/build.gradle']
    matches(android, r'versionName\s+["\']([^"\']+)["\']', version, 'Android versionName')
    matches(android, r'applicationId\s+["\']([^"\']+)["\']', app_id, 'Android applicationId')
    codes = re.findall(r'versionCode\s+(\d+)\b', android)
    require(len(codes) == 1 and 0 < int(codes[0]) <= 2100000000, 'Android versionCode invalid')
    ios = files['ios/App/App.xcodeproj/project.pbxproj']
    matches(ios, r'MARKETING_VERSION\s*=\s*([^;\s]+)\s*;', core, 'iOS marketing versions', 2)
    matches(ios, r'CURRENT_PROJECT_VERSION\s*=\s*([^;\s]+)\s*;', codes[0], 'iOS build numbers', 2)
    matches(ios, r'PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;', app_id, 'iOS bundle IDs', 2)
    matches(files['ios/App/CapApp-SPM/Package.swift'],
            r'capacitor-swift-pm\.git["\']\s*,\s*exact:\s*["\']([^"\']+)["\']', capacitor, 'Capacitor SPM version')
    windows = files['packaging/version_info.txt']
    numeric = [int(part) for part in core.split('.')] + [0]
    for field in ('filevers', 'prodvers'):
        found = re.findall(field + r'\s*=\s*\(([^)]+)\)', windows)
        require(len(found) == 1 and [int(part.strip()) for part in found[0].split(',')] == numeric,
                'Windows ' + field + ' differs')
    for field in ('FileVersion', 'ProductVersion'):
        matches(windows, r"StringStruct\(u?'" + field + r"',\s*u?'([^']+)'\)", version, 'Windows ' + field)
    return {'version': version, 'nativeBuild': int(codes[0]), 'capacitor': capacitor,
            'status': 'metadata consistent; native compilation and device checks remain separate'}


def check(root: Path) -> dict:
    return validate({name: (root / name).read_text(encoding='utf-8-sig') for name in FILES})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    print(json.dumps(check(parser.parse_args().root)))
