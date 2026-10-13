"""Versioned module policy and owner-scoped workspaces, opt-in beside v2.

The control database is separate from the legacy account database. All request
transactions hold the account lock before the control lock, so revocation and
policy checks cannot be raced by a business write. Administrator roles confer
policy management, never membership of another person's workspaces.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import unicodedata
import uuid

from services.sync.server import validate_update
from .store import ApiError
from .security import username_key
from . import bootstrap

MODULES = ("overview", "goals", "tasks", "calendar", "countdowns", "people",
           "infrastructure", "work-monitor", "bead-studio", "meal-planner",
           "shopping-list", "fitness", "travel")
ACTIONS = ("visible", "read", "write", "ai")
EDITIONS = ("personal",)
DEPENDENCIES = {"goals": ("tasks",), "calendar": ("tasks",), "overview": ("tasks",)}
MANAGEMENT_ROLES = ("owner", "operator")
SCHEMA_VERSION = 1


def identifier(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("identifier")
    return value


def validate_rules(value):
    if not isinstance(value, dict) or len(value) > len(MODULES):
        raise ValueError("rules")
    for module, actions in value.items():
        if module not in MODULES or not isinstance(actions, dict) or not actions or not actions.keys() <= set(ACTIONS):
            raise ValueError("module_action")
        if any(type(allowed) is not bool for allowed in actions.values()):
            raise ValueError("permission")
        # Local explicit contradictions are rejected; inherited dependency
        # denial automatically removes dependent writes/AI in the resolver.
        if actions.get("read") is False and (actions.get("write") or actions.get("ai")):
            raise ValueError("permission_dependency")
        for dependency in DEPENDENCIES.get(module, ()):
            if actions.get("write") and value.get(dependency, {}).get("write") is False:
                raise ValueError("module_dependency")
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


class ControlStore:
    def __init__(self, path, accounts, environment):
        if environment not in ("preview", "live"):
            raise ValueError("environment")
        self.path = Path(path)
        self.accounts = accounts
        self.environment = environment
        if self.path.is_symlink() or self.path.resolve() == accounts.path.resolve():
            raise ValueError("Control database must be a distinct non-symlink file")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        statements = [
            "CREATE TABLE metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),environment TEXT NOT NULL)",
            "CREATE TABLE roles(user_id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN('owner','operator')))",
            "CREATE TABLE cohorts(user_id TEXT NOT NULL,cohort_id TEXT NOT NULL,PRIMARY KEY(user_id,cohort_id))",
            "CREATE TABLE policy_versions(scope TEXT NOT NULL,subject TEXT NOT NULL,edition TEXT NOT NULL,revision INTEGER NOT NULL,rules TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,subject,edition,revision))",
            "CREATE TABLE policies(scope TEXT NOT NULL,subject TEXT NOT NULL,edition TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(scope,subject,edition))",
            "CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,edition TEXT NOT NULL,name TEXT NOT NULL,vault_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL DEFAULT 0,records TEXT NOT NULL DEFAULT '{}',UNIQUE(owner_id,edition))",
            "CREATE TABLE audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,event TEXT NOT NULL,subject TEXT NOT NULL,created_at INTEGER NOT NULL)",
        ]
        with self.connect(write=True) as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                    raise ValueError("Not an empty control database")
                for statement in statements:
                    db.execute(statement)
                db.execute("INSERT INTO metadata VALUES(1,?)", (environment,))
                db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            elif version != SCHEMA_VERSION:
                raise ValueError("Unsupported control database schema")
            if db.execute("SELECT environment FROM metadata WHERE singleton=1").fetchone()[0] != environment:
                raise ValueError("Control database environment mismatch")
        os.chmod(self.path, 0o600)
        self.purge_deleted_users()

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                if write:
                    db.execute("BEGIN IMMEDIATE")
                yield db
        finally:
            db.close()

    @contextmanager
    def principal(self, token, write=False, manage=False, owner=False):
        with self.accounts.connect(write=True) as account_db:
            session = self.accounts.authenticate(account_db, token)
            with self.connect(write=write) as db:
                bootstrap.complete(self, account_db, db, session)
                row = db.execute("SELECT role FROM roles WHERE user_id=?", (session["owner_id"],)).fetchone()
                role = row[0] if row else "member"
                if (manage and role not in MANAGEMENT_ROLES) or (owner and role != "owner"):
                    raise ApiError(403, "management_forbidden")
                yield session, role, db

    def prepare_owner_invite(self, username, hours=72):
        return bootstrap.prepare(self, username, hours)

    def validate_registration(self, username, invite):
        bootstrap.validate_registration(self, username, invite)

    def audit(self, db, actor, event, subject):
        db.execute("INSERT INTO audit(actor,event,subject,created_at) VALUES(?,?,?,?)",
                   (actor, event, subject, self.accounts.now()))

    def grant_role(self, username, role):
        """Local operator bootstrap only; no unauthenticated HTTP equivalent."""
        if role not in (*MANAGEMENT_ROLES, "member"):
            raise ValueError("role")
        with self.accounts.connect(write=True) as account_db:
            user = account_db.execute("SELECT id FROM users WHERE username=? AND disabled=0", (username_key(username),)).fetchone()
            if not user:
                raise ValueError("Account not found")
            with self.connect(write=True) as db:
                if role == "member":
                    db.execute("DELETE FROM roles WHERE user_id=?", (user[0],))
                else:
                    db.execute("INSERT INTO roles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role", (user[0], role))
                self.audit(db, "local-operator", "role:" + role, user[0])

    def purge_deleted_users(self):
        """Idempotent privacy cleanup after deletion and on process restart.

        No data goes to another user. If cleanup was interrupted after the
        account deletion, restart finishes removing the inaccessible content.
        """
        with self.accounts.connect(write=True) as account_db:
            live_users = {r[0] for r in account_db.execute("SELECT id FROM users")}
            with self.connect(write=True) as db:
                owners = {r[0] for r in db.execute("SELECT owner_id FROM workspaces UNION SELECT user_id FROM roles UNION SELECT user_id FROM cohorts")}
                owners |= {r[0] for r in db.execute("SELECT subject FROM policies WHERE scope='user'")}
                for user_id in owners - live_users:
                    db.execute("DELETE FROM workspaces WHERE owner_id=?", (user_id,))
                    db.execute("DELETE FROM roles WHERE user_id=?", (user_id,))
                    db.execute("DELETE FROM cohorts WHERE user_id=?", (user_id,))
                    db.execute("DELETE FROM policies WHERE scope='user' AND subject=?", (user_id,))
                    db.execute("DELETE FROM policy_versions WHERE scope='user' AND subject=?", (user_id,))

    def health(self):
        with self.connect() as db:
            if db.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
                raise sqlite3.DatabaseError("control schema not ready")
            if db.execute("SELECT environment FROM metadata WHERE singleton=1").fetchone()[0] != self.environment:
                raise sqlite3.DatabaseError("control environment not ready")
        return {"ok": True, "service": "control", "schemaVersion": SCHEMA_VERSION, "environment": self.environment}

    def effective(self, db, user_id, edition):
        if edition not in EDITIONS:
            raise ValueError("edition")
        installed = set(MODULES)
        result = {m: {a: m in installed for a in ACTIONS} for m in MODULES}
        subjects = [("edition", edition), ("user", user_id)]
        subjects += [("cohort", r[0]) for r in db.execute("SELECT cohort_id FROM cohorts WHERE user_id=?", (user_id,))]
        revisions = []
        # Explicit denial wins across every applicable scope. Grants cannot
        # expand the installed/published edition or bypass another scope's deny.
        for scope, subject in subjects:
            row = db.execute("SELECT p.revision,v.rules FROM policies p JOIN policy_versions v USING(scope,subject,edition,revision) WHERE p.scope=? AND p.subject=? AND p.edition=?", (scope, subject, edition)).fetchone()
            if row:
                revisions.append({"scope": scope, "subject": subject, "revision": row[0]})
                for module, actions in json.loads(row[1]).items():
                    for action, allowed in actions.items():
                        result[module][action] = result[module][action] and allowed
        for module in MODULES:
            if not result[module]["read"]:
                result[module]["write"] = result[module]["ai"] = False
            for dependency in DEPENDENCIES.get(module, ()):
                if not result[dependency]["write"]:
                    result[module]["write"] = result[module]["ai"] = False
        return result, revisions

    def workspace(self, db, workspace_id, user_id):
        identifier(workspace_id)
        row = db.execute("SELECT * FROM workspaces WHERE id=? AND owner_id=?", (workspace_id, user_id)).fetchone()
        if not row or row["edition"] != "personal":
            raise ApiError(404, "workspace_not_found")
        return row

    def capabilities(self, token, workspace_id=None):
        with self.principal(token) as (session, role, db):
            edition = self.workspace(db, workspace_id, session["owner_id"])["edition"] if workspace_id else "personal"
            modules, revisions = self.effective(db, session["owner_id"], edition)
            return {"schemaVersion": 1, "environment": self.environment, "edition": edition,
                    "workspaceId": workspace_id, "role": role, "modules": modules,
                    "policyRevisions": revisions, "checkedAt": self.accounts.now(),
                    "management": {"policies": role in MANAGEMENT_ROLES, "cohorts": role == "owner"}}

    def list_workspaces(self, token):
        with self.principal(token) as (session, _, db):
            rows = db.execute("SELECT id,edition,name,vault_id FROM workspaces WHERE owner_id=? AND edition='personal' ORDER BY edition", (session["owner_id"],)).fetchall()
            return {"schemaVersion": 1, "environment": self.environment,
                    "workspaces": [{"id": r["id"], "edition": r["edition"], "name": r["name"], "vaultId": r["vault_id"]} for r in rows]}

    def create_workspace(self, token, edition, name):
        if edition not in EDITIONS or not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(unicodedata.category(c) == "Cc" for c in name):
            raise ValueError("workspace")
        with self.principal(token, write=True) as (session, role, db):
            if edition == "personal" and role not in MANAGEMENT_ROLES:
                raise ApiError(403, "edition_forbidden")
            db.execute("INSERT OR IGNORE INTO workspaces(id,owner_id,edition,name,vault_id) VALUES(?,?,?,?,?)", (str(uuid.uuid4()), session["owner_id"], edition, name.strip(), str(uuid.uuid4())))
        return self.list_workspaces(token)

    def vault(self, token, workspace_id, update=None):
        encoded = validate_update(update, allow_bead_works=True) if update is not None else None
        with self.principal(token, write=update is not None) as (session, _, db):
            row = self.workspace(db, workspace_id, session["owner_id"])
            old = json.loads(row["records"])
            if update is not None:
                if update["vaultId"] != row["vault_id"] or update["expectedRevision"] != row["revision"]:
                    raise ApiError(409, "revision_conflict")
                if not old.keys() <= update["records"].keys():
                    raise ValueError("missing_history")
                modules, _ = self.effective(db, session["owner_id"], row["edition"])
                for key, record in update["records"].items():
                    if key not in old or record != old[key]:
                        module = "bead-studio" if key == "tideplan.bead-works.v1" else "goals" if key == "goals" else "tasks"
                        if not modules[module]["write"]:
                            raise ApiError(403, "module_write_forbidden")
                if old != update["records"]:
                    db.execute("UPDATE workspaces SET records=?,revision=revision+1 WHERE id=?", (encoded, workspace_id))
                    row = self.workspace(db, workspace_id, session["owner_id"])
            # Owners retain the ability to export their existing records when a
            # module is disabled. This endpoint never grants new write access.
            return {"protocol": 1, "vaultId": row["vault_id"], "revision": row["revision"], "records": json.loads(row["records"])}

    def put_legacy_vault(self, token, update):
        """Enforce policies on the old route without changing its wire shape."""
        encoded = validate_update(update)
        with self.accounts.connect(write=True) as account_db:
            session = self.accounts.authenticate(account_db, token)
            old = self.accounts.vault_row(account_db, session["owner_id"])
            if old["vaultId"] != update["vaultId"] or old["revision"] != update["expectedRevision"]:
                raise ApiError(409, "revision_conflict")
            if not old["records"].keys() <= update["records"].keys():
                raise ValueError("missing_history")
            with self.connect() as db:
                modules, _ = self.effective(db, session["owner_id"], "personal")
                for key, record in update["records"].items():
                    if key not in old["records"] or record != old["records"][key]:
                        module = "goals" if key == "goals" else "tasks"
                        if not modules[module]["write"]:
                            raise ApiError(403, "module_write_forbidden")
                if old["records"] != update["records"]:
                    account_db.execute("UPDATE vaults SET revision=revision+1,records=? WHERE owner_id=?", (encoded, session["owner_id"]))
                return self.accounts.vault_row(account_db, session["owner_id"])

    def validate_subject(self, db, scope, subject, edition):
        if edition not in EDITIONS or scope not in ("edition", "cohort", "user") or not isinstance(subject, str):
            raise ValueError("policy_subject")
        if scope == "edition" and subject != edition:
            raise ValueError("edition_subject")
        if scope == "user":
            identifier(subject)
            if not db.execute("SELECT 1 FROM users WHERE id=? AND disabled=0", (subject,)).fetchone():
                raise ApiError(404, "user_not_found")
        if scope == "cohort" and (not 1 <= len(subject) <= 40 or not all(c.isascii() and (c.isalnum() or c in "_-") for c in subject)):
            raise ValueError("cohort")

    def publish(self, token, scope, subject, edition, expected_revision, rules, restore_revision=None):
        if type(expected_revision) is not int or not 0 <= expected_revision <= 9_007_199_254_740_990:
            raise ValueError("revision")
        encoded = validate_rules(rules)
        with self.accounts.connect(write=True) as account_db:
            session = self.accounts.authenticate(account_db, token)
            self.validate_subject(account_db, scope, subject, edition)
            with self.connect(write=True) as db:
                role = db.execute("SELECT role FROM roles WHERE user_id=?", (session["owner_id"],)).fetchone()
                if not role or role[0] not in MANAGEMENT_ROLES:
                    raise ApiError(403, "management_forbidden")
                row = db.execute("SELECT revision FROM policies WHERE scope=? AND subject=? AND edition=?", (scope, subject, edition)).fetchone()
                if (row[0] if row else 0) != expected_revision:
                    raise ApiError(409, "policy_revision_conflict")
                if restore_revision is not None:
                    if type(restore_revision) is not int or not 1 <= restore_revision <= expected_revision:
                        raise ValueError("restore_revision")
                    old = db.execute("SELECT rules FROM policy_versions WHERE scope=? AND subject=? AND edition=? AND revision=?", (scope, subject, edition, restore_revision)).fetchone()
                    if not old:
                        raise ApiError(404, "policy_version_not_found")
                    encoded = old[0]
                revision = expected_revision + 1
                db.execute("INSERT INTO policy_versions VALUES(?,?,?,?,?,?,?)", (scope, subject, edition, revision, encoded, session["owner_id"], self.accounts.now()))
                db.execute("INSERT INTO policies VALUES(?,?,?,?) ON CONFLICT(scope,subject,edition) DO UPDATE SET revision=excluded.revision", (scope, subject, edition, revision))
                self.audit(db, session["owner_id"], "policy:restore" if restore_revision is not None else "policy:publish", f"{scope}:{subject}:{edition}:{revision}")
                return {"scope": scope, "subject": subject, "edition": edition, "revision": revision, "rules": json.loads(encoded)}

    def cohort(self, token, user_id, cohort_id, member):
        if type(member) is not bool:
            raise ValueError("member")
        with self.accounts.connect(write=True) as account_db:
            session = self.accounts.authenticate(account_db, token)
            self.validate_subject(account_db, "user", user_id, "personal")
            self.validate_subject(account_db, "cohort", cohort_id, "personal")
            with self.connect(write=True) as db:
                role = db.execute("SELECT role FROM roles WHERE user_id=?", (session["owner_id"],)).fetchone()
                if not role or role[0] != "owner":
                    raise ApiError(403, "management_forbidden")
                if member:
                    db.execute("INSERT OR IGNORE INTO cohorts VALUES(?,?)", (user_id, cohort_id))
                else:
                    db.execute("DELETE FROM cohorts WHERE user_id=? AND cohort_id=?", (user_id, cohort_id))
                self.audit(db, session["owner_id"], "cohort:add" if member else "cohort:remove", f"{cohort_id}:{user_id}")
        return {"updated": True}

    def overview(self, token):
        with self.principal(token, manage=True) as (_, role, db):
            rows = db.execute("SELECT p.*,v.rules FROM policies p JOIN policy_versions v USING(scope,subject,edition,revision) ORDER BY p.edition,p.scope,p.subject").fetchall()
            return {"schemaVersion": 1, "environment": self.environment, "role": role,
                    "modules": list(MODULES), "editions": list(EDITIONS),
                    "policies": [dict(r, rules=json.loads(r["rules"])) for r in rows],
                    "health": self.health(), "metrics": {"aiCost": None, "activation": None},
                    "audit": [dict(r) for r in db.execute("SELECT actor,event,subject,created_at FROM audit ORDER BY id DESC LIMIT 50")]}

    def users(self, token):
        with self.principal(token, manage=True) as (_, _, db):
            with self.accounts.connect() as account_db:
                rows = account_db.execute("SELECT id,username,disabled FROM users ORDER BY username LIMIT 500").fetchall()
                total = account_db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            return {"users": [{"id": r["id"], "username": r["username"], "disabled": bool(r["disabled"]),
                               "cohorts": [c[0] for c in db.execute("SELECT cohort_id FROM cohorts WHERE user_id=? ORDER BY cohort_id", (r["id"],))]} for r in rows],
                    "truncated": total > len(rows)}
