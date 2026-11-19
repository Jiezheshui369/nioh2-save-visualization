"""Experimental, manual, read-only Steam Cloud adapter (no login/session scraping).

Only officially issued OAuth tokens are accepted. Configuration is a local
declaration of Valve approval, not evidence that the API has granted access.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import sys
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

APP_ID = 1325200
ENUMERATE_URL = "https://api.steampowered.com/ICloudService/EnumerateUserFiles/v1/"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FILES = 10000
MAX_JSON_BYTES = 2 * 1024 * 1024
TOKEN_ENV = "NIOH_STEAM_OAUTH_TOKEN"


class CloudError(RuntimeError):
    """Only fixed, credential-free messages reach command output."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CloudConfig:
    client_id: str
    app_ids: tuple[int, ...]
    permissions: tuple[str, ...]
    valve_approval_confirmed: bool

    @classmethod
    def load(cls, path: Path) -> "CloudConfig | None":
        if not path.exists():
            return None
        try:
            if path.stat().st_size > 8192:
                raise ValueError()
            value = json.loads(path.read_text(encoding="utf-8"))
            if set(value) != {"client_id", "app_ids", "permissions", "valve_approval_confirmed"}:
                raise ValueError()
            if (not isinstance(value["client_id"], str) or not value["client_id"].strip()
                    or not isinstance(value["app_ids"], list)
                    or any(type(item) is not int for item in value["app_ids"])
                    or not isinstance(value["permissions"], list)
                    or any(not isinstance(item, str) for item in value["permissions"])
                    or type(value["valve_approval_confirmed"]) is not bool):
                raise ValueError()
            return cls(value["client_id"], tuple(value["app_ids"]), tuple(value["permissions"]),
                       value["valve_approval_confirmed"])
        except (ValueError, TypeError, OSError, KeyError):
            raise CloudError("invalid_configuration", "本地 OAuth 配置无效；不要在配置中存放令牌。") from None


def readiness(config: CloudConfig | None, token: str | None) -> dict:
    missing = []
    if config is None or not config.client_id.strip() or not config.valve_approval_confirmed:
        missing.append("valve_client_approval")
    if config is None or APP_ID not in config.app_ids or "read_cloud" not in config.permissions:
        missing.append("appid_1325200_read_cloud")
    if not token or not token.strip():
        missing.append("user_oauth_token")
    return {"status": "configuration_missing" if missing else "configured_unverified",
            "missing": missing, "appId": APP_ID, "livePullVerified": False,
            "writeBackSupported": False}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CloudError("redirect_rejected", "Steam 返回重定向，实验原型已停止；未转发令牌。")


def validate_download_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 8192:
        raise CloudError("unsafe_download_url", "云文件下载地址无效。")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment
                or parsed.port not in (None, 443)
                or not any(host == domain or host.endswith("." + domain)
                           for domain in ("steampowered.com", "steamcontent.com", "steamusercontent.com"))):
            raise ValueError()
    except ValueError:
        raise CloudError("unsafe_download_url", "下载只允许 Valve 域名的 HTTPS 地址，拒绝重定向。") from None
    return value


@dataclass(frozen=True)
class Reply:
    status: int
    headers: dict[str, str]
    body: bytes = field(repr=False)


def https_get(url: str, limit: int) -> Reply:
    # No browser cookies, inherited proxies, custom CA bypass or automatic redirects.
    opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(Request(url, method="GET"), timeout=30) as response:
            body = response.read(limit + 1)
            if len(body) > limit:
                raise CloudError("response_too_large", "Steam 响应超过原型大小上限。")
            return Reply(response.status, {k.lower(): v for k, v in response.headers.items()}, body)
    except CloudError:
        raise
    except HTTPError as exc:
        # Do not read or echo a server error body, URL, or exception containing a token.
        return Reply(exc.code, {}, b"")
    except Exception:
        raise CloudError("transport_failed", "Steam HTTPS 请求失败或超时；未保存新快照。") from None


