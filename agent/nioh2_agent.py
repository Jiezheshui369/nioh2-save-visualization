#!/usr/bin/env python3
"""Read-only snapshot service for Nioh 2 Steam saves.

The agent never opens source files for writing. Every parser receives only a
verified copy stored below the configured workspace.
"""

from __future__ import annotations

import argparse
import hmac
import ipaddress
import hashlib
import json
import mimetypes
import os
import re
import secrets
import socket
import shutil
import subprocess
import sys
import threading
import time
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse

from agent.binary_diff import change_summary
from agent.parser import parse_decrypted_file
from agent.mobile_sync import MobileSync, MAX_ARCHIVE

APP_NAME = "Nioh2SaveCompanion"
DEFAULT_PORT = 13252
AGENT_API_VERSION = "1.4"
SAVE_NAMES = {"SAVEDATA.BIN", "BACKUP.BIN"}


def new_snapshot_id() -> str:
    """Return a UTC ID precise enough to keep rapid refreshes independent."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def steam_sha1(path: Path) -> str:
    """Match Steam's legacy cloud metadata digest; not used for security decisions."""
    digest = hashlib.sha1()  # noqa: S324 - interoperability with Steam remotecache.vdf
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def ensure_separate(source: Path, destination: Path) -> None:
    source = source.resolve()
    destination = destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("源目录与快照目录必须完全分离。")


def wait_until_stable(path: Path, delay: float = 0.8) -> None:
    first = (path.stat().st_size, path.stat().st_mtime_ns)
    time.sleep(delay)
    second = (path.stat().st_size, path.stat().st_mtime_ns)
    if first != second:
        raise RuntimeError(f"文件仍在变化，已停止处理：{path}")


@dataclass(frozen=True)
class CopiedFile:
    relative_path: str
    size: int
    source_sha256: str
    copy_sha256: str
    source_last_write_utc: str


def snapshot_save(source: Path, workspace: Path) -> Path:
    source = source.resolve()
    workspace = workspace.resolve()
    if not source.exists():
        raise FileNotFoundError(source)
    ensure_separate(source, workspace)

    candidates = [source] if source.is_file() else [p for p in source.rglob("*") if p.is_file()]
    candidates = [p for p in candidates if p.name in SAVE_NAMES or p.name == "steam_autocloud.vdf"]
    if not candidates:
        raise ValueError("没有找到 SAVEDATA.BIN、BACKUP.BIN 或 steam_autocloud.vdf。")

    for path in candidates:
        wait_until_stable(path)

    snapshot_id = new_snapshot_id()
    workspace.mkdir(parents=True, exist_ok=True)
    final_dir = workspace / snapshot_id
    if final_dir.exists():
        raise FileExistsError(final_dir)

    copied: list[CopiedFile] = []
    source_root = source if source.is_dir() else source.parent
    final_dir.mkdir(parents=False, exist_ok=False)
    incomplete = final_dir / ".incomplete"
    incomplete.write_text("Snapshot creation is in progress.", encoding="utf-8")
    try:
        for original in candidates:
            relative = original.relative_to(source_root)
            target = final_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            source_hash_before = sha256(original)
            with original.open("rb") as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            shutil.copystat(original, target)
            source_hash_after = sha256(original)
            copy_hash = sha256(target)
            if source_hash_before != source_hash_after or source_hash_before != copy_hash:
                raise RuntimeError(f"哈希校验失败，快照已放弃：{original}")
            source_stat = original.stat()
            copied.append(CopiedFile(
                str(relative),
                source_stat.st_size,
                source_hash_before,
                copy_hash,
                datetime.fromtimestamp(source_stat.st_mtime, tz=timezone.utc).isoformat(),
            ))

        manifest = {
            "schemaVersion": "1.0.0",
            "snapshotId": snapshot_id,
            "createdAtUtc": datetime.now(timezone.utc).isoformat(),
            "source": str(source),
            "policy": {"sourceOpenedReadOnly": True, "parsedFromCopyOnly": True, "writeBackSupported": False},
            "files": [item.__dict__ for item in copied],
        }
        (final_dir / "snapshot-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        incomplete.unlink()
    except Exception:
        # Keep an incomplete snapshot for diagnostics; downstream commands reject
        # it because no valid manifest is available.
        raise
    return final_dir


def import_snapshot_json(input_path: Path, store: Path) -> Path:
    if input_path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError("结构化快照超过 5 MiB 导入上限。")
    data = json.loads(input_path.read_text(encoding="utf-8-sig"))
    if (
        not isinstance(data, dict)
        or not isinstance(data.get("schemaVersion"), str)
        or not isinstance(data.get("character"), dict)
    ):
        raise ValueError("不是受支持的结构化快照。")
    store.mkdir(parents=True, exist_ok=True)
    snapshot_id = str(data.get("snapshotId") or new_snapshot_id())
    if len(snapshot_id) > 80 or not re.fullmatch(r"[A-Za-z0-9._-]+", snapshot_id):
        raise ValueError("结构化快照编号包含不安全字符。")
    target = store / f"{snapshot_id}.json"
    suffix = 1
    while target.exists():
        snapshot_id = f"{data.get('snapshotId') or 'import'}-import-{suffix}"
        target = store / f"{snapshot_id}.json"
        suffix += 1
    data["snapshotId"] = snapshot_id
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)
    return target


