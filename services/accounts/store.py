"""Every vault/session operation derives ownership from the authenticated session."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import unicodedata
import uuid

from services.sync.server import validate_update
from .security import hash_password, new_token, token_hash, username_key, verify_password

SESSION_SECONDS = 30 * 24 * 60 * 60
MAX_SESSIONS = 10
SCHEMA_VERSION = 1
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")


class ApiError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


class AccountStore:
    def __init__(self, path, clock=time.time):
        self.path = Path(path)
        self.clock = clock
        if self.path.is_symlink():
            raise ValueError("Account database must not be a symlink")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Never retain a plaintext dummy password; unknown users do the same scrypt work.
        self.dummy_hash = hash_password(new_token())
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, SCHEMA_VERSION):
                raise ValueError("Unsupported account database schema; do not downgrade this database")
            if version == 0:
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                expected = {"users", "vaults", "invites", "sessions", "auth_limits"}
                if tables and tables != expected:
                    raise ValueError("Not an account database; refusing to modify another service's data")
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users(
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
                    disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN(0,1)));
                CREATE TABLE IF NOT EXISTS vaults(
                    owner_id TEXT PRIMARY KEY REFERENCES users(id),
                    id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL DEFAULT 0,
                    records TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS invites(
                    digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL,
                    used_by TEXT REFERENCES users(id));
                CREATE TABLE IF NOT EXISTS sessions(
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
                    digest TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL,
                    platform TEXT NOT NULL, created_at INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);
                CREATE TABLE IF NOT EXISTS auth_limits(
                    subject TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
                    attempts INTEGER NOT NULL);
            """)
            db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                if write:
                    db.execute("BEGIN IMMEDIATE")
                yield db
        finally:
            db.close()

    def now(self):
        return int(self.clock())

    def health(self):
        """Return only schema readiness; never expose account or vault counts."""
        expected = {"users", "vaults", "invites", "sessions", "auth_limits"}
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if version != SCHEMA_VERSION or not expected <= tables:
                raise sqlite3.DatabaseError("account schema is not ready")
            db.execute("SELECT 1 FROM vaults LIMIT 1").fetchone()
        return {"ok": True, "service": "accounts", "schemaVersion": SCHEMA_VERSION}

    def throttle(self, username):
        # Global limit is intentional behind a proxy: never trust client-supplied IP headers.
        now = self.now()
        blocked = False
        with self.connect(write=True) as db:
            db.execute("DELETE FROM auth_limits WHERE window_start<?", (now - 900,))
            for subject, limit in [("all", 120), ("name:" + token_hash(username), 20)]:
                row = db.execute("SELECT * FROM auth_limits WHERE subject=?", (subject,)).fetchone()
                count = row["attempts"] if row else 0
                if count >= limit:
                    blocked = True
                db.execute("INSERT INTO auth_limits VALUES(?,?,1) ON CONFLICT(subject) DO UPDATE SET attempts=attempts+1", (subject, now))
                if blocked:
                    break
        if blocked:
            raise ApiError(429, "auth_rate_limited")

    def create_invite(self, hours=72):
        if type(hours) is not int or not 1 <= hours <= 720:
            raise ValueError("Invite lifetime must be 1-720 hours")
        token = new_token()
        with self.connect(write=True) as db:
            db.execute("INSERT INTO invites(digest,expires_at) VALUES(?,?)", (token_hash(token), self.now() + hours * 3600))
        return token

    @staticmethod
    def device_fields(device_name, platform):
        if not isinstance(device_name, str) or not 1 <= len(device_name.strip()) <= 80 or any(unicodedata.category(c) == "Cc" for c in device_name):
            raise ValueError("device_name")
        if platform not in ("linux", "android", "test"):
            raise ValueError("platform")
        return device_name.strip(), platform

    def issue_session(self, db, user, device_name, platform):
        now = self.now()
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
        if db.execute("SELECT COUNT(*) FROM sessions WHERE owner_id=?", (user["id"],)).fetchone()[0] >= MAX_SESSIONS:
            raise ApiError(409, "device_limit")
        token = new_token()
        session_id = str(uuid.uuid4())
        expires = now + SESSION_SECONDS
        db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)", (session_id, user["id"], token_hash(token), device_name, platform, now, now, expires))
        vault = db.execute("SELECT id FROM vaults WHERE owner_id=?", (user["id"],)).fetchone()
        return {"user": {"id": user["id"], "username": user["username"]},
                "session": {"id": session_id, "deviceName": device_name, "platform": platform,
                            "createdAt": now, "lastSeen": now, "expiresAt": expires},
                "vaultId": vault["id"], "token": token}

    def register(self, username, password, invite, device_name, platform):
        username = username_key(username)
        device_name, platform = self.device_fields(device_name, platform)
        self.throttle(username)
        if not isinstance(invite, str) or not TOKEN_PATTERN.fullmatch(invite):
            raise ApiError(400, "registration_rejected")
        digest = token_hash(invite)
        with self.connect() as db:
            entry = db.execute("SELECT * FROM invites WHERE digest=?", (digest,)).fetchone()
            occupied = db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if not entry or entry["used_by"] or entry["expires_at"] <= self.now() or occupied:
            raise ApiError(400, "registration_rejected")
        encoded = hash_password(password)
        user_id = str(uuid.uuid4())
        with self.connect(write=True) as db:
            # A single transaction consumes the invite, creates ownership and signs in.
            if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise ApiError(400, "registration_rejected")
            db.execute("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)", (user_id, username, encoded, self.now()))
            changed = db.execute("UPDATE invites SET used_by=? WHERE digest=? AND used_by IS NULL AND expires_at>?", (user_id, digest, self.now()))
            if changed.rowcount != 1:
                raise ApiError(400, "registration_rejected")
            db.execute("INSERT INTO vaults(owner_id,id) VALUES(?,?)", (user_id, str(uuid.uuid4())))
            return self.issue_session(db, {"id": user_id, "username": username}, device_name, platform)

    def login(self, username, password, device_name, platform):
        username = username_key(username)
        device_name, platform = self.device_fields(device_name, platform)
        self.throttle(username)
        with self.connect() as db:
            user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        encoded = user["password_hash"] if user else self.dummy_hash
        correct = verify_password(password, encoded)
        if not correct or not user or user["disabled"]:
            raise ApiError(401, "invalid_credentials")
        with self.connect(write=True) as db:
            current = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            if not current or current["disabled"] or current["password_hash"] != encoded:
                raise ApiError(401, "invalid_credentials")
            return self.issue_session(db, current, device_name, platform)

    def authenticate(self, db, token):
        if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
            raise ApiError(401, "session_invalid")
        session = db.execute("SELECT s.*,u.username,u.password_hash FROM sessions s JOIN users u ON u.id=s.owner_id WHERE s.digest=? AND s.expires_at>? AND u.disabled=0", (token_hash(token), self.now())).fetchone()
        if not session:
            raise ApiError(401, "session_invalid")
        if session["last_seen"] < self.now() - 60:
            db.execute("UPDATE sessions SET last_seen=? WHERE id=?", (self.now(), session["id"]))
        return session

    def me(self, token):
        with self.connect(write=True) as db:
            session = self.authenticate(db, token)
            vault = db.execute("SELECT id FROM vaults WHERE owner_id=?", (session["owner_id"],)).fetchone()
            return {"user": {"id": session["owner_id"], "username": session["username"]},
                    "sessionId": session["id"], "expiresAt": session["expires_at"], "vaultId": vault["id"]}

    def sessions(self, token):
        with self.connect(write=True) as db:
            session = self.authenticate(db, token)
            rows = db.execute("SELECT * FROM sessions WHERE owner_id=? AND expires_at>? ORDER BY created_at,id", (session["owner_id"], self.now())).fetchall()
            return {"sessions": [{"id": r["id"], "deviceName": r["device_name"], "platform": r["platform"],
                                  "createdAt": r["created_at"], "lastSeen": r["last_seen"],
                                  "expiresAt": r["expires_at"], "current": r["id"] == session["id"]} for r in rows]}

    def revoke(self, token, session_id):
        with self.connect(write=True) as db:
            session = self.authenticate(db, token)
            if session_id == "others":
                db.execute("DELETE FROM sessions WHERE owner_id=? AND id<>?", (session["owner_id"], session["id"]))
            else:
                uuid.UUID(session_id)
                result = db.execute("DELETE FROM sessions WHERE owner_id=? AND id=?", (session["owner_id"], session_id))
                if not result.rowcount:
                    raise ApiError(404, "session_not_found")
            return {"revoked": True}

    def change_password(self, token, old_password, password):
        with self.connect() as db:
            session = self.authenticate(db, token)
            encoded = session["password_hash"]
        self.throttle(session["username"])
        if not verify_password(old_password, encoded):
            raise ApiError(401, "invalid_credentials")
        new_hash = hash_password(password)
        with self.connect(write=True) as db:
            current = self.authenticate(db, token)
            if current["password_hash"] != encoded:
                raise ApiError(409, "credentials_changed")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (new_hash, current["owner_id"]))
            db.execute("DELETE FROM sessions WHERE owner_id=?", (current["owner_id"],))
        return {"signInRequired": True}

    @staticmethod
    def vault_row(db, owner_id):
        row = db.execute("SELECT * FROM vaults WHERE owner_id=?", (owner_id,)).fetchone()
        return {"protocol": 1, "vaultId": row["id"], "revision": row["revision"], "records": json.loads(row["records"])}

    def get_vault(self, token):
        with self.connect(write=True) as db:
            session = self.authenticate(db, token)
            return self.vault_row(db, session["owner_id"])

    def put_vault(self, token, value):
        encoded = validate_update(value)
        with self.connect(write=True) as db:
            session = self.authenticate(db, token)
            old = self.vault_row(db, session["owner_id"])
            if old["vaultId"] != value["vaultId"] or old["revision"] != value["expectedRevision"]:
                raise ApiError(409, "revision_conflict")
            if not old["records"].keys() <= value["records"].keys():
                raise ValueError("missing_history")
            if old["records"] != value["records"]:
                db.execute("UPDATE vaults SET revision=revision+1,records=? WHERE owner_id=?", (encoded, session["owner_id"]))
            return self.vault_row(db, session["owner_id"])

    def reset_password(self, username, password):
        username = username_key(username)
        encoded = hash_password(password)
        with self.connect(write=True) as db:
            user = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if not user:
                raise ValueError("Account not found")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (encoded, user["id"]))
            db.execute("DELETE FROM sessions WHERE owner_id=?", (user["id"],))