def require_success(reply: Reply, *, enumeration: bool) -> None:
    if reply.status in (401, 403):
        raise CloudError("authorization_rejected", "Steam 拒绝授权：请核对令牌有效期与 AppID 1325200 的 read_cloud 授权。")
    if reply.status != 200:
        raise CloudError("steam_http_error", "Steam 返回非成功 HTTP 状态；未保存新快照。")
    result = reply.headers.get("x-eresult")
    if enumeration and result is None:
        raise CloudError("missing_eresult", "Steam 枚举响应缺少 x-eresult；不能认定授权成功。")
    if result is not None and result != "1":
        raise CloudError("steam_result_error", "Steam x-eresult 表明请求失败；请核对 OAuth 授权，旧快照保持不变。")


def uint(value: object, maximum: int) -> int:
    if type(value) is not int or not 0 <= value <= maximum:
        raise CloudError("invalid_metadata", "Steam 云文件元数据结构无效。")
    return value


@dataclass(frozen=True)
class CloudFile:
    filename: str
    slot: str | None
    basename: str
    size: int
    timestamp: int
    sha1: str
    url: str = field(repr=False)

    @classmethod
    def parse(cls, raw: object) -> "CloudFile":
        if not isinstance(raw, dict) or raw.get("appid") != APP_ID:
            raise CloudError("invalid_metadata", "云文件 AppID 或元数据结构不匹配。")
        name = raw.get("filename")
        if (not isinstance(name, str) or not name or len(name) > 1024 or "\\" in name
                or any(ord(c) < 32 or c in ':<>"|?*' for c in name)
                or any(p in ("", ".", "..") for p in name.split("/"))):
            raise CloudError("unsafe_filename", "Steam 云文件名不安全，已停止下载。")
        parts = name.split("/")
        basename = parts[-1]
        slot = parts[-2] if len(parts) > 1 and re.fullmatch(r"SAVEDATA[0-9]{2}", parts[-2]) else None
        sha = raw.get("file_sha")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", sha):
            raise CloudError("invalid_metadata", "云文件缺少有效 SHA-1，无法校验下载。")
        return cls(name, slot, basename, uint(raw.get("file_size"), MAX_FILE_BYTES),
                   uint(raw.get("timestamp"), 253402300799), sha.lower(),
                   validate_download_url(raw.get("url")))


class SteamCloudClient:
    def __init__(self, config: CloudConfig | None, token: str | None,
                 transport: Callable[[str, int], Reply] = https_get):
        state = readiness(config, token)
        if state["missing"]:
            raise CloudError("configuration_missing", "尚未具备 Valve Client ID、AppID read_cloud 配置及用户 OAuth 令牌；未请求 Steam。")
        self._token = token
        self._get = transport

    def enumerate_files(self, count: int = 500) -> list[CloudFile]:
        if type(count) is not int or not 1 <= count <= 500:
            raise CloudError("invalid_page_size", "分页大小必须在 1–500 之间。")
        files: list[CloudFile] = []
        names: set[str] = set()
        total = None
        while total is None or len(files) < total:
            query = urlencode({"access_token": self._token, "appid": APP_ID,
                               "extended_details": 1, "count": count, "start_index": len(files)})
            reply = self._get(ENUMERATE_URL + "?" + query, MAX_JSON_BYTES)
            require_success(reply, enumeration=True)
            try:
                payload = json.loads(reply.body)
                response = payload["response"]
                current_total = uint(response["total_files"], MAX_FILES)
                rows = response.get("files", [])
                if (not isinstance(rows, list) or len(rows) > count
                        or total is not None and total != current_total
                        or len(files) + len(rows) > current_total
                        or not rows and len(files) < current_total):
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise CloudError("invalid_enumeration", "云文件分页不完整或枚举期间发生变化；请重新手动读取。") from None
            total = current_total
            for raw in rows:
                entry = CloudFile.parse(raw)
                if entry.filename.casefold() in names:
                    raise CloudError("duplicate_file", "Steam 返回重复文件；无法建立唯一快照。")
                names.add(entry.filename.casefold())
                files.append(entry)
        return files

    def download(self, entry: CloudFile) -> bytes:
        # A CDN request never receives the OAuth token parameter from enumeration.
        reply = self._get(validate_download_url(entry.url), entry.size)
        require_success(reply, enumeration=False)
        if len(reply.body) != entry.size or hashlib.sha1(reply.body).hexdigest() != entry.sha1:
            raise CloudError("download_integrity_failed", "云文件长度或 SHA-1 不匹配；快照已放弃。")
        return reply.body