def normalize_research_label(label: str | None) -> str | None:
    if label is None:
        return None
    normalized = label.strip()
    if not normalized or len(normalized) > 80 or any(ord(character) < 32 for character in normalized):
        raise ValueError("研究标签必须是 1–80 个可见字符。")
    return normalized


def inventory_quantity_changes(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate quantity deltas by stable item ID for readable backup diagnostics."""
    before_totals: dict[str, int] = {}
    after_totals: dict[str, int] = {}
    names: dict[str, tuple[str | None, str | None]] = {}
    for records, totals in ((before, before_totals), (after, after_totals)):
        for item in records:
            item_id = str(item["id"])
            totals[item_id] = totals.get(item_id, 0) + int(item.get("quantity", 0))
            names[item_id] = (item.get("nameZh"), item.get("name"))
    changes = []
    for item_id in sorted(before_totals.keys() | after_totals.keys()):
        previous = before_totals.get(item_id, 0)
        current = after_totals.get(item_id, 0)
        if previous == current:
            continue
        name_zh, name = names.get(item_id, (None, None))
        changes.append({
            "id": item_id,
            "nameZh": name_zh,
            "name": name,
            "before": previous,
            "after": current,
            "delta": current - previous,
        })
    return changes


def parse_and_store(
    input_path: Path,
    backup_path: Path | None,
    snapshot_root: Path,
    store: Path,
    items_path: Path,
    effects_path: Path,
    original_sha256: str | None,
    research_label: str | None = None,
    original_last_write_local: str | None = None,
    backup_original_last_write_local: str | None = None,
    source_verifier: Callable[[], None] | None = None,
) -> Path:
    input_hash_before = sha256(input_path)
    data = parse_decrypted_file(input_path, snapshot_root, items_path, effects_path, original_sha256)
    if original_last_write_local is not None:
        data["sourceLastWriteLocal"] = original_last_write_local
    normalized_label = normalize_research_label(research_label)
    if normalized_label is not None:
        data["researchLabel"] = normalized_label
    if backup_path is not None:
        backup_hash_before = sha256(backup_path)
        backup = parse_decrypted_file(backup_path, snapshot_root, items_path, effects_path)
        if backup_original_last_write_local is not None:
            backup["sourceLastWriteLocal"] = backup_original_last_write_local
        input_bytes = input_path.read_bytes()
        backup_bytes = backup_path.read_bytes()
        binary_summary = change_summary(backup_bytes, input_bytes)
        current_attributes = data["character"]["attributes"]
        backup_attributes = backup["character"]["attributes"]
        changes = {key: current_attributes[key] - backup_attributes[key] for key in current_attributes}
        current_loadout = {item["equipIndex"]: item["id"] for item in data["currentLoadout"]}
        backup_loadout = {item["equipIndex"]: item["id"] for item in backup["currentLoadout"]}
        quantity_changes = inventory_quantity_changes(backup.get("inventoryItems", []), data.get("inventoryItems", []))
        data["backupComparison"] = {
            "backupLastWriteLocal": backup["sourceLastWriteLocal"],
            "level": backup["character"]["level"],
            "amrita": backup["character"]["amrita"],
            "gold": backup["character"]["gold"],
            "attributeChangesToCurrent": changes,
            "binaryChangedBytes": binary_summary['changedBytes'],
            "binaryChangedRanges": binary_summary['changedRanges'],
            "loadoutChanged": current_loadout != backup_loadout,
            "inventoryChanged": bool(quantity_changes),
            "inventoryQuantityChanges": quantity_changes,
            "copyHashesUnchangedAfterParsing": (
                input_hash_before == sha256(input_path)
                and backup_hash_before == sha256(backup_path)
            ),
        }
        if not data["backupComparison"]["copyHashesUnchangedAfterParsing"]:
            raise RuntimeError("解析期间主存档或备份副本发生变化，结果已放弃。")
    elif input_hash_before != sha256(input_path):
        raise RuntimeError("解析期间存档副本发生变化，结果已放弃。")
    # The normal pipeline rechecks the original encrypted files here, after all
    # copy parsing has completed but before publishing the structured snapshot.
    if source_verifier is not None:
        source_verifier()
    store.mkdir(parents=True, exist_ok=True)
    target = store / f"{data['snapshotId']}.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)
    return target


def _verify_snapshot_manifest(snapshot_dir: Path) -> dict[str, Any]:
    manifest_path = snapshot_dir / "snapshot-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["files"]:
        copied = snapshot_dir / item["relative_path"]
        if sha256(copied) != item["copy_sha256"]:
            raise RuntimeError(f"快照文件哈希发生变化：{copied}")
    return manifest


def _verify_original_manifest(source: Path, manifest: dict[str, Any]) -> None:
    """Recheck original files read-only immediately before publishing a result."""
    resolved = source.resolve()
    source_root = resolved if resolved.is_dir() else resolved.parent
    for item in manifest["files"]:
        original = source_root / item["relative_path"]
        if not original.is_file() or sha256(original) != item["source_sha256"]:
            raise RuntimeError(f"读取期间原始存档发生变化，已停止发布快照：{item['relative_path']}")


def run_pipeline(
    source: Path,
    snapshot_workspace: Path,
    store: Path,
    decryptor: Path,
    items_path: Path,
    effects_path: Path,
    research_label: str | None = None,
) -> Path:
    """Snapshot, decrypt and parse while preserving a verifiable read-only chain."""
    decryptor = decryptor.resolve()
    if not decryptor.is_file():
        raise FileNotFoundError(decryptor)
    snapshot_dir = snapshot_save(source, snapshot_workspace)
    manifest = _verify_snapshot_manifest(snapshot_dir)

    output_root = decryptor.parent / "_OUTPUT"
    before = {path.resolve() for path in output_root.iterdir()} if output_root.exists() else set()
    result = subprocess.run(
        [str(decryptor), "-m", "d", "-g", "nioh2", "-p", str(snapshot_dir), "-q"],
        cwd=decryptor.parent,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"解密器失败（{result.returncode}）：{result.stderr or result.stdout}")
    after = {path.resolve() for path in output_root.iterdir() if path.is_dir()} if output_root.exists() else set()
    created = sorted(after - before, key=lambda path: path.stat().st_mtime_ns, reverse=True)
    if not created:
        raise RuntimeError("解密器没有生成新的输出目录。")
    decrypted_root = created[0]

    _verify_snapshot_manifest(snapshot_dir)
    main_candidates = [path for path in decrypted_root.rglob("SAVEDATA.BIN") if path.stat().st_size > 1_000_000]
    if len(main_candidates) != 1:
        raise RuntimeError(f"无法唯一确定主存档副本：找到 {len(main_candidates)} 个候选")
    backup_candidates = [path for path in decrypted_root.rglob("BACKUP.BIN") if path.stat().st_size > 1_000_000]
    backup = backup_candidates[0] if len(backup_candidates) == 1 else None

    main_relative = str(main_candidates[0].relative_to(decrypted_root))
    original_record = next(
        (item for item in manifest["files"] if item["relative_path"].replace("\\", "/") == main_relative.replace("\\", "/")),
        None,
    )
    original_hash = original_record["source_sha256"] if original_record else None
    backup_record = None
    if backup is not None:
        backup_relative = str(backup.relative_to(decrypted_root))
        backup_record = next(
            (item for item in manifest["files"] if item["relative_path"].replace("\\", "/") == backup_relative.replace("\\", "/")),
            None,
        )
    return parse_and_store(
        main_candidates[0],
        backup,
        decrypted_root,
        store,
        items_path,
        effects_path,
        original_hash,
        research_label,
        original_record.get("source_last_write_utc") if original_record else None,
        backup_record.get("source_last_write_utc") if backup_record else None,
        lambda: _verify_original_manifest(source, manifest),
    )


def latest_snapshot(store: Path) -> dict[str, Any]:
    files = sorted(store.glob("*.json"), key=lambda path: path.stat().st_mtime_ns, reverse=True)
    if not files:
        raise FileNotFoundError("尚无结构化快照。请先执行 import-json。")
    return json.loads(files[0].read_text(encoding="utf-8-sig"))


def list_snapshots(store: Path) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for path in sorted(store.glob("*.json"), key=lambda item: item.stat().st_mtime_ns, reverse=True):
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        summaries.append({
            "snapshotId": data.get("snapshotId", path.stem),
            "createdAt": data.get("sourceLastWriteLocal"),
            "level": data.get("character", {}).get("level"),
            "parserVersion": data.get("parserVersion"),
            "researchLabel": data.get("researchLabel"),
        })
    return summaries


def snapshot_by_id(store: Path, snapshot_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", snapshot_id):
        raise ValueError("快照 ID 无效。")
    target = store / f"{snapshot_id}.json"
    if not target.is_file():
        raise FileNotFoundError(snapshot_id)
    return json.loads(target.read_text(encoding="utf-8-sig"))


def discover_save_sources(source: Path | None = None) -> list[Path]:
    """Discover character slot directories, never opening a save for writing."""
    if source is not None:
        resolved = source.resolve()
        if resolved.is_file() and resolved.name == "SAVEDATA.BIN":
            return [resolved.parent]
        if (resolved / "SAVEDATA.BIN").is_file():
            return [resolved]
        root = resolved
    else:
        root = Path.home() / "Documents" / "KoeiTecmo" / "NIOH2" / "Savedata"
    if not root.is_dir():
        return []
    return sorted(
        {path.parent.resolve() for path in root.rglob("SAVEDATA.BIN") if path.parent.name.startswith("SAVEDATA")},
        key=lambda path: str(path).casefold(),
    )


def discover_save_source() -> Path | None:
    base = Path.home() / "Documents" / "KoeiTecmo" / "NIOH2" / "Savedata"
    candidates = discover_save_sources(base)
    return candidates[0] if len(candidates) == 1 else None


def summarize_save_source(source: Path | None) -> dict[str, Any]:
    """Return useful source metadata without exposing the user's full path."""
    if source is None:
        return {"configured": False, "accountHint": None, "saveSlots": [], "latestWriteLocal": None}
    resolved = source.resolve()
    if (resolved / "SAVEDATA.BIN").is_file():
        slot_files = [resolved / "SAVEDATA.BIN"]
        account = resolved.parent.name
    else:
        slot_files = sorted(
            path / "SAVEDATA.BIN"
            for path in resolved.glob("SAVEDATA*")
            if path.is_dir() and (path / "SAVEDATA.BIN").is_file()
        )
        account = resolved.name
    account_hint = f"…{account[-4:]}" if account.isdigit() and len(account) > 4 else "已识别"
    latest = max((path.stat().st_mtime for path in slot_files), default=None)
    return {
        "configured": True,
        "accountHint": account_hint,
        "saveSlots": [path.parent.name for path in slot_files],
        "latestWriteLocal": datetime.fromtimestamp(latest).astimezone().isoformat() if latest is not None else None,
    }


def summarize_snapshot_workspace(workspace: Path | None) -> dict[str, Any]:
    if workspace is None or not workspace.is_dir():
        return {"completeCopies": 0, "incompleteCopies": 0, "latestCreatedAtUtc": None}
    complete = 0
    incomplete = 0
    latest: str | None = None
    for directory in workspace.iterdir():
        if not directory.is_dir():
            continue
        manifest_path = directory / "snapshot-manifest.json"
        if (directory / ".incomplete").exists() or not manifest_path.is_file():
            incomplete += 1
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("policy", {}).get("parsedFromCopyOnly") is not True:
                incomplete += 1
                continue
            complete += 1
            created = manifest.get("createdAtUtc")
            if isinstance(created, str) and (latest is None or created > latest):
                latest = created
        except (OSError, json.JSONDecodeError):
            incomplete += 1
    return {"completeCopies": complete, "incompleteCopies": incomplete, "latestCreatedAtUtc": latest}


def _steam_install_roots() -> list[Path]:
    candidates: list[Path] = []
    try:
        import winreg  # type: ignore[import-not-found]
        for hive, key_name, value_name in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        ):
            try:
                with winreg.OpenKey(hive, key_name) as key:
                    candidates.append(Path(winreg.QueryValueEx(key, value_name)[0]))
            except OSError:
                pass
    except ImportError:
        pass
    for variable in ("ProgramFiles(x86)", "ProgramFiles"):
        base = os.environ.get(variable)
        if base:
            candidates.append(Path(base) / "Steam")
    unique: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in unique:
            unique.append(resolved)
    return unique


