"""Owned local service + persistent WebView2 window. No filesystem JS bridge."""
from __future__ import annotations

from pathlib import Path
import threading
import subprocess
from desktop_display import initial_window_geometry

WINDOW_ICON = Path(__file__).resolve().parent / "public" / "app.ico"

LOCALIZATION = {
    'global.quitConfirmation': '确定关闭存档伴侣？本次手机配对将失效，手机已保存的资料不受影响。',
    'global.ok': '确定',
    'global.quit': '退出',
    'global.cancel': '取消',
    'global.saveFile': '保存文件',
    'windows.fileFilter.allFiles': '所有文件',
    'windows.fileFilter.otherFiles': '其他文件',
}


class WindowService:
    """Only stop the server this process created, never another running app."""
    def __init__(self, server):
        self.server = server
        self.thread = threading.Thread(target=server.serve_forever, name='nioh-desktop-http', daemon=True)
        self.started = False
        self.closed = False

    def start(self):
        self.thread.start()
        self.started = True

    def close(self):
        if self.closed:
            return
        self.closed = True
        native_auth = getattr(self.server.RequestHandlerClass, 'native_auth', None)
        if native_auth is not None:
            native_auth.cancel()
        # Revoke pairing before stopping the local control API.
        try:
            self.server.RequestHandlerClass.mobile_sync.stop()
        finally:
            if self.started:
                self.server.shutdown()
                self.thread.join(timeout=5)
            self.server.server_close()


def run_window(server, data_root: Path, *, backend=None, edge_runtime: Path | None = None, self_test=False, self_test_save: Path | None = None):
    service = WindowService(server)
    try:
        if edge_runtime is not None:
            host, port = server.server_address[:2]
            if host != '127.0.0.1':
                raise ValueError('独立窗口的控制服务必须只监听本机。')
            profile = data_root / 'webview-profile'
            profile.mkdir(parents=True, exist_ok=True)
            service.start()
            script = Path(__file__).resolve().parent / 'packaging' / 'desktop-webview-host.ps1'
            args = ['powershell.exe', '-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', str(script),
                '-Url', f'http://127.0.0.1:{port}/', '-Profile', str(profile), '-Runtime', str(edge_runtime.resolve()), '-IconPath', str(WINDOW_ICON)]
            if self_test:
                args.extend(['-SelfTest', '-ResultFile', str(data_root / 'native-window-self-test.json')])
                if self_test_save is not None:
                    args.extend(['-TestSave', str(self_test_save.resolve(strict=True))])
            result = subprocess.run(args, check=False, creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode:
                raise RuntimeError('独立WebView2应用窗口启动失败。')
            return
        if backend is None:
            import webview
            backend = webview
        host, port = server.server_address[:2]
        if host != '127.0.0.1':
            raise ValueError('独立窗口的控制服务必须只监听本机。')
        backend.settings['ALLOW_DOWNLOADS'] = True
        backend.settings['ALLOW_FILE_URLS'] = False
        backend.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
        profile = data_root / 'webview-profile'
        profile.mkdir(parents=True, exist_ok=True)
        service.start()
        window = backend.create_window('存档资产 Save Asset', f'http://127.0.0.1:{port}/',
                              **initial_window_geometry(),
                              background_color='#090b0a', text_select=True)
        # Force modern Chromium; never silently fall back to Internet Explorer.
        options = dict(gui='edgechromium', private_mode=False, storage_path=str(profile),
                       debug=False, localization=LOCALIZATION, icon=str(WINDOW_ICON))
        failure = []
        if self_test:
            from desktop_self_test import verify_window
            def test_window():
                try:
                    verify_window(window, data_root, self_test_save)
                except Exception as exc:
                    failure.append(str(exc))
                finally:
                    window.destroy()
            options['func'] = test_window
        backend.start(**options)
        if failure:
            raise RuntimeError(f'Desktop self-test failed: {failure[0]}')
    finally:
        service.close()