def select_slot(files: list[CloudFile], slot: str) -> list[CloudFile]:
    if not re.fullmatch(r"SAVEDATA[0-9]{2}", slot):
        raise CloudError("invalid_slot", "请明确选择 SAVEDATA00–SAVEDATA99 槽位。")
    selected = [f for f in files if f.slot == slot and f.basename in {"SAVEDATA.BIN", "BACKUP.BIN"}]
    if sum(f.basename == "SAVEDATA.BIN" for f in selected) != 1:
        raise CloudError("slot_unavailable", "该槽位没有唯一主存档；不会自动选择其他角色。")
    if len({f.basename for f in selected}) != len(selected):
        raise CloudError("ambiguous_slot", "多个云端路径含同名槽位，请核实账号路径后再接入。")
    # Auto-Cloud filenames can contain an account/root prefix. A matching slot
    # suffix alone does not make a backup belong to the selected main save.
    if len({f.filename.rsplit("/", 1)[0] for f in selected}) != 1:
        raise CloudError("ambiguous_slot", "主存档与备份来自不同云端目录；未下载或混合槽位。")
    return selected


def cloud_root(project_root: Path, workspace: Path) -> Path:
    # Keep raw saves within an explicitly local, ignored directory of this checkout.
    # Reject symlink/junction redirection as well as original game/save destinations.
    local = project_root.absolute() / ".local"
    target = workspace.absolute()
    if local not in target.parents:
        raise CloudError("unsafe_workspace", "云存档工作区必须位于本项目 .local 的独立子目录。")
    for path in [local, *target.parents, target]:
        if path.exists() and (path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400):
            raise CloudError("unsafe_workspace", "云工作区不能通过符号链接或目录联接指向其他位置。")
    if local.resolve() not in target.resolve().parents:
        raise CloudError("unsafe_workspace", "云工作区超出本项目 .local。")
    return target


