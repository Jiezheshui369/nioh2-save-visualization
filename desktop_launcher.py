"""Desktop entry point for the read-only Nioh 2 Save Companion."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import socket
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

from agent.nioh2_agent import create_http_server, serve


KATANA_SHA256 = "677F49B8F7B271303773C4F96D4772320A90FB87F22D510DC1B08682732AFA0E"


def bundle_root() -> Path:
    frozen_root = getattr(sys, "_MEIPASS", None)
    return Path(frozen_root) if frozen_root else Path(__file__).resolve().parent


def app_data_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / "Nioh2SaveCompanion"


def port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def running_agent_status(port: int) -> dict[str, object] | None:
    """Identify our local service instead of trusting any process on the port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
            payload = json.loads(response.read(64 * 1024))
    except (OSError, ValueError, urllib.error.URLError):
        return None
    if not isinstance(payload, dict) or payload.get("status") != "ok" or payload.get("writeBackSupported") is not False:
        return None
    return payload


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def prepare_decryptor(root: Path, data_root: Path) -> Path:
    bundled_directory = root / "agent" / "tools" / "katana"
    bundled_executable = bundled_directory / "katana-savedata-resigner-cli.exe"
    if file_sha256(bundled_executable) != KATANA_SHA256:
        raise RuntimeError("安装包中的解密工具校验失败，已停止读取存档。")

    writable_directory = data_root / "tools" / "katana"
    writable_directory.mkdir(parents=True, exist_ok=True)
    writable_executable = writable_directory / bundled_executable.name
    if not writable_executable.is_file() or file_sha256(writable_executable) != KATANA_SHA256:
        temporary = writable_executable.with_suffix(".tmp")
        shutil.copy2(bundled_executable, temporary)
        os.replace(temporary, writable_executable)
    if file_sha256(writable_executable) != KATANA_SHA256:
        raise RuntimeError("应用数据目录中的解密工具校验失败。")

    bundled_license = bundled_directory / "LICENSE.txt"
    if bundled_license.is_file():
        shutil.copy2(bundled_license, writable_directory / "LICENSE.txt")
    return writable_executable


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="启动仁王2存档伴侣只读桌面版")
    parser.add_argument("--lan", action="store_true", help="在可信家庭局域网开启临时口令配对")
    parser.add_argument("--port", type=int, default=13254)
    parser.add_argument("--browser", action="store_true", help="使用浏览器兼容模式，不创建独立窗口")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--data-dir", type=Path, help="覆盖应用数据目录（用于便携版或测试）")
    parser.add_argument("--source", type=Path, help="明确指定只读存档源目录")
    parser.add_argument("--edge-runtime", type=Path, help="显式复用已有WebView2 .NET程序集目录；不安装依赖")
    parser.add_argument("--window-self-test", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument('--remote-mvp-enable', action='store_true', help='Enable native remote MVP with an existing device vault')
    parser.add_argument('--remote-mvp-provision-key', action='store_true', help='Explicitly provision the current user device key after verified native login')
    parser.add_argument("--window-self-test-save", type=Path, help=argparse.SUPPRESS)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.window_self_test_save and not args.window_self_test:
        raise ValueError('Save self-test requires explicit window self-test mode')
    native_window = not (args.browser or args.no_browser or args.lan)
    if args.remote_mvp_provision_key and not args.remote_mvp_enable:
        raise ValueError('Native device provisioning requires --remote-mvp-enable')
    if (args.remote_mvp_enable or args.remote_mvp_provision_key) and not native_window:
        raise ValueError('Remote MVP switches require the native desktop window')
    url = f"http://127.0.0.1:{args.port}/"
    if port_is_open(args.port):
        if native_window:
            raise RuntimeError(f"端口 {args.port} 已有程序运行。请先关闭旧版存档伴侣，再打开新版；不会接管或终止旧程序。")
        status = running_agent_status(args.port)
        if status is None:
            print(f"端口 {args.port} 已被其他程序占用，存档伴侣没有启动。")
            return 2
        if args.lan and not status.get("lanMode"):
            print("存档伴侣正在以普通本机模式运行。请先关闭原窗口，再双击“启动手机模式.cmd”。")
            return 2
        if not args.no_browser:
            webbrowser.open(url)
        print(f"存档伴侣已经在运行：{url}")
        return 0

    root = bundle_root()
    web_root = root / "dist"
    if not (web_root / "index.html").is_file():
        raise FileNotFoundError(f"安装包缺少网页资源：{web_root}")

    data_root = args.data_dir.resolve() if args.data_dir else app_data_root()
    store = data_root / "snapshots"
    encrypted_snapshots = data_root / "encrypted-snapshots"
    store.mkdir(parents=True, exist_ok=True)
    encrypted_snapshots.mkdir(parents=True, exist_ok=True)
    decryptor = prepare_decryptor(root, data_root)

    if not args.no_browser and not native_window:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    access_token = secrets.token_urlsafe(18) if args.lan else None
    print("仁王2存档伴侣桌面版 · 只读模式")
    print(f"结构化快照目录：{store}")
    server_options = dict(
        native_auth_enabled=native_window,
        native_remote_enabled=native_window and args.remote_mvp_enable,
        native_remote_provision=native_window and args.remote_mvp_provision_key,
        native_remote_directory=data_root / 'native-remote',
        store=store,
        host=host,
        port=args.port,
        web_root=web_root,
        snapshot_workspace=encrypted_snapshots,
        source=args.source,
        decryptor=decryptor,
        access_token=access_token,
    )
    if native_window:
        from desktop_window import run_window
        run_window(create_http_server(**server_options), data_root, edge_runtime=args.edge_runtime, self_test=args.window_self_test, self_test_save=args.window_self_test_save)
    else:
        serve(**server_options)
    return 0


if __name__ == "__main__":
    # Windowed PyInstaller has no console streams. Keep diagnostics without
    # changing the user's files or making startup failure silently disappear.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    try:
        raise SystemExit(main())
    except Exception as exc:
        if os.name == 'nt' and '--window-self-test' not in sys.argv:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,
                f"无法启动独立窗口：{exc}\n\n请确认已安装 Microsoft Edge WebView2 Runtime。\n也可使用 Start-Browser-Mode.cmd 兼容模式；不要卸载或删除已有资料。",
                '存档资产 Save Asset · 启动失败', 0x10)
        else:
            print(str(exc), file=sys.stderr)
        raise SystemExit(1)