def steam_cloud_status(source: Path | None, steam_roots: list[Path] | None = None) -> dict[str, Any]:
    """Read privacy-safe Steam Cloud metadata; never contact Steam or alter its files."""
    unavailable = {"detected": False, "state": "unavailable", "lastRemoteWriteLocal": None, "metadataLastWriteLocal": None}
    if source is None:
        return unavailable
    resolved = source.resolve()
    if not (resolved / "SAVEDATA.BIN").is_file():
        return unavailable
    slot = resolved.name
    account = resolved.parent.name
    if not account.isdigit():
        return unavailable
    expected_key = f"KoeiTecmo/NIOH2/Savedata/{account}/{slot}/SAVEDATA.BIN"
    for root in steam_roots if steam_roots is not None else _steam_install_roots():
        cache = root / "userdata" / account / "1325200" / "remotecache.vdf"
        if not cache.is_file():
            continue
        try:
            text = cache.read_text(encoding="utf-8-sig", errors="replace")
            match = re.search(rf'"{re.escape(expected_key)}"\s*\{{(?P<body>.*?)\n\s*\}}', text, re.DOTALL)
            if not match:
                continue
            fields = dict(re.findall(r'"([^"]+)"\s+"([^"]*)"', match.group("body")))
            local_time = int(fields.get("localtime", "0"))
            remote_time = int(fields.get("remotetime", "0"))
            recorded_size = int(fields.get("size", "-1"))
            source_stat = (resolved / "SAVEDATA.BIN").stat()
            metadata_sha = fields.get("sha", "").upper()
            content_matches = steam_sha1(resolved / "SAVEDATA.BIN") == metadata_sha if metadata_sha else None
            size_matches = source_stat.st_size == recorded_size
            tolerance = 2
            if size_matches and (content_matches is True or (content_matches is None and remote_time and abs(source_stat.st_mtime - remote_time) <= tolerance)):
                state = "synchronized"
            elif remote_time and source_stat.st_mtime > remote_time + tolerance:
                state = "local-newer"
            elif remote_time and remote_time > source_stat.st_mtime + tolerance:
                state = "cloud-newer"
            else:
                state = "unknown"
            return {
                "detected": True,
                "state": state,
                "lastRemoteWriteLocal": datetime.fromtimestamp(remote_time).astimezone().isoformat() if remote_time else None,
                "metadataLastWriteLocal": datetime.fromtimestamp(cache.stat().st_mtime).astimezone().isoformat(),
                "sizeMatches": size_matches,
                "contentMatches": content_matches,
                "localMetadataTime": datetime.fromtimestamp(local_time).astimezone().isoformat() if local_time else None,
            }
        except (OSError, ValueError):
            return unavailable
    return unavailable