def pull_snapshot(client: SteamCloudClient, slot: str, workspace: Path, project_root: Path) -> Path:
    root = cloud_root(project_root, workspace)
    if not re.fullmatch(r"SAVEDATA[0-9]{2}", slot):
        raise CloudError("invalid_slot", "请明确选择 SAVEDATA00–SAVEDATA99 槽位。")
    files = client.enumerate_files()
    selected = select_slot(files, slot)
    target = root / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + secrets.token_hex(4))
    target.mkdir(parents=True, exist_ok=False)
    incomplete = target / ".incomplete"
    incomplete.write_text("Cloud download not committed.", encoding="utf-8")
    records = []
    for entry in selected:
        blob = client.download(entry)
        path = target / slot / entry.basename
        path.parent.mkdir(exist_ok=True)
        with path.open("xb") as stream:
            stream.write(blob)
        os.utime(path, (entry.timestamp, entry.timestamp))
        digest = hashlib.sha256(blob).hexdigest().upper()
        records.append({"relative_path": path.relative_to(target).as_posix(), "size": entry.size,
                        "source_sha256": digest, "copy_sha256": digest,
                        "source_last_write_utc": datetime.fromtimestamp(entry.timestamp, timezone.utc).isoformat(),
                        "cloud_sha1": entry.sha1})
    # Re-enumerate before commit to avoid mixing revisions while files are changing.
    after = select_slot(client.enumerate_files(), slot)
    identity = lambda values: sorted((f.filename, f.size, f.timestamp, f.sha1) for f in values)
    if identity(after) != identity(selected):
        raise CloudError("cloud_changed", "下载期间云端槽位发生变化；未提交快照，请重试。")
    manifest = {"schemaVersion": "1.0.0", "snapshotId": target.name,
                "createdAtUtc": datetime.now(timezone.utc).isoformat(),
                "source": "steam-cloud-official", "appId": APP_ID, "slot": slot,
                "policy": {"sourceOpenedReadOnly": True, "parsedFromCopyOnly": True,
                           "writeBackSupported": False}, "files": records}
    # No token, signed download URL, full cloud account path, or SteamID is retained.
    (target / "snapshot-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    incomplete.unlink()
    return target


def parse_cloud_snapshot(snapshot: Path, project_root: Path, **pipeline_options) -> Path:
    """Bridge only a committed, independently checked local download to the parser."""
    from agent.nioh2_agent import _verify_snapshot_manifest, run_pipeline, sha256
    cloud_root(project_root, snapshot)
    if (snapshot / ".incomplete").exists():
        raise CloudError("incomplete_snapshot", "未完成的云快照不能进入解析流程。")
    # Validate the local manifest paths before the existing verifier opens them.
    try:
        manifest = json.loads((snapshot / "snapshot-manifest.json").read_text(encoding="utf-8"))
        slot = manifest["slot"]
        if not re.fullmatch(r"SAVEDATA[0-9]{2}", slot):
            raise ValueError()
        paths = [row["relative_path"] for row in manifest["files"]]
        if (f"{slot}/SAVEDATA.BIN" not in paths or len(paths) != len(set(paths))
                or any(p not in {f"{slot}/SAVEDATA.BIN", f"{slot}/BACKUP.BIN"} for p in paths)):
            raise ValueError()
        for row in manifest["files"]:
            copied = snapshot / row["relative_path"]
            if copied.is_symlink() or copied.stat().st_size != row["size"]:
                raise ValueError()
            cloud_root(project_root, copied.parent)
    except (ValueError, TypeError, KeyError, OSError):
        raise CloudError("invalid_snapshot", "本地云快照清单或副本无效，未进入解析。") from None
    manifest = _verify_snapshot_manifest(snapshot)
    if manifest.get("source") != "steam-cloud-official" or manifest.get("appId") != APP_ID:
        raise CloudError("invalid_snapshot", "不是本原型提交的官方云快照。")
    for name in ("snapshot_workspace", "store"):
        cloud_root(project_root, pipeline_options[name])
    cloud_root(project_root, pipeline_options["decryptor"].parent)
    # Capture the verified download's hashes before the pipeline starts copying.
    # A later local change must not become a newly accepted source revision.
    expected = tuple((row["relative_path"], row["size"], row["copy_sha256"]) for row in manifest["files"])

    def verify_download_before_store() -> None:
        for relative, size, digest in expected:
            copied = snapshot / relative
            cloud_root(project_root, copied.parent)
            if copied.is_symlink() or copied.stat().st_size != size or sha256(copied) != digest:
                raise CloudError("cloud_copy_changed", "云下载副本在解析期间变化；未保存解析结果。")

    return run_pipeline(source=snapshot / manifest["slot"],
                        additional_source_verifier=verify_download_before_store, **pipeline_options)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Steam 官方云只读实验；令牌仅从本进程环境读取")
    parser.add_argument("command", choices=("status", "list", "pull"))
    parser.add_argument("--config", type=Path, default=Path(".local/steam-cloud-config.json"))
    parser.add_argument("--slot")
    parser.add_argument("--parse", action="store_true", help="下载校验成功后显式调用现有 Windows 解密解析")
    args = parser.parse_args(argv)
    project = Path(__file__).resolve().parents[1]
    try:
        config = CloudConfig.load(args.config)
        token = os.environ.get(TOKEN_ENV)
        if args.command == "status":
            print(json.dumps(readiness(config, token), ensure_ascii=False))
            return 0
        if args.parse and args.command != "pull":
            raise CloudError("invalid_command", "--parse 仅用于 pull。")
        client = SteamCloudClient(config, token)
        if args.command == "list":
            files = client.enumerate_files()
            slots = sorted({f.slot for f in files if f.slot and f.basename == "SAVEDATA.BIN"})
            print(json.dumps({"status": "live_enumeration_succeeded", "appId": APP_ID,
                              "slots": slots, "fileCount": len(files), "livePullVerified": False}))
        else:
            snapshot = pull_snapshot(client, args.slot or "", project / ".local/steam-cloud/raw", project)
            result = {"status": "live_download_verified", "snapshot": str(snapshot), "parsed": False}
            if args.parse:
                from desktop_launcher import prepare_decryptor
                output = parse_cloud_snapshot(snapshot, project,
                    snapshot_workspace=project / ".local/steam-cloud/parser-copies",
                    store=project / ".local/snapshots",
                    decryptor=prepare_decryptor(project, cloud_root(project, project / ".local/steam-cloud/runtime" / snapshot.name)),
                    items_path=project / "agent/data/items.json", effects_path=project / "agent/data/effects.json")
                result.update(parsed=True, structuredSnapshot=str(output))
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except CloudError as exc:
        print(json.dumps({"status": "blocked", "code": exc.code, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"status": "failed", "code": "local_processing_failed",
                          "message": "本地配置、下载存储或解析失败；未自动发布，已有快照保持不变。"}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
