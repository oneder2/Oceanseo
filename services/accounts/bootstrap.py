"""Operator-issued owner invitation; never grant a role by username alone.

The private versioned manifest is service configuration, outside account schema.
The consumed invitation proves identity; the control audit is the durable claim
receipt, so later role revocation is never undone by this bootstrap.
"""
import json
import os
from pathlib import Path
import uuid

from .security import new_token, token_hash, username_key
from .store import ApiError, TOKEN_PATTERN


def manifest_path(control):
    return control.path.with_suffix(".owner-bootstrap.json")


def load(control):
    path = manifest_path(control)
    if path.is_symlink():
        raise ValueError("Owner bootstrap must not be a symlink")
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("Owner bootstrap must be private")
    if path.stat().st_size > 4096:
        raise ValueError("Owner bootstrap too large")
    value = json.loads(path.read_text(encoding="utf-8"))
    fields = {"version", "environment", "accountsSource", "username", "inviteDigest", "expiresAt", "operationId"}
    if not isinstance(value, dict) or set(value) != fields or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Unsupported owner bootstrap configuration")
    if value["environment"] != control.environment or value["accountsSource"] != str(control.accounts.path.resolve()):
        raise ValueError("Owner bootstrap source mismatch")
    if username_key(value["username"]) != value["username"] or type(value["expiresAt"]) is not int:
        raise ValueError("Owner bootstrap identity invalid")
    if not isinstance(value["inviteDigest"], str) or len(value["inviteDigest"]) != 64 or any(c not in "0123456789abcdef" for c in value["inviteDigest"]):
        raise ValueError("Owner bootstrap digest invalid")
    if str(uuid.UUID(value["operationId"])) != value["operationId"]:
        raise ValueError("Owner bootstrap operation invalid")
    return value


def prepare(control, username, hours=72):
    username = username_key(username)
    if type(hours) is not int or not 1 <= hours <= 720:
        raise ValueError("Invite lifetime must be 1-720 hours")
    path = manifest_path(control)
    if path.exists() or path.is_symlink():
        raise ValueError("Owner bootstrap already configured; do not overwrite it")
    invite = new_token()
    expires = control.accounts.now() + hours * 3600
    value = {"version": 1, "environment": control.environment,
             "accountsSource": str(control.accounts.path.resolve()), "username": username,
             "inviteDigest": token_hash(invite), "expiresAt": expires,
             "operationId": str(uuid.uuid4())}
    # Account lock also serializes registrations, role changes and backups.
    with control.accounts.connect(write=True) as db:
        if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise ValueError("Username already exists; verify ownership before assigning a role")
        db.execute("INSERT INTO invites(digest,expires_at) VALUES(?,?)", (value["inviteDigest"], expires))
        # Exclusive creation prevents another operator from replacing the binding.
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
    return {"username": username, "invite": invite, "expiresAt": expires}


def validate_registration(control, username, invite):
    pending = load(control)
    if not pending or pending["expiresAt"] <= control.accounts.now():
        return
    normalized = username_key(username)
    matching = isinstance(invite, str) and TOKEN_PATTERN.fullmatch(invite) and token_hash(invite) == pending["inviteDigest"]
    if (matching and normalized != pending["username"]) or (normalized == pending["username"] and not matching):
        raise ApiError(400, "registration_rejected")


def complete(control, account_db, control_db, session):
    pending = load(control)
    if not pending or pending["expiresAt"] <= control.accounts.now() or session["username"] != pending["username"]:
        return
    receipt = control_db.execute("SELECT 1 FROM audit WHERE event='owner:bootstrap' AND subject=?", (pending["operationId"],)).fetchone()
    if receipt:
        return
    invitation = account_db.execute("SELECT used_by FROM invites WHERE digest=?", (pending["inviteDigest"],)).fetchone()
    if not invitation or invitation[0] != session["owner_id"]:
        return
    control_db.execute("INSERT INTO roles VALUES(?,'owner') ON CONFLICT(user_id) DO UPDATE SET role='owner'", (session["owner_id"],))
    control.audit(control_db, "local-operator", "owner:bootstrap", pending["operationId"])
