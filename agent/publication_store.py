"""Local durable parsed snapshots and transport-ready records; no network or credentials."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from agent.publication_contract import PUBLICATION_ENCODING, UnsafePublicationInteger, publication_bytes, public_parsed_snapshot

DATABASE_NAME = "parsed-publications.sqlite3"
LOCAL_ONLY_ENCODING = "save-asset-local-json/1"


class RemotePublicationNotReady(ValueError):
    reason = "UNSAFE_INTEGER"


def _publication_identity(public: dict) -> tuple[str, str]:
    try:
        return hashlib.sha256(publication_bytes(public)).hexdigest(), PUBLICATION_ENCODING
    except UnsafePublicationInteger:
        # Python JSON retains arbitrary integers exactly. This digest is local
        # identity only; it MUST NOT be returned as a v1 remote wire revision.
        local = json.dumps(public, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        return hashlib.sha256((LOCAL_ONLY_ENCODING + "\n" + local).encode("utf-8")).hexdigest(), LOCAL_ONLY_ENCODING


def _receipt(version, snapshot_id, revision, prepared, remote_ready=True):
    out = {"version": 1, "status": "ready-local", "publicationVersion": version,
           "snapshotId": snapshot_id, "revision": revision, "preparedAtUtc": prepared}
    if not remote_ready:
        out["remotePublication"] = {"status": "not-ready", "reason": "UNSAFE_INTEGER"}
    return out


_public_snapshot = public_parsed_snapshot


def record_parsed_snapshot(store: Path, snapshot: dict) -> dict:
    """Commit canonical snapshot and ready projection together; ordinal is per local store."""
    public = _public_snapshot(snapshot)
    payload = json.dumps(public, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    canonical = json.dumps(snapshot, ensure_ascii=False, allow_nan=False)
    revision, encoding = _publication_identity(public)
    store.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(store / DATABASE_NAME, timeout=10)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("CREATE TABLE IF NOT EXISTS publications (version INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id TEXT UNIQUE NOT NULL, revision TEXT NOT NULL, canonical TEXT NOT NULL, public TEXT NOT NULL, prepared_at TEXT NOT NULL)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(publications)")}
        if "encoding" not in columns:
            connection.execute("ALTER TABLE publications ADD COLUMN encoding TEXT NOT NULL DEFAULT 'legacy-python-json/0'")
        old = connection.execute("SELECT version,revision,prepared_at,canonical,encoding FROM publications WHERE snapshot_id=?", (snapshot["snapshotId"],)).fetchone()
        if old:
            old_revision = old[1] if old[4] == encoding else _publication_identity(_public_snapshot(json.loads(old[3])))[0]
            if old_revision != revision:
                raise ValueError("同一快照编号的发布内容发生变化，未覆盖旧记录。")
            version, _, prepared = old[:3]
            revision = old[1]  # Preserve the legacy local receipt; remote reads use v1 separately.
        else:
            prepared = datetime.now(timezone.utc).isoformat()
            cursor = connection.execute("INSERT INTO publications(snapshot_id,revision,canonical,public,prepared_at,encoding) VALUES(?,?,?,?,?,?)", (snapshot["snapshotId"], revision, canonical, payload, prepared, encoding))
            version = cursor.lastrowid
    return _receipt(version, snapshot["snapshotId"], revision, prepared, encoding == PUBLICATION_ENCODING)


def publication_receipt(store: Path, snapshot_id: str) -> dict | None:
    database = store / DATABASE_NAME
    if not database.is_file():
        return None
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        row = connection.execute("SELECT version,revision,prepared_at,canonical FROM publications WHERE snapshot_id=?", (snapshot_id,)).fetchone()
    if row is None:
        return None
    encoding = _publication_identity(_public_snapshot(json.loads(row[3])))[1]
    return _receipt(row[0], snapshot_id, row[1], row[2], encoding == PUBLICATION_ENCODING)


def latest_publication(store: Path) -> dict:
    """Read committed parsed data for a future authorized transport; does not parse or send."""
    database = store / DATABASE_NAME
    if not database.is_file():
        raise FileNotFoundError("尚无已准备的解析记录，请在电脑应用拖入 SAVEDATA.BIN。")
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        row = connection.execute("SELECT version,revision,canonical,public FROM publications ORDER BY version DESC LIMIT 1").fetchone()
    if row is None:
        raise FileNotFoundError("尚无已准备的解析记录。")
    return {"publicationVersion": row[0], "revision": row[1], "snapshot": json.loads(row[3]), "canonicalSnapshot": json.loads(row[2])}


def read_remote_publication(store: Path) -> dict:
    """Atomic committed version+canonical read; no parsing, migration or network.

    Legacy rows retain their original bytes/receipt. The remote projection and
    wire revision are recomputed using v1, never mislabel a legacy JSON hash.
    """
    database = store / DATABASE_NAME
    if not database.is_file():
        raise FileNotFoundError("No committed publication")
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        row = connection.execute("SELECT version,canonical FROM publications ORDER BY version DESC LIMIT 1").fetchone()
    if row is None:
        raise FileNotFoundError("No committed publication")
    snapshot = _public_snapshot(json.loads(row[1]))
    try:
        revision = hashlib.sha256(publication_bytes(snapshot)).hexdigest()
    except UnsafePublicationInteger as exc:
        raise RemotePublicationNotReady("REMOTE_PUBLICATION_NOT_READY") from exc
    return {"publicationVersion": row[0], "revisionContract": PUBLICATION_ENCODING,
            "revision": revision, "snapshot": snapshot}
