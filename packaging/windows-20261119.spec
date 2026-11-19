# Local independent desktop package. The historical candidate remains read only.
from pathlib import Path
import os
from PyInstaller.utils.hooks import copy_metadata, collect_submodules
project_root=Path(SPECPATH).resolve().parent
web_root=Path(os.environ['NIOH_DESKTOP_WEB_ROOT']).resolve()
datas=[(str(web_root),'dist'),(str(project_root/'public/app.ico'),'public'),
       (str(project_root/'agent/data'),'agent/data'),
       (str(project_root/'agent/tools/katana/katana-savedata-resigner-cli.exe'),'agent/tools/katana'),
       (str(project_root/'agent/tools/katana/LICENSE.txt'),'agent/tools/katana'),
       (str(project_root/'packaging/desktop-webview-host.ps1'),'packaging'),
       (str(project_root/'LICENSE'),'.'),(str(project_root/'THIRD_PARTY_NOTICES.md'),'.')]
for package in ['pywebview','pythonnet','clr_loader','cffi','pycparser','proxy_tools','bottle','typing_extensions','cryptography','Authlib','joserfc','websockets']:
    datas+=copy_metadata(package)
a=Analysis([str(project_root/'desktop_launcher.py')],pathex=[str(project_root)],binaries=[],datas=datas,
    hiddenimports=collect_submodules('agent.research_models')+collect_submodules('authlib')+collect_submodules('joserfc')+collect_submodules('websockets'),
    hookspath=[],hooksconfig={},runtime_hooks=[],excludes=['PyQt5','PyQt6','PySide2','PySide6','cefpython3','gi'],noarchive=False,optimize=0)
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,a.binaries,a.datas,[],name=os.environ.get('SAVE_ASSET_BUILD_NAME','SaveAsset-Windows-20261119-local1'),debug=False,
    bootloader_ignore_signals=False,strip=False,upx=False,console=False,
    icon=str(project_root/'public/app.ico'),version=str(project_root/'packaging/version_info.txt'),
    disable_windowed_traceback=False,manifest=str(project_root/'packaging/windows-display.manifest'))
