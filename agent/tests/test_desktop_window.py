import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from http.server import ThreadingHTTPServer
import urllib.request
import json

from agent.nioh2_agent import create_http_server
from desktop_window import LOCALIZATION, WindowService, run_window
from desktop_launcher import build_parser, main


class DesktopWindowTests(unittest.TestCase):
    def server(self):
        s = MagicMock()
        s.server_address = ('127.0.0.1', 13254)
        return s

    def test_persistent_profile_and_no_file_bridge(self):
        s, ui = self.server(), MagicMock()
        with tempfile.TemporaryDirectory() as d:
            run_window(s, Path(d), backend=ui)
            ui.start.assert_called_once_with(gui='edgechromium', private_mode=False,
                storage_path=str(Path(d) / 'webview-profile'), debug=False, localization=LOCALIZATION)
            self.assertNotIn('js_api', ui.create_window.call_args.kwargs)
            self.assertEqual('http://127.0.0.1:13254/', ui.create_window.call_args.args[1])
            ui.settings.__setitem__.assert_any_call('ALLOW_FILE_URLS', False)
        s.RequestHandlerClass.mobile_sync.stop.assert_called_once()
        s.shutdown.assert_called_once()
        s.server_close.assert_called_once()

    def test_render_failure_releases_server_and_pairing(self):
        s, ui = self.server(), MagicMock()
        ui.start.side_effect = RuntimeError('no WebView2')
        with tempfile.TemporaryDirectory() as d, self.assertRaises(RuntimeError):
            run_window(s, Path(d), backend=ui)
        s.shutdown.assert_called_once()
        s.server_close.assert_called_once()
        s.RequestHandlerClass.mobile_sync.stop.assert_called_once()

    def test_window_creation_failure_also_stops_service(self):
        s, ui = self.server(), MagicMock()
        ui.create_window.side_effect = RuntimeError('failure')
        with tempfile.TemporaryDirectory() as d, self.assertRaises(RuntimeError):
            run_window(s, Path(d), backend=ui)
        s.shutdown.assert_called_once()

    def test_rejects_public_control_server(self):
        s, ui = self.server(), MagicMock()
        s.server_address = ('0.0.0.0', 13254)
        with tempfile.TemporaryDirectory() as d, self.assertRaises(ValueError):
            run_window(s, Path(d), backend=ui)
        ui.create_window.assert_not_called()
        s.shutdown.assert_not_called()
        s.server_close.assert_called_once()

    def test_close_is_idempotent_and_unstarted_shutdown_cannot_deadlock(self):
        s = self.server()
        service = WindowService(s)
        service.close(); service.close()
        s.shutdown.assert_not_called()
        s.server_close.assert_called_once()

    def test_actual_http_service_is_stopped_on_window_return(self):
        with tempfile.TemporaryDirectory() as d, patch('agent.nioh2_agent.discover_save_sources', return_value=[]):
            s = create_http_server(store=Path(d), host='127.0.0.1', port=0)
            ui = MagicMock()
            def loop(**kwargs):
                with urllib.request.urlopen(f'http://127.0.0.1:{s.server_port}/api/health') as r:
                    self.assertFalse(json.load(r)['writeBackSupported'])
            ui.start.side_effect = loop
            run_window(s, Path(d), backend=ui)
            self.assertEqual(s.socket.fileno(), -1)
            self.assertFalse(s.RequestHandlerClass.mobile_sync.status()['enabled'])

    def test_occupied_port_is_not_attached_or_terminated(self):
        with patch('sys.argv', ['app']), patch('desktop_launcher.port_is_open', return_value=True), patch('desktop_launcher.webbrowser.open') as browser:
            with self.assertRaisesRegex(RuntimeError, '关闭旧版'):
                main()
            browser.assert_not_called()

    def test_explicit_browser_and_headless_modes_are_preserved(self):
        self.assertTrue(build_parser().parse_args(['--browser']).browser)
        self.assertTrue(build_parser().parse_args(['--no-browser']).no_browser)
        self.assertEqual(build_parser().parse_args([]).port, 13254)


if __name__ == '__main__':
    unittest.main()
