import concurrent.futures
import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import subprocess
import sys
from pathlib import Path

from .security import hash_password, verify_password
from .server import create_server
from .store import AccountStore, ApiError, SESSION_SECONDS

PASSWORD = "Synthetic-only-password-123!"
KEY = "task:00000000-0000-4000-8000-000000000001"


class AccountsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "accounts.sqlite3"
        self.now = 1_790_000_000
        self.server = create_server(("127.0.0.1", 0), self.path, clock=lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, route, body=None, token=None, raw=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=30)
        payload = raw if raw is not None else json.dumps(body) if body is not None else None
        fields = {"Content-Type": "application/json"}
        if token:
            fields["Authorization"] = "Bearer " + token
        fields.update(headers or {})
        connection.request(method, route, body=payload, headers=fields)
        response = connection.getresponse()
        code = response.status
        self.assertEqual(response.getheader("Cache-Control"), "no-store")
        content = json.loads(response.read())
        connection.close()
        return code, content

    def register(self, username="alice", invite=None):
        invite = invite or self.server.store.create_invite()
        code, result = self.request("POST", "/v2/register", {"username": username, "password": PASSWORD,
                                   "invite": invite, "deviceName": "合成电脑", "platform": "linux"})
        self.assertEqual(code, 201, result)
        return result

    def login(self, username="alice", password=PASSWORD):
        return self.request("POST", "/v2/login", {"username": username, "password": password,
                            "deviceName": "合成手机", "platform": "android"})

    def vault(self, account):
        code, vault = self.request("GET", "/v2/vault", token=account["token"])
        self.assertEqual(code, 200)
        return vault

    def put(self, account, vault, records):
        return self.request("PUT", "/v2/vault", {"protocol": 1, "vaultId": vault["vaultId"],
                            "expectedRevision": vault["revision"], "records": records}, account["token"])

    def test_registration_invitation_and_password_hashing(self):
        invite = self.server.store.create_invite()
        account = self.register("Alice", invite)
        self.assertEqual(account["user"]["username"], "alice")
        code, second = self.request("POST", "/v2/register", {"username": "bob", "password": PASSWORD,
                                    "invite": invite, "deviceName": "电脑", "platform": "linux"})
        self.assertEqual(code, 400)
        self.assertEqual(second["error"], "registration_rejected")
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM vaults").fetchone()[0], 1)
            encoded = db.execute("SELECT password_hash FROM users").fetchone()[0]
        self.assertTrue(encoded.startswith("scrypt-v1$"))
        self.assertTrue(verify_password(PASSWORD, encoded))
        self.assertFalse(verify_password(PASSWORD + "wrong", encoded))
        data = self.path.read_bytes()
        self.assertNotIn(PASSWORD.encode(), data)
        self.assertNotIn(invite.encode(), data)
        self.assertNotIn(account["token"].encode(), data)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_health_is_public_but_does_not_expose_account_data(self):
        code, result = self.request("GET", "/v2/health")
        self.assertEqual(code, 200)
        self.assertEqual(result, {"ok": True, "service": "accounts", "schemaVersion": 1})
        self.assertNotIn("users", result)
        self.assertNotIn("vaultId", result)

    def test_health_rejects_missing_or_stale_backup_audit(self):
        status = self.path.with_name("backup-audit-status.json")
        self.server.store.backup_status = status
        code, _ = self.request("GET", "/v2/health")
        self.assertEqual(code, 503)
        status.write_text('{"status":"ok"}', encoding="utf-8")
        code, _ = self.request("GET", "/v2/health")
        self.assertEqual(code, 200)
        old = status.stat().st_mtime
        os.utime(status, (old, old - 31 * 3600))
        code, _ = self.request("GET", "/v2/health")
        self.assertEqual(code, 503)

    def test_user_isolation_and_foreign_vault_attack(self):
        alice, bob = self.register(), self.register("bob")
        av, bv = self.vault(alice), self.vault(bob)
        self.assertNotEqual(av["vaultId"], bv["vaultId"])
        _, saved = self.put(alice, av, {KEY: {"title": "只属于 Alice"}})
        self.assertEqual(self.put(bob, saved, {KEY: {"title": "试图跨用户写入"}})[0], 409)
        self.assertEqual(self.vault(bob)["records"], {})
        self.assertEqual(self.vault(alice), saved)
        self.assertEqual(self.request("GET", "/v2/vault?userId=" + alice["user"]["id"], token=bob["token"])[0], 404)
        body = {"protocol": 1, "vaultId": saved["vaultId"], "expectedRevision": saved["revision"], "records": {}, "ownerId": alice["user"]["id"]}
        self.assertEqual(self.request("PUT", "/v2/vault", body, bob["token"])[0], 400)

    def test_login_multiple_devices_and_owner_only_revocation(self):
        alice, bob = self.register(), self.register("bob")
        code, phone = self.login("ALICE")
        self.assertEqual(code, 200)
        self.assertEqual(phone["user"], alice["user"])
        self.assertEqual(phone["vaultId"], alice["vaultId"])
        self.assertNotEqual(phone["token"], alice["token"])
        code, listed = self.request("GET", "/v2/sessions", token=alice["token"])
        self.assertEqual(code, 200)
        self.assertEqual(len(listed["sessions"]), 2)
        self.assertEqual(sum(s["current"] for s in listed["sessions"]), 1)
        self.assertNotIn("token", json.dumps(listed))
        route = "/v2/sessions/" + phone["session"]["id"]
        self.assertEqual(self.request("DELETE", route, token=bob["token"])[0], 404)
        self.assertEqual(self.request("GET", "/v2/me", token=phone["token"])[0], 200)
        self.assertEqual(self.request("DELETE", route, token=alice["token"])[0], 200)
        self.assertEqual(self.request("GET", "/v2/vault", token=phone["token"])[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=alice["token"])[0], 200)

    def test_revoke_others_and_logout(self):
        account = self.register()
        _, phone = self.login()
        self.request("DELETE", "/v2/sessions/others", token=account["token"])
        self.assertEqual(self.request("GET", "/v2/me", token=phone["token"])[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 200)
        self.request("DELETE", "/v2/sessions/" + account["session"]["id"], token=account["token"])
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 401)
        self.assertEqual(self.login()[0], 200)

    def test_password_change_revokes_all_sessions(self):
        account = self.register()
        _, phone = self.login()
        new = "Another-synthetic-password-123!"
        wrong = {"currentPassword": PASSWORD + "no", "password": new}
        self.assertEqual(self.request("POST", "/v2/password", wrong, account["token"])[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=phone["token"])[0], 200)
        code, result = self.request("POST", "/v2/password", {"currentPassword": PASSWORD, "password": new}, account["token"])
        self.assertEqual((code, result), (200, {"signInRequired": True}))
        for device in (account, phone):
            self.assertEqual(self.request("GET", "/v2/me", token=device["token"])[0], 401)
        self.assertEqual(self.login(password=PASSWORD)[0], 401)
        self.assertEqual(self.login(password=new)[0], 200)

    def test_account_deletion_requires_confirmation_and_removes_cloud_data(self):
        invite = self.server.store.create_invite()
        account = self.register("delete-me", invite)
        vault = self.vault(account)
        self.assertEqual(self.put(account, vault, {KEY: {"title": "cloud only"}})[0], 200)
        wrong = self.request("DELETE", "/v2/account", {"password": PASSWORD + "wrong", "confirmation": "DELETE"}, account["token"])
        self.assertEqual(wrong[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 200)
        unconfirmed = self.request("DELETE", "/v2/account", {"password": PASSWORD, "confirmation": "delete"}, account["token"])
        self.assertEqual(unconfirmed[0], 400)
        deleted = self.request("DELETE", "/v2/account", {"password": PASSWORD, "confirmation": "DELETE"}, account["token"])
        self.assertEqual(deleted, (200, {"deleted": True}))
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 401)
        with self.server.store.connect() as db:
            self.assertIsNone(db.execute("SELECT id FROM users WHERE username='delete-me'").fetchone())
            self.assertIsNone(db.execute("SELECT owner_id FROM vaults WHERE owner_id=?", (account["user"]["id"],)).fetchone())
            self.assertIsNone(db.execute("SELECT id FROM sessions WHERE owner_id=?", (account["user"]["id"],)).fetchone())
            self.assertEqual(db.execute("SELECT COUNT(*) FROM invites").fetchone()[0], 0)

    def test_expiry_and_restart_preserve_identity_and_revocations(self):
        invite = self.server.store.create_invite(hours=1)
        self.now += 3601
        body = {"username": "expired", "password": PASSWORD, "invite": invite, "deviceName": "电脑", "platform": "linux"}
        self.assertEqual(self.request("POST", "/v2/register", body)[0], 400)
        account = self.register()
        original = self.vault(account)
        reopened = AccountStore(self.path, clock=lambda: self.now)
        self.assertEqual(reopened.get_vault(account["token"]), original)
        self.now += SESSION_SECONDS
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 401)
        _, next_session = self.login()
        self.assertEqual(self.vault(next_session), original)

    def test_online_backup_restores_users_vaults_revocations_and_never_raw_secrets(self):
        invite = self.server.store.create_invite()
        alice = self.register(invite=invite)
        bob = self.register("bob")
        _, phone = self.login()
        _, saved = self.put(alice, self.vault(alice), {KEY: {"title": "backup ownership"}})
        self.request("DELETE", "/v2/sessions/" + phone["session"]["id"], token=alice["token"])
        destination = Path(self.tmp.name) / "restored.sqlite3"
        script = Path(__file__).parents[1] / "sync" / "backup.py"
        subprocess.run([sys.executable, str(script), str(self.path), str(destination)], check=True, capture_output=True)
        restored = AccountStore(destination, clock=lambda: self.now)
        self.assertEqual(restored.get_vault(alice["token"]), saved)
        self.assertEqual(restored.get_vault(bob["token"])["records"], {})
        with self.assertRaises(ApiError) as error:
            restored.me(phone["token"])
        self.assertEqual(error.exception.status, 401)
        for file in Path(self.tmp.name).iterdir():
            if file.name.endswith(("sqlite3", "-wal", "-shm")):
                raw = file.read_bytes()
                for secret in (PASSWORD, invite, alice["token"], bob["token"], phone["token"]):
                    self.assertNotIn(secret.encode(), raw)

    def test_future_schema_and_foreign_database_are_rejected_without_modification(self):
        future = Path(self.tmp.name) / "future.sqlite3"
        foreign = Path(self.tmp.name) / "foreign.sqlite3"
        with sqlite3.connect(future) as db:
            db.execute("PRAGMA user_version=999")
        with sqlite3.connect(foreign) as db:
            db.execute("CREATE TABLE vault(singleton INTEGER)")
        for path in (future, foreign):
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                AccountStore(path)
            self.assertEqual(path.read_bytes(), before)
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_disabled_user_cannot_login_read_or_write_and_other_user_is_unaffected(self):
        alice, bob = self.register(), self.register("bob")
        av = self.vault(alice)
        with self.server.store.connect(write=True) as db:
            db.execute("UPDATE users SET disabled=1 WHERE id=?", (alice["user"]["id"],))
        self.assertEqual(self.login()[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=alice["token"])[0], 401)
        self.assertEqual(self.request("GET", "/v2/vault", token=alice["token"])[0], 401)
        self.assertEqual(self.put(alice, av, {KEY: {"title": "denied"}})[0], 401)
        self.assertEqual(self.request("GET", "/v2/me", token=bob["token"])[0], 200)

    def test_concurrent_logout_and_write_are_serialized_and_future_writes_are_denied(self):
        alice = self.register()
        av = self.vault(alice)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            logout = pool.submit(self.request, "DELETE", "/v2/sessions/" + alice["session"]["id"], None, alice["token"])
            write = pool.submit(self.put, alice, av, {KEY: {"title": "inflight"}})
            self.assertEqual(logout.result()[0], 200)
            write_status = write.result()[0]
            self.assertIn(write_status, (200, 401))
        self.assertEqual(self.put(alice, av, {KEY: None})[0], 401)
        _, signed_in = self.login()
        records = self.vault(signed_in)["records"]
        self.assertEqual(records, {KEY: {"title": "inflight"}} if write_status == 200 else {})

    def test_concurrent_invite_consumption_creates_one_owner_only(self):
        invite = self.server.store.create_invite()
        def attempt(username):
            return self.request("POST", "/v2/register", {"username": username, "password": PASSWORD,
                                "invite": invite, "deviceName": "电脑", "platform": "linux"})[0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            statuses = list(pool.map(attempt, ["alice", "bob"]))
        self.assertEqual(sorted(statuses), [201, 400])
        with self.server.store.connect() as db:
            for table in ("users", "vaults", "sessions"):
                self.assertEqual(db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 1)

    def test_revision_conflicts_deletions_and_retry(self):
        account = self.register()
        old = self.vault(account)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            statuses = list(pool.map(lambda text: self.put(account, old, {KEY: {"title": text}})[0], ["电脑", "手机"]))
        self.assertEqual(sorted(statuses), [200, 409])
        saved = self.vault(account)
        self.assertEqual(self.put(account, saved, saved["records"]), (200, saved))
        _, deleted = self.put(account, saved, {KEY: None})
        self.assertEqual(self.put(account, deleted, {})[0], 400)
        self.assertEqual(AccountStore(self.path, clock=lambda: self.now).get_vault(account["token"]), deleted)

    def test_validation_auth_and_safe_errors(self):
        self.assertEqual(self.request("GET", "/v2/me")[0], 401)
        self.assertEqual(self.request("GET", "/v2/vault", token="invalid")[0], 401)
        self.assertEqual(self.request("GET", "/v1/vault")[0], 404)
        self.assertEqual(self.request("POST", "/v2/login", raw='{"username":"alice","username":"bob"}')[0], 400)
        self.assertEqual(self.request("POST", "/v2/login", raw='{"username":NaN}')[0], 400)
        self.assertEqual(self.request("POST", "/v2/login", raw="x" * 8193)[0], 413)
        self.assertEqual(self.request("POST", "/v2/login", {}, headers={"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.login("unknown-user")[0], 401)
        account = self.register()
        self.assertEqual(self.login(password="incorrect-password-123")[1], {"error": "invalid_credentials"})
        self.assertEqual(self.put(account, self.vault(account), {"secret": {}})[0], 400)
        self.assertEqual(self.request("DELETE", "/v2/sessions/not-an-id", token=account["token"])[0], 400)

    def test_throttle_persists_and_expires(self):
        store = self.server.store
        for _ in range(20):
            store.throttle("test-limit")
        reopened = AccountStore(self.path, clock=lambda: self.now)
        with self.assertRaises(ApiError) as caught:
            reopened.throttle("test-limit")
        self.assertEqual(caught.exception.status, 429)
        self.now += 901
        reopened.throttle("test-limit")

    def test_device_cap_and_admin_recovery(self):
        account = self.register()
        for _ in range(9):
            self.assertEqual(self.login()[0], 200)
        self.assertEqual(self.login(), (409, {"error": "device_limit"}))
        self.server.store.reset_password("alice", "Recovered-synthetic-password-123!")
        self.assertEqual(self.request("GET", "/v2/me", token=account["token"])[0], 401)
        self.assertEqual(self.login(password="Recovered-synthetic-password-123!")[0], 200)

    def test_password_salts_and_bind_policy(self):
        one, two = hash_password(PASSWORD), hash_password(PASSWORD)
        self.assertNotEqual(one, two)
        self.assertFalse(verify_password(PASSWORD, "damaged"))
        with self.assertRaises(ValueError):
            hash_password("too-short")
        with self.assertRaises(ValueError):
            create_server(("0.0.0.0", 0), self.path)


if __name__ == "__main__":
    unittest.main()
