"""Opt-in deployment check; only newly created synthetic users are mutated.

Exercise, restart the v2 service, then resume. State holds temporary session
tokens and must stay in a private directory outside the repository.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import sqlite3
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from services.accounts.store import AccountStore, ApiError
from services.accounts.security import token_hash


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def expect(condition, stage):
    if not condition:
        raise RuntimeError("Account deployment check failed: " + stage)


def cleanup(store, state):
    # Check exact pre-reserved synthetic names, never a prefix or all users.
    with store.connect(write=True) as db:
        for name in state["names"]:
            user = db.execute("SELECT id,created_at FROM users WHERE username=?", (name,)).fetchone()
            if user:
                expect(user["created_at"] >= state["started"], "synthetic ownership")
                db.execute("UPDATE users SET disabled=1 WHERE id=?", (user["id"],))
                db.execute("DELETE FROM sessions WHERE owner_id=?", (user["id"],))
        for digest in state["inviteDigests"]:
            db.execute("UPDATE invites SET expires_at=? WHERE digest=? AND used_by IS NULL", (store.now(), digest))


def run(arguments):
    base = arguments.endpoint.rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    local = parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and arguments.allow_local
    expect((parsed.scheme == "https" or local) and parsed.netloc and not parsed.username
           and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment, "endpoint")
    state_path = arguments.state.resolve()
    expect(arguments.state.is_absolute() and state_path.parent.is_dir()
           and state_path.parent.stat().st_mode & 0o077 == 0, "private state directory")
    expect(arguments.database.is_file(), "existing account database")
    store = AccountStore(arguments.database)
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    def request(method, route, body=None, token=None, expected=200):
        headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Oceanseo-Accounts-Check/2"}
        if token:
            headers["Authorization"] = "Bearer " + token
        data = json.dumps(body).encode() if body is not None else None
        try:
            response = opener.open(urllib.request.Request(base + route, data=data, headers=headers, method=method), timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            expect(response.code == expected, f"{method} {route}: HTTP {response.code}")
            expect(response.headers.get("Cache-Control") == "no-store", "uncached API")
            return json.loads(response.read(17 * 1024 * 1024))

    state = None
    try:
        if arguments.phase == "exercise":
            expect(not arguments.state.exists() and not arguments.state.is_symlink(), "new state file")
            run_id = uuid.uuid4().hex[:16]
            names = [f"qa-{run_id}-{suffix}" for suffix in ("a", "b")]
            with store.connect() as db:
                expect(all(not db.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone() for name in names), "new synthetic names")
            state = {"names": names, "started": store.now(), "inviteDigests": [], "endpoint": base}
            password = "QA-only-" + secrets.token_urlsafe(24)
            request("GET", "/v2/me", expected=401)
            request("GET", "/v2/vault", expected=401)
            registration = {"username": names[0], "password": password, "invite": "missing", "deviceName": "Deployment QA Linux", "platform": "linux"}
            request("POST", "/v2/register", registration, expected=400)
            accounts = []
            for name in names:
                invite = store.create_invite(hours=1)
                state["inviteDigests"].append(token_hash(invite))
                registration.update(username=name, invite=invite)
                accounts.append(request("POST", "/v2/register", registration, expected=201))
                request("POST", "/v2/register", {**registration, "username": name + "-reuse"}, expected=400)
            alice, bob = accounts
            phone = request("POST", "/v2/login", {"username": names[0], "password": password, "deviceName": "Deployment QA Android", "platform": "android"})
            expect(phone["vaultId"] == alice["vaultId"] and phone["user"] == alice["user"], "same-account devices")
            av = request("GET", "/v2/vault", token=alice["token"])
            bv = request("GET", "/v2/vault", token=bob["token"])
            expect(av["records"] == bv["records"] == {} and av["vaultId"] != bv["vaultId"], "independent empty vaults")
            update = {"protocol": 1, "vaultId": av["vaultId"], "expectedRevision": av["revision"],
                      "records": {"task:" + str(uuid.uuid4()): {"title": "Synthetic deployment check; no user data"}}}
            saved = request("PUT", "/v2/vault", update, alice["token"])
            expect(request("GET", "/v2/vault", token=phone["token"]) == saved, "second-device read")
            request("PUT", "/v2/vault", update, alice["token"], expected=409)
            request("PUT", "/v2/vault", {**update, "expectedRevision": saved["revision"]}, bob["token"], expected=409)
            expect(request("GET", "/v2/vault", token=bob["token"]) == bv, "foreign write rejected")
            expect(len(request("GET", "/v2/sessions", token=alice["token"])["sessions"]) == 2, "device list")
            route = "/v2/sessions/" + phone["session"]["id"]
            request("DELETE", route, token=bob["token"], expected=404)
            request("DELETE", route, token=alice["token"])
            request("GET", "/v2/me", token=phone["token"], expected=401)
            request("GET", "/v2/me", token=alice["token"])
            state.update(alice=alice, bob=bob, revoked=phone, saved=saved, bobVault=bv)
            with os.fdopen(os.open(arguments.state, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w") as file:
                json.dump(state, file)
            print(json.dumps({"phase": "exercise", "passed": True, "invitationOnly": True,
                              "independentUsers": True, "deviceRevocation": True, "revisionConflict": True,
                              "next": "restart only oceanseo-accounts, then run resume"}))
            return

        expect(not arguments.state.is_symlink() and arguments.state.stat().st_mode & 0o077 == 0
               and arguments.state.stat().st_uid == os.getuid(), "private state file")
        state = json.loads(arguments.state.read_text())
        expect(state["endpoint"] == base, "same endpoint after restart")
        expect(all(name.startswith("qa-") for name in state["names"]) and len(state["names"]) == 2, "synthetic state")
        alice, bob, revoked = (state[key] for key in ("alice", "bob", "revoked"))
        expect(request("GET", "/v2/vault", token=alice["token"]) == state["saved"], "restart vault persistence")
        expect(request("GET", "/v2/vault", token=bob["token"]) == state["bobVault"], "restart isolation")
        request("GET", "/v2/me", token=revoked["token"], expected=401)
        # Restore into an independent temporary file, never replace the live DB.
        restored_path = state_path.parent / "restored.sqlite3"
        expect(not restored_path.exists(), "new restore destination")
        subprocess.run([sys.executable, str(Path(__file__).parents[1] / "sync" / "backup.py"),
                        str(store.path), str(restored_path)], check=True, capture_output=True)
        with sqlite3.connect(restored_path.resolve().as_uri() + "?mode=ro", uri=True) as target:
            expect(target.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "backup integrity")
        restored = AccountStore(restored_path)
        expect(restored.get_vault(alice["token"]) == state["saved"], "restored ownership/data")
        expect(restored.get_vault(bob["token"]) == state["bobVault"], "restored second-user isolation")
        try:
            restored.me(revoked["token"])
            raise RuntimeError("Revocation lost in restored backup")
        except ApiError as error:
            expect(error.status == 401, "restored revocation")
        cleanup(store, state)
        state = None
        request("GET", "/v2/me", token=alice["token"], expected=401)
        request("GET", "/v2/me", token=bob["token"], expected=401)
        print(json.dumps({"phase": "resume", "passed": True, "restartPersistence": True,
                          "independentRestore": True, "syntheticUsersDisabled": True,
                          "syntheticSessionsRevoked": True}))
    except Exception:
        if state:
            cleanup(store, state)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("exercise", "resume"))
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--allow-local", action="store_true", help="Local temporary-service testing only")
    os.umask(0o077)
    run(parser.parse_args())