def public_source_options(sources: list[Path], active: Path | None = None) -> list[dict[str, Any]]:
    active_resolved = active.resolve() if active is not None else None
    options: list[dict[str, Any]] = []
    for index, source in enumerate(sources, start=1):
        summary = summarize_save_source(source)
        slot = source.name if (source / "SAVEDATA.BIN").is_file() else summary["saveSlots"][0] if summary["saveSlots"] else "未知槽位"
        options.append({
            "id": f"source-{index}",
            "accountHint": summary["accountHint"],
            "slot": slot,
            "latestWriteLocal": summary["latestWriteLocal"],
            "active": active_resolved == source.resolve(),
        })
    return options


def is_request_authorized(access_token: str | None, client_ip: str, provided_token: str | None) -> bool:
    if access_token is None:
        return True
    try:
        if ipaddress.ip_address(client_ip).is_loopback:
            return True
    except ValueError:
        pass
    return bool(provided_token and hmac.compare_digest(access_token, provided_token))


def local_pairing_urls(port: int, access_token: str) -> list[str]:
    addresses: list[str] = []
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # UDP connect selects the active route without sending application data.
        probe.connect(("192.0.2.1", 9))
        addresses.append(probe.getsockname()[0])
    except OSError:
        pass
    finally:
        probe.close()
    try:
        addresses.extend(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    usable: list[str] = []
    for address in addresses:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            continue
        if parsed.version == 4 and not parsed.is_loopback and not parsed.is_unspecified and address not in usable:
            usable.append(address)
    return [f"http://{address}:{port}/#pair={access_token}" for address in usable]


class ApiHandler(BaseHTTPRequestHandler):
    mobile_sync: MobileSync | None = None

    def _header_values(self, name: str) -> list[str]:
        # HTTPMessage preserves duplicate headers; do not silently use the first.
        if hasattr(self.headers, "get_all"):
            return self.headers.get_all(name, [])
        value = self.headers.get(name)
        return [] if value is None else [value]

    def _request_body(self, maximum: int, minimum: int = 0, *, allow_missing: bool = False) -> bytes:
        lengths = self._header_values("Content-Length")
        if self._header_values("Transfer-Encoding"):
            raise ValueError("不支持分块传输，请重新发送完整文件或请求。")
        if not lengths and allow_missing:
            lengths = ["0"]
        if len(lengths) != 1 or re.fullmatch(r"0|[1-9][0-9]{0,9}", lengths[0], flags=re.ASCII) is None:
            raise ValueError("请求长度无效，请重新发送。")
        size = int(lengths[0])
        if not minimum <= size <= maximum:
            raise ValueError("请求大小不受支持，请检查文件后重试。")
        self.connection.settimeout(30)
        try:
            data = self.rfile.read(size) if size else b""
        except (TimeoutError, ConnectionError) as exc:
            raise ValueError("文件或请求传输中断，尚未开始解析，请重试。") from exc
        if len(data) != size:
            raise ValueError("文件或请求传输不完整，尚未开始解析，请重试。")
        return data

    def _upload_save(self):
        if not self._desktop_sync_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "只能在电脑本机导入存档。"})
            return
        if not self.pipeline_defaults or not self.refresh_lock.acquire(blocking=False):
            self._json(HTTPStatus.CONFLICT, {"error": "解析器未就绪或已有读取任务。"})
            return
        try:
            data = self._request_body(8 * 1024 * 1024, 1_000_000)
            # Browser supplies bytes, never a source path. Work only on a new staging copy.
            with tempfile.TemporaryDirectory(prefix="nioh-import-") as temp:
                staged = Path(temp) / "SAVEDATA.BIN"
                staged.write_bytes(data)
                stamp = self.headers.get("X-Nioh2-Modified")
                if stamp:
                    # Optional browser metadata must not prevent a valid copy import.
                    try:
                        modified = float(stamp) / 1000
                        if 0 < modified <= time.time() + 300:
                            os.utime(staged, (modified, modified))
                    except (ValueError, OverflowError):
                        pass
                output = run_pipeline(source=staged, store=self.store, **self.pipeline_defaults)
                result = json.loads(output.read_text(encoding="utf-8-sig"))
                result["inputMethod"] = "desktop-file-copy"
            status, payload = HTTPStatus.OK, result
        except Exception as exc:
            status, payload = HTTPStatus.BAD_REQUEST, {"error": str(exc)}
        finally:
            self.refresh_lock.release()
        # A response is a completion acknowledgement: cleanup and unlock first.
        self._json(status, payload)

    def _desktop_sync_allowed(self) -> bool:
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return (self.client_address[0] in ("127.0.0.1", "::1")
                and len(self._header_values("Host")) == 1
                and len(self._header_values("Origin")) <= 1
                and len(self._header_values("X-Nioh2-Desktop-Sync")) == 1
                and host in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
                and (origin is None or origin == f"http://{host}")
                and self.headers.get("X-Nioh2-Desktop-Sync") == "1")

    def _mobile_control(self, path: str) -> None:
        if not self._desktop_sync_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "请在电脑本机窗口操作同步。"})
            return
        sync = self.mobile_sync
        if sync is None:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "此服务尚未配置手机同步。"})
            return
        try:
            body = self._request_body(MAX_ARCHIVE, allow_missing=True)
            payload = json.loads(body) if body else {}
            if not isinstance(payload, dict):
                raise ValueError("同步请求必须是对象。")
            with sync.control_lock:
                if path == "/api/mobile-sync/publish":
                    archive = payload.get("archive")
                    if sync.state and not sync.status()["enabled"]:
                        sync.stop()
                    if sync.state is None:
                        hosts = [urlparse(url).hostname for url in local_pairing_urls(self.server.server_port, "unused")]
                        sync.start(archive, hosts)
                    else:
                        sync.state.publish(archive)
                    if payload.get("newInvite") is True or not sync.state.invite:
                        sync.state.new_invite()
                elif path == "/api/mobile-sync/stop":
                    sync.stop()
                elif path != "/api/mobile-sync/status":
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                self._json(HTTPStatus.OK, sync.status(include_invite=True))
        except Exception as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
    store: Path
    web_root: Path | None = None
    pipeline_config: dict[str, Path] | None = None
    access_token: str | None = None
    pairing_urls: list[str] = []
    pipeline_defaults: dict[str, Path] | None = None
    source_options: dict[str, Path] = {}
    refresh_lock = threading.Lock()

    def _authorized(self) -> bool:
        return is_request_authorized(self.access_token, self.client_address[0], self.headers.get("X-Nioh2-Token"))

    def _refresh_allowed(self) -> bool:
        if self._desktop_sync_allowed():
            return True
        # Legacy LAN browser refresh remains possible with its explicit secret.
        # Loopback alone is not authority for a state-changing browser request.
        tokens = self._header_values("X-Nioh2-Token")
        hosts = self._header_values("Host")
        origins = self._header_values("Origin")
        return bool(self.access_token and len(tokens) == 1
                    and tokens[0].isascii() and hmac.compare_digest(self.access_token, tokens[0])
                    and len(hosts) == 1 and len(origins) <= 1
                    and (not origins or origins[0] == f"http://{hosts[0]}"))

    def _security_headers(self) -> None:
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")

    def _json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionError, TimeoutError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/") and not self._authorized():
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "需要有效的手机配对口令。"})
            return
        try:
            if path == "/api/health":
                source = self.pipeline_config.get("source") if self.pipeline_config is not None else None
                workspace = self.pipeline_defaults.get("snapshot_workspace") if self.pipeline_defaults is not None else None
                self._json(HTTPStatus.OK, {
                    "status": "ok",
                    "apiVersion": AGENT_API_VERSION,
                    "writeBackSupported": False,
                    "refreshAvailable": self.pipeline_config is not None,
                    "lanMode": self.access_token is not None,
                    "source": summarize_save_source(source),
                    "backupCopies": summarize_snapshot_workspace(workspace),
                    "steamCloud": steam_cloud_status(source),
                })
            elif path == "/api/sources":
                active = self.pipeline_config.get("source") if self.pipeline_config is not None else None
                self._json(HTTPStatus.OK, public_source_options(list(self.source_options.values()), active))
            elif path == "/api/pairing":
                self._json(HTTPStatus.OK, {"enabled": self.access_token is not None, "urls": self.pairing_urls})
            elif path == "/api/snapshots/latest":
                self._json(HTTPStatus.OK, latest_snapshot(self.store))
            elif path == "/api/snapshots":
                self._json(HTTPStatus.OK, list_snapshots(self.store))
            elif path.startswith("/api/snapshots/"):
                self._json(HTTPStatus.OK, snapshot_by_id(self.store, unquote(path.removeprefix("/api/snapshots/"))))
            elif path.startswith("/api/"):
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            elif self.web_root is not None:
                self._static(path)
            else:
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except FileNotFoundError as exc:
            self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover - final safety net
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/import-save":
            self._upload_save()
            return
        if path.startswith("/api/mobile-sync/"):
            self._mobile_control(path)
            return
        if path.startswith("/api/") and not self._authorized():
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "需要有效的手机配对口令。"})
            return
        if path != "/api/refresh":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self._refresh_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "请在电脑本机窗口读取存档，或使用有效的局域网配对入口。"})
            return
        selected_id: str | None = None
        research_label: str | None = None
        try:
            body = self._request_body(4096, allow_missing=True)
            if body:
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise ValueError("刷新请求必须是对象。")
                selected_id = payload.get("sourceId") if isinstance(payload, dict) else None
                research_label = normalize_research_label(payload.get("label")) if isinstance(payload, dict) and payload.get("label") is not None else None
        except (UnicodeDecodeError, ValueError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "无法读取存档来源选择，请检查请求长度和格式。"})
            return
        pipeline_config = self.pipeline_config
        if selected_id is not None:
            selected_source = self.source_options.get(str(selected_id))
            if selected_source is None or self.pipeline_defaults is None:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "存档来源无效或已失效。"})
                return
            pipeline_config = {**self.pipeline_defaults, "source": selected_source}
        if pipeline_config is None:
            self._json(HTTPStatus.CONFLICT, {"error": "没有发现唯一的仁王2存档目录，请用 --source 明确指定。"})
            return
        if not self.refresh_lock.acquire(blocking=False):
            self._json(HTTPStatus.CONFLICT, {"error": "已有刷新任务正在执行。"})
            return
        try:
            run_pipeline(store=self.store, research_label=research_label, **pipeline_config)
            if selected_id is not None:
                type(self).pipeline_config = pipeline_config
            status, payload = HTTPStatus.OK, latest_snapshot(self.store)
        except Exception as exc:
            status, payload = HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)}
        finally:
            self.refresh_lock.release()
        self._json(status, payload)

    def _static(self, request_path: str) -> None:
        assert self.web_root is not None
        root = self.web_root.resolve()
        relative = unquote(request_path).lstrip("/") or "index.html"
        candidate = (root / relative).resolve()
        if candidate != root and root not in candidate.parents:
            self._json(HTTPStatus.FORBIDDEN, {"error": "invalid_path"})
            return
        if not candidate.is_file() and "." not in Path(relative).name:
            candidate = root / "index.html"
        if not candidate.is_file():
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        body = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=3600")
        self._security_headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def log_message(self, message: str, *args: object) -> None:
        sys.stderr.write("[agent] " + (message % args) + "\n")


