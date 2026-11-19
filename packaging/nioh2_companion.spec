# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import os
from PyInstaller.utils.hooks import copy_metadata, collect_submodules


project_root = Path(SPECPATH).resolve().parent
datas = [
    (str(project_root / "public" / "app.ico"), "public"),
    (str(Path(os.environ.get('NIOH_DESKTOP_WEB_ROOT', str(project_root / 'dist'))).resolve()), "dist"),
    (str(project_root / "agent" / "data"), "agent/data"),
    (str(project_root / "agent" / "tools" / "katana" / "katana-savedata-resigner-cli.exe"), "agent/tools/katana"),
    (str(project_root / "agent" / "tools" / "katana" / "LICENSE.txt"), "agent/tools/katana"),
    (str(project_root / 'docs' / 'WINDOWS_PORTABLE_0716.md'), '.'),
    (str(project_root / "THIRD_PARTY_NOTICES.md"), "."),
    (str(project_root / "LICENSE"), "."),
    (str(project_root / 'packaging' / 'desktop-webview-host.ps1'), 'packaging'),
]
for package in ['pywebview', 'pythonnet', 'clr_loader', 'cffi', 'pycparser', 'proxy_tools', 'bottle', 'typing_extensions', 'cryptography', 'Authlib']:
    datas += copy_metadata(package)

a = Analysis(
    [str(project_root / "desktop_launcher.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=collect_submodules('authlib.jose'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'cefpython3', 'gi'],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="仁王2存档伴侣",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(project_root / "public" / "app.ico"),
    version=str(project_root / "packaging" / "version_info.txt"),
    disable_windowed_traceback=False,
)
console_exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name='Nioh2Console',
    console=True, debug=False, strip=False, upx=True,
    icon=str(project_root / 'public' / 'app.ico'),
    version=str(project_root / 'packaging' / 'version_info.txt'),
)
coll = COLLECT(
    exe,
    console_exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Nioh2SaveCompanion",
)
