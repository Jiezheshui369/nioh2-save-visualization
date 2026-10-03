"""Opt-in TLS delivery of a user-published, redacted character archive.

No save discovery, parser, file upload or static-file routes on this listener.
Credentials and archives live only in memory; stopping revokes all devices.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import ssl
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

MAX_ARCHIVE = 25 * 1024 * 1024


def private_ipv4(address: str) -> bool:
    try:
        ip = ipaddress.IPv4Address(address)
        return any(ip in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
    except ValueError:
        return False


def validate_archive(value: object) -> bytes:
    if not isinstance(value, dict) or value.get("format") != "nioh2-character-assets" or value.get("version") != "1.0.0":
        raise ValueError("请先在电脑读取角色，再同步分析结果。")
    snapshot = value.get("character", {})
    safety = snapshot.get("safety", {}) if isinstance(snapshot, dict) else {}
    privacy = snapshot.get("privacy", {}) if isinstance(snapshot, dict) else {}
    if (not isinstance(snapshot, dict) or not isinstance(snapshot.get("character"), dict)
            or not isinstance(safety, dict) or not isinstance(privacy, dict)
            or not isinstance(value.get("builds"), list)
            or privacy.get("redactedForSharing") is not True
            or safety.get("originalMainSaveSha256") not in ("已隐藏", "REDACTED")
            or safety.get("snapshotCopySha256")):
        raise ValueError("仅允许同步已隐去存档指纹的角色档案。")
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(raw) > MAX_ARCHIVE:
        raise ValueError("同步内容超过 25 MB。")
    return raw


class SyncState:
    def __init__(self):
        self.lock = threading.Lock()
        self.archive = None
        self.revision = ""
        self.invite = ""
        self.invite_expires = 0.0
        self.devices: dict[str, float] = {}
        self.session_expires = time.monotonic() + 8 * 3600
        self.last_sent = None
        self.published_at = None

    def publish(self, archive):
        raw = validate_archive(archive)
        with self.lock:
            self.archive = json.loads(raw)
            self.revision = hashlib.sha256(raw).hexdigest()
            self.published_at = datetime.now(timezone.utc).isoformat()
            self.last_sent = None  # Previous revision's request is not receipt of this one.

    def new_invite(self):
        with self.lock:
            self.invite = secrets.token_urlsafe(32)
            self.invite_expires = time.monotonic() + 600
            return self.invite

    def receive(self, token: str, pairing: bool):
        if not isinstance(token, str) or re.fullmatch(r'[A-Za-z0-9_-]{43}', token) is None:
            raise PermissionError('需要有效的配对凭据。')
        with self.lock:
            now = time.monotonic()
            if now >= self.session_expires or self.archive is None:
                raise PermissionError("同步会话已结束，请在电脑重新开启。")
            device_token = None
            if pairing:
                if now >= self.invite_expires or not self.invite or not hmac.compare_digest(self.invite, token):
                    raise PermissionError("二维码已使用或过期，请在电脑重新生成。")
                if len(self.devices) >= 8:
                    raise PermissionError("配对设备已达上限，请关闭同步后重新开启。")
                device_token = secrets.token_urlsafe(32)
                self.devices[device_token] = self.session_expires
                self.invite = ""
            elif not any(hmac.compare_digest(k, token) for k in self.devices):
                raise PermissionError("配对已失效，请重新扫码。")
            self.last_sent = datetime.now(timezone.utc).isoformat()
            return {"archive": self.archive, "revision": self.revision, "deviceToken": device_token}


class SyncHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    state: SyncState

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def do_POST(self):
        if self.path not in ("/v1/pair", "/v1/pull"):
            self.reply(404, {"error": "not_found"})
            return
        try:
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get_all('Transfer-Encoding', []) or lengths != ['0']:
                raise ValueError("不接受文件上传。")
            authorizations = self.headers.get_all('Authorization', [])
            match = re.fullmatch(r'Bearer ([A-Za-z0-9_-]{43})', authorizations[0]) if len(authorizations) == 1 else None
            if match is None:
                raise PermissionError("需要有效的配对凭据。")
            token = match.group(1)
            self.reply(200, self.state.receive(token, self.path == "/v1/pair"))
        except PermissionError as exc:
            self.reply(401, {"error": str(exc)})
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except OSError:
            pass

    def log_message(self, *_):
        pass  # Never log credentials, QR values or archive contents.


class TLSServer(ThreadingHTTPServer):
    daemon_threads = True

    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(5)
        return sock, address


class MobileSync:
    def __init__(self, port: int):
        self.port = port
        self.server = None
        self.state = None
        self.fingerprint = ""
        self.hosts = []
        self.control_lock = threading.Lock()

    def start(self, archive, hosts):
        validate_archive(archive)
        hosts = sorted({h for h in hosts if private_ipv4(h)})
        if not hosts:
            raise ValueError("未找到家庭局域网 IPv4 地址，请连接 Wi-Fi 后重试。")
        # Lazy dependency: ordinary local parsing still works without cryptography.
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Nioh Companion Local Sync")])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
                .not_valid_after(now + timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(h)) for h in hosts]), False)
                .sign(key, hashes.SHA256()))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        with tempfile.TemporaryDirectory(prefix="nioh-sync-") as tmp:
            cert_path, key_path = Path(tmp) / "cert.pem", Path(tmp) / "key.pem"
            cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            context.load_cert_chain(cert_path, key_path)
        state = SyncState()
        state.publish(archive)
        handler = type("ConfiguredSyncHandler", (SyncHandler,), {"state": state})
        server = TLSServer(("0.0.0.0", self.port), handler)
        # Handshake in each request thread, not the accept loop.
        server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
        self.state, self.server, self.hosts = state, server, hosts
        self.fingerprint = cert.fingerprint(hashes.SHA256()).hex()
        threading.Thread(target=server.serve_forever, daemon=True).start()

    def stop(self):
        if self.state:
            with self.state.lock:
                self.state.session_expires = 0
                self.state.archive = None
                self.state.devices.clear()
                self.state.invite = ""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.server = self.state = None

    def status(self, include_invite=False):
        state = self.state
        if not state:
            return {"enabled": False, "urls": [], "devices": 0}
        with state.lock:
            active = time.monotonic() < state.session_expires
            invite_valid = include_invite and active and state.invite and time.monotonic() < state.invite_expires
            urls = ["niohcompanion://pair#" + urlencode({"host": h, "port": self.port, "pin": self.fingerprint, "token": state.invite}) for h in self.hosts] if invite_valid else []
            return {"enabled": active, "urls": urls, "devices": len(state.devices), "lastSent": state.last_sent,
                    "publishedAt": state.published_at,
                    "publishedSnapshotId": state.archive.get("character", {}).get("snapshotId") if state.archive else None,
                    "revision": state.revision, "expiresIn": max(0, int(state.invite_expires - time.monotonic()))}