def create_http_server(
    store: Path,
    host: str,
    port: int,
    web_root: Path | None = None,
    source: Path | None = None,
    snapshot_workspace: Path | None = None,
    decryptor: Path | None = None,
    items_path: Path | None = None,
    effects_path: Path | None = None,
    access_token: str | None = None,
) -> ThreadingHTTPServer:
    if web_root is not None and not (web_root / "index.html").is_file():
        raise FileNotFoundError(f"找不到前端构建：{web_root / 'index.html'}")
    sources = discover_save_sources(source)
    active_source = sources[0] if len(sources) == 1 else None
    pipeline_defaults = {
        "snapshot_workspace": snapshot_workspace or store.parent / "encrypted-snapshots",
        "decryptor": decryptor or Path(__file__).parent / "tools" / "katana" / "katana-savedata-resigner-cli.exe",
        "items_path": items_path or Path(__file__).parent / "data" / "items.json",
        "effects_path": effects_path or Path(__file__).parent / "data" / "effects.json",
    }
    pipeline_config = {**pipeline_defaults, "source": active_source} if active_source is not None else None
    source_map = {f"source-{index}": item for index, item in enumerate(sources, start=1)}
    pairing_urls = local_pairing_urls(port, access_token) if access_token is not None else []
    mobile_sync = MobileSync(port + 100)
    handler = type("ConfiguredApiHandler", (ApiHandler,), {"mobile_sync": mobile_sync, "store": store, "web_root": web_root, "pipeline_config": pipeline_config, "pipeline_defaults": pipeline_defaults, "source_options": source_map, "access_token": access_token, "pairing_urls": pairing_urls})
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Nioh 2 read-only agent: http://{host}:{port}")
    print(f"Snapshot store: {store.resolve()}")
    if web_root is not None:
        print(f"Web app: http://{host}:{port}/")
    if access_token is not None:
        print("LAN pairing is enabled. Structured snapshot data requires the temporary token.")
        if pairing_urls:
            for url in pairing_urls:
                print(f"Phone pairing URL: {url}")
        else:
            print(f"Phone pairing fragment: #pair={access_token}")
    print(f"Refresh source: {active_source if active_source else 'waiting for slot selection' if sources else 'not configured'}")
    return server


