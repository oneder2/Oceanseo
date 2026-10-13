"""Single-user Tideplan beta vault. Put HTTPS + limits in front for deployment.

One deployment/token corresponds to one person's devices. No public signup.
Business payloads are validated again by clients before local application.
"""
import hmac
from contextlib import contextmanager
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 16 * 1024 * 1024 + 4096


def validate_bead_lifecycle(record):
    """Protect new deletion/progress fields without changing legacy vault rules."""
    if record is None:
        return
    works = record.get("works")
    if not isinstance(works, list):
        if "purgedWorkIds" in record:
            raise ValueError("bead_lifecycle")
        return
    has_metadata = "purgedWorkIds" in record or any(isinstance(work, dict) and ("deletedAt" in work or "deletedFromArchive" in work) for work in works)
    for work in works:
        if not isinstance(work, dict):
            continue  # Existing clients validate the complete business payload.
        if "deletedAt" in work or "deletedFromArchive" in work:
            stamp = work.get("deletedAt")
            if not isinstance(stamp, str) or type(work.get("deletedFromArchive")) is not bool or work.get("archived") is not True:
                raise ValueError("bead_lifecycle")
            try:
                parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("bead_lifecycle")
            except (ValueError, OverflowError):
                raise ValueError("bead_lifecycle") from None
        versions = work.get("versions", [])
        if isinstance(versions, list):
            for version in versions:
                if not isinstance(version, dict) or "completedCells" not in version:
                    continue
                marks = version["completedCells"]
                pattern = version.get("pattern")
                cells = pattern.get("cells") if isinstance(pattern, dict) else None
                if not isinstance(marks, list) or not isinstance(cells, list) or len(marks) > 25600 or any(type(mark) is not int or not 0 <= mark < len(cells) or type(cells[mark]) is not int or cells[mark] < 0 for mark in marks) or len(set(marks)) != len(marks):
                    raise ValueError("bead_progress_snapshot")
    if "purgedWorkIds" in record:
        purged = record["purgedWorkIds"]
        if not isinstance(purged, list) or len(purged) > 10000 or any(not isinstance(key, str) or not re.fullmatch(r"[0-9a-f-]{36}", key) for key in purged) or len(set(purged)) != len(purged):
            raise ValueError("bead_lifecycle")
        if any(str(uuid.UUID(key)) != key for key in purged):
            raise ValueError("bead_lifecycle")
        if any(isinstance(work, dict) and work.get("id") in purged for work in works):
            raise ValueError("bead_lifecycle")
    if has_metadata:
        live = [work for work in works if isinstance(work, dict) and work.get("archived") is False and "deletedAt" not in work]
        if (live and not any(work.get("id") == record.get("activeId") for work in live)) or (not live and record.get("activeId") != ""):
            raise ValueError("bead_lifecycle")


def validate_update(value, *, allow_bead_works=False):
    """Common vault wire format; authorization stays with each service."""
    if not isinstance(value, dict) or set(value) != {"protocol", "vaultId", "expectedRevision", "records"}:
        raise ValueError("shape")
    if type(value["protocol"]) is not int or value["protocol"] != 1 or type(value["expectedRevision"]) is not int or not 0 <= value["expectedRevision"] <= 9_007_199_254_740_991:
        raise ValueError("version")
    records = value["records"]
    if not isinstance(records, dict) or len(records) > 50000:
        raise ValueError("records")
    for key, record in records.items():
        bead_works = allow_bead_works and key == "tideplan.bead-works.v1"
        if not bead_works and key != "goals" and not re.fullmatch(r"task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", key):
            raise ValueError("key")
        if record is not None and not isinstance(record, dict):
            raise ValueError("record")
        if bead_works and len(json.dumps(record, ensure_ascii=False, allow_nan=False).encode()) > 2 * 1024 * 1024:
            raise OverflowError("bead_works_too_large")
        if bead_works:
            validate_bead_lifecycle(record)
    encoded = json.dumps(records, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode()) > MAX_BODY - 4096:
        raise OverflowError("too_large")
    return encoded


