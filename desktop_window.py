"""Owned local service + persistent WebView2 window. No filesystem JS bridge."""
from __future__ import annotations

from pathlib import Path
import threading

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
        # Revoke pairing before stopping the local control API.
        try:
            self.server.RequestHandlerClass.mobile_sync.stop()
        finally:
            if self.started:
                self.server.shutdown()
                self.thread.join(timeout=5)
            self.server.server_close()


def run_window(server, data_root: Path, *, backend=None):
    service = WindowService(server)
    try:
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
        backend.create_window('Nioh · 存档伴侣', f'http://127.0.0.1:{port}/',
                              width=1280, height=900, min_size=(800, 600),
                              background_color='#090b0a', text_select=True)
        # Force modern Chromium; never silently fall back to Internet Explorer.
        backend.start(gui='edgechromium', private_mode=False, storage_path=str(profile),
                      debug=False, localization=LOCALIZATION)
    finally:
        service.close()