def serve(*args, **kwargs) -> None:
    server = create_http_server(*args, **kwargs)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.RequestHandlerClass.mobile_sync.stop()
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="仁王2 存档伴侣只读 Agent")
    sub = parser.add_subparsers(dest="command", required=True)

    snapshot = sub.add_parser("snapshot", help="只读复制并校验存档")
    snapshot.add_argument("--source", type=Path, required=True)
    snapshot.add_argument("--workspace", type=Path, required=True)

    importer = sub.add_parser("import-json", help="导入已解析的结构化快照")
    importer.add_argument("--input", type=Path, required=True)
    importer.add_argument("--store", type=Path, required=True)

    parsed = sub.add_parser("parse-decrypted", help="只读解析快照目录中的已解密副本")
    parsed.add_argument("--input", type=Path, required=True)
    parsed.add_argument("--backup", type=Path)
    parsed.add_argument("--snapshot-root", type=Path, required=True)
    parsed.add_argument("--store", type=Path, required=True)
    parsed.add_argument("--items", type=Path, default=Path(__file__).parent / "data" / "items.json")
    parsed.add_argument("--effects", type=Path, default=Path(__file__).parent / "data" / "effects.json")
    parsed.add_argument("--original-sha256")
    parsed.add_argument("--original-last-write-local")
    parsed.add_argument("--backup-original-last-write-local")
    parsed.add_argument("--label", help="可选的受控研究样本标签（1–80 个字符）")

    pipeline = sub.add_parser("pipeline", help="只读快照、解密副本并生成结构化快照")
    pipeline.add_argument("--source", type=Path, required=True)
    pipeline.add_argument("--snapshot-workspace", type=Path, required=True)
    pipeline.add_argument("--store", type=Path, required=True)
    pipeline.add_argument(
        "--decryptor",
        type=Path,
        default=Path(__file__).parent / "tools" / "katana" / "katana-savedata-resigner-cli.exe",
    )
    pipeline.add_argument("--items", type=Path, default=Path(__file__).parent / "data" / "items.json")
    pipeline.add_argument("--effects", type=Path, default=Path(__file__).parent / "data" / "effects.json")
    pipeline.add_argument("--label", help="可选的受控研究样本标签（1–80 个字符）")

    api = sub.add_parser("serve", help="启动仅绑定本机的读取 API")
    api.add_argument("--store", type=Path, required=True)
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", type=int, default=DEFAULT_PORT)
    api.add_argument("--lan", action="store_true", help="显式开启带临时口令的局域网访问")
    api.add_argument("--web-root", type=Path)
    api.add_argument("--source", type=Path)
    api.add_argument("--snapshot-workspace", type=Path)
    api.add_argument("--decryptor", type=Path)
    api.add_argument("--items", type=Path)
    api.add_argument("--effects", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "snapshot":
            print(snapshot_save(args.source, args.workspace))
        elif args.command == "import-json":
            print(import_snapshot_json(args.input, args.store))
        elif args.command == "parse-decrypted":
            print(parse_and_store(args.input, args.backup, args.snapshot_root, args.store, args.items, args.effects, args.original_sha256, args.label, args.original_last_write_local, args.backup_original_last_write_local))
        elif args.command == "pipeline":
            print(run_pipeline(args.source, args.snapshot_workspace, args.store, args.decryptor, args.items, args.effects, args.label))
        elif args.command == "serve":
            if not args.lan and args.host not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("MVP 仅允许绑定本机地址。")
            host = "0.0.0.0" if args.lan else args.host
            access_token = secrets.token_urlsafe(18) if args.lan else None
            serve(args.store, host, args.port, args.web_root, args.source, args.snapshot_workspace, args.decryptor, args.items, args.effects, access_token)
        return 0
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