class VaultStore:
    def __init__(self, path, backup_status=None):
        self.path = str(path)
        self.backup_status = Path(backup_status) if backup_status else None
        self.lock = threading.Lock()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS vault(singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL, revision INTEGER NOT NULL, records TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO vault VALUES(1,?,0,'{}')", (str(uuid.uuid4()),))
        os.chmod(path, 0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def row(db):
        vault_id, revision, records = db.execute("SELECT id,revision,records FROM vault WHERE singleton=1").fetchone()
        return dict(protocol=1, vaultId=vault_id, revision=revision, records=json.loads(records))

    def get(self):
        with self.lock, self.connect() as db:
            return self.row(db)

    def health(self):
        """Return schema readiness without exposing the vault id or records."""
        with self.lock, self.connect() as db:
            table = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vault'"
            ).fetchone()
            if table is None:
                raise sqlite3.DatabaseError("vault schema is not ready")
            db.execute("SELECT singleton FROM vault WHERE singleton=1").fetchone()
        if self.backup_status is not None:
            try:
                status = json.loads(self.backup_status.read_text(encoding="utf-8"))
                age = time.time() - self.backup_status.stat().st_mtime
                if status.get("status") != "ok" or age > 30 * 3600:
                    raise sqlite3.DatabaseError("backup audit is not current")
            except (OSError, ValueError, TypeError, KeyError) as error:
                raise sqlite3.DatabaseError("backup audit is unavailable") from error
        return {"ok": True, "service": "sync", "schemaVersion": 1}

    def put(self, value):
        encoded = validate_update(value)
        records = value["records"]
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = self.row(db)
            if old["vaultId"] != value["vaultId"] or old["revision"] != value["expectedRevision"]:
                return None
            # Keep tombstones forever in beta. Missing old IDs are not deletions.
            if not old["records"].keys() <= records.keys():
                raise ValueError("missing_history")
            if old["records"] != records:
                db.execute("UPDATE vault SET revision=revision+1, records=? WHERE singleton=1", (encoded,))
            return self.row(db)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "TideplanSync/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        # Do not log credentials, request bodies, business data or query strings.
        pass

    def reply(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self):
        if self.path != "/v1/vault":
            self.reply(404, {"error": "not_found"})
            return False
        # No cookies/CORS; require the user's opaque high-entropy vault token.
        supplied = self.headers.get("Authorization", "").encode()
        expected = ("Bearer " + self.server.token).encode()
        if not hmac.compare_digest(supplied, expected):
            self.reply(401, {"error": "unauthorized"})
            return False
        return True

    def do_GET(self):
        if self.path == "/health":
            try:
                self.reply(200, self.server.store.health())
            except (sqlite3.Error, ValueError):
                self.reply(503, {"error": "storage_unavailable"})
            return
        if not self.authorized():
            return
        try:
            self.reply(200, self.server.store.get())
        except (sqlite3.Error, ValueError):
            self.reply(503, {"error": "storage_unavailable"})

    def do_PUT(self):
        if not self.authorized():
            return
        try:
            if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                raise ValueError("content_type")
            size = int(self.headers.get("Content-Length", "-1"))
            if size > MAX_BODY:
                raise OverflowError("size")
            if size < 1:
                raise ValueError("size")
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError("incomplete")
            value = json.loads(body, object_pairs_hook=unique_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("number")))
            result = self.server.store.put(value)
            self.reply(200 if result else 409, result or {"error": "revision_conflict"})
        except OverflowError:
            self.reply(413, {"error": "too_large"})
        except (ValueError, UnicodeError, RecursionError):
            self.reply(400, {"error": "invalid_request"})
        except (sqlite3.Error, OSError):
            self.reply(503, {"error": "storage_unavailable"})


def create_server(address, database, token, backup_status=None):
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", token):
        raise ValueError("TIDEPLAN_SYNC_TOKEN must be a 32–512 character random URL-safe token")
    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    server.store = VaultStore(database, backup_status)
    server.token = token
    return server


if __name__ == "__main__":
    os.umask(0o077)
    database = os.environ.get("TIDEPLAN_SYNC_DB", "./data/vault.sqlite3")
    backup_status = os.environ.get("TIDEPLAN_SYNC_BACKUP_STATUS") or str(Path(database).with_name("backup-audit-status.json"))
    server = create_server(
        (os.environ.get("TIDEPLAN_SYNC_HOST", "127.0.0.1"), int(os.environ.get("TIDEPLAN_SYNC_PORT", "4789"))),
        database,
        os.environ.get("TIDEPLAN_SYNC_TOKEN", ""),
        backup_status,
    )
    print("Tideplan sync ready. Private beta, one owner per vault.", flush=True)
    server.serve_forever()
