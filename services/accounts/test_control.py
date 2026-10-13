"""Real HTTP checks: policy CAS, role/space isolation and legacy compatibility."""
import json
import sqlite3
from pathlib import Path

from .control import ControlStore
from . import test_server as harness

KEY = harness.KEY


class ControlTest(harness.AccountsTest):
    # Reuse the HTTP harness, not the inherited test methods: legacy suite is run
    # separately. This suite runs it too with opt-in control enabled.
    def setUp(self):
        super().setUp()
        self.control_path = Path(self.tmp.name) / "control.sqlite3"
        self.server.control = ControlStore(self.control_path, self.server.store, "preview")

    def admin(self):
        admin = self.register("operator")
        self.server.control.grant_role("operator", "owner")
        return admin

    def workspace(self, account, edition="personal"):
        # Prepare owned fixture data through the administrative API.
        username = account["user"]["username"]
        with self.server.control.connect() as db:
            row = db.execute("SELECT role FROM roles WHERE user_id=?", (account["user"]["id"],)).fetchone()
        role = row["role"] if row else "member"
        self.server.control.grant_role(username, "owner")
        code, result = self.request("POST", "/v2/workspaces", {"edition": edition, "name": "合成空间"}, account["token"])
        self.server.control.grant_role(username, role)
        self.assertEqual(code, 201, result)
        return next(w for w in result["workspaces"] if w["edition"] == edition)

    def publish(self, admin, subject, rules, revision=0, edition="personal", scope="user"):
        return self.request("POST", "/v2/admin/module-policies", {"scope": scope, "subject": subject,
                            "edition": edition, "expectedRevision": revision, "rules": rules}, admin["token"])

    def test_personal_server_has_no_hosted_ai_or_other_edition(self):
        admin = self.admin()
        code, _ = self.request("POST", "/v2/workspaces", {"edition": "commercial-beads", "name": "unsupported"}, admin["token"])
        self.assertEqual(code, 400)
        self.assertEqual(self.request("GET", "/v2/ai/status", token=admin["token"])[0], 404)
        self.assertEqual(self.request("POST", "/v2/ai/bead/analyze", {"imageDataUrl": "unused"}, admin["token"])[0], 404)
        self.assertEqual(self.server.control.list_workspaces(admin["token"])["workspaces"], [])

    def test_role_is_explicit_and_never_implies_foreign_membership(self):
        admin, alice = self.admin(), self.register()
        a = self.workspace(alice)
        for action in ("vault", "capabilities"):
            self.assertEqual(self.request("GET", f"/v2/workspaces/{a['id']}/{action}", token=admin["token"])[0], 404)
        self.assertEqual(self.request("GET", "/v2/admin/overview", token=alice["token"])[0], 403)
        self.assertEqual(self.request("POST", "/v2/workspaces", {"edition": "personal", "name": "attempt"}, alice["token"])[0], 403)
        self.server.control.grant_role("operator", "member")
        self.assertEqual(self.request("GET", "/v2/admin/overview", token=admin["token"])[0], 403)

    def test_workspaces_and_legacy_have_separate_vaults(self):
        admin = self.admin()
        personal = self.workspace(admin, "personal")
        legacy = self.vault(admin)
        self.assertNotEqual(personal["vaultId"], legacy["vaultId"])
        p = f"/v2/workspaces/{personal['id']}/vault"
        code, saved = self.request("PUT", p, {"protocol": 1, "vaultId": personal["vaultId"], "expectedRevision": 0,
                                    "records": {KEY: {"title": "personal-only"}}}, admin["token"])
        self.assertEqual(code, 200)
        self.assertEqual(self.vault(admin)["records"], {})
        self.assertEqual(self.workspace(admin, "personal"), personal)

    def test_policy_denies_legacy_mutation_but_keeps_owner_export(self):
        admin, alice = self.admin(), self.register()
        vault = self.vault(alice)
        code, saved = self.put(alice, vault, {KEY: {"title": "keep-me"}})
        self.assertEqual(code, 200)
        self.assertEqual(self.publish(admin, alice["user"]["id"], {"tasks": {"write": False, "visible": False}})[0], 200)
        self.assertEqual(self.put(alice, saved, {KEY: {"title": "blocked"}})[0], 403)
        self.assertEqual(self.vault(alice), saved)
        self.assertEqual(self.put(alice, saved, saved["records"])[0], 200)

    def test_dependency_denial_cohort_and_user_cannot_expand_edition(self):
        admin, alice = self.admin(), self.register()
        uid = alice["user"]["id"]
        self.assertEqual(self.request("POST", "/v2/admin/cohorts", {"userId": uid, "cohortId": "beta", "member": True}, admin["token"])[0], 200)
        self.assertEqual(self.publish(admin, "beta", {"tasks": {"write": False}}, scope="cohort")[0], 200)
        self.assertEqual(self.publish(admin, uid, {"tasks": {"write": True}})[0], 200)
        caps = self.request("GET", "/v2/capabilities", token=alice["token"])[1]
        self.assertFalse(caps["modules"]["tasks"]["write"])
        self.assertFalse(caps["modules"]["goals"]["write"])
        space = self.workspace(alice)
        self.assertEqual(self.publish(admin, uid, {"tasks": {"write": True}}, revision=1, edition="personal")[0], 200)
        caps = self.request("GET", f"/v2/workspaces/{space['id']}/capabilities", token=alice["token"])[1]
        self.assertFalse(caps["modules"]["tasks"]["write"])
        self.assertTrue(caps["modules"]["bead-studio"]["write"])

    def test_bead_records_use_workspace_and_bead_permissions_only(self):
        admin, alice = self.admin(), self.register()
        space = self.workspace(alice)
        route = f"/v2/workspaces/{space['id']}/vault"
        key = "tideplan.bead-works.v1"
        records = {key: {"version": 1, "works": [], "activeId": ""}}
        body = {"protocol": 1, "vaultId": space["vaultId"], "expectedRevision": 0, "records": records}
        code, saved = self.request("PUT", route, body, alice["token"])
        self.assertEqual(code, 200)
        self.assertEqual(saved["records"], records)
        # Existing v2 and v1 clients never receive unsupported work record keys.
        self.assertEqual(self.put(alice, self.vault(alice), records)[0], 400)
        self.assertEqual(self.vault(alice)["records"], {})
        self.assertEqual(self.publish(admin, alice["user"]["id"], {"bead-studio": {"write": False}}, edition="personal")[0], 200)
        body["expectedRevision"] = saved["revision"]
        body["records"] = {key: None}
        self.assertEqual(self.request("PUT", route, body, alice["token"])[0], 403)
        self.assertEqual(self.request("GET", route, token=alice["token"])[1]["records"], records)
        body["records"] = records
        self.assertEqual(self.request("PUT", route, body, alice["token"])[0], 200)

    def test_policy_revision_and_restore_are_auditable(self):
        admin, alice = self.admin(), self.register()
        uid = alice["user"]["id"]
        rule = {"bead-studio": {"ai": False}}
        self.assertEqual(self.publish(admin, uid, rule, edition="personal")[0], 200)
        self.assertEqual(self.publish(admin, uid, {}, edition="personal")[0], 409)
        self.assertEqual(self.publish(admin, uid, {}, 1, edition="personal")[1]["revision"], 2)
        code, restored = self.request("POST", "/v2/admin/module-policies/restore", {"scope": "user", "subject": uid,
                                        "edition": "personal", "expectedRevision": 2, "restoreRevision": 1}, admin["token"])
        self.assertEqual(code, 200)
        self.assertEqual(restored["revision"], 3)
        self.assertEqual(restored["rules"], rule)
        overview = self.request("GET", "/v2/admin/overview", token=admin["token"])[1]
        self.assertTrue(any(a["event"] == "policy:restore" for a in overview["audit"]))
        self.assertIsNone(overview["metrics"]["aiCost"])
        self.assertNotIn("password", json.dumps(overview))
        self.assertNotIn("records", overview)

    def test_revoked_and_cross_service_sessions_cannot_access_control(self):
        alice = self.register()
        space = self.workspace(alice)
        self.request("DELETE", "/v2/sessions/" + alice["session"]["id"], token=alice["token"])
        self.assertEqual(self.request("GET", f"/v2/workspaces/{space['id']}/vault", token=alice["token"])[0], 401)
        self.assertEqual(self.request("GET", "/v2/capabilities", token="a" * 43)[0], 401)

    def test_control_schema_source_and_paths_cannot_be_rebound(self):
        with self.assertRaisesRegex(ValueError, "environment mismatch"):
            ControlStore(self.control_path, self.server.store, "live")
        with self.assertRaises(ValueError):
            ControlStore(self.path, self.server.store, "preview")
        with sqlite3.connect(self.control_path) as db:
            db.execute("PRAGMA user_version=99")
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            ControlStore(self.control_path, self.server.store, "preview")

    def test_invalid_and_unauthenticated_policy_requests_fail_closed(self):
        admin, alice = self.admin(), self.register()
        uid = alice["user"]["id"]
        for rules in ({"unknown": {"write": True}}, {"tasks": {"write": 1}},
                      {"tasks": {"read": False, "write": True}},
                      {"tasks": {"write": False}, "goals": {"write": True}}):
            self.assertEqual(self.publish(admin, uid, rules)[0], 400)
        self.assertEqual(self.publish(alice, uid, {})[0], 403)
        self.assertEqual(self.request("GET", "/v2/capabilities")[0], 401)
        self.assertEqual(self.request("GET", "/v2/workspaces/constructor/vault", token=alice["token"])[0], 400)
        self.assertEqual(self.request("GET", "/v2/workspaces?owner=other", token=alice["token"])[0], 404)

    def test_deleting_account_invalidates_new_apis(self):
        alice = self.register()
        self.workspace(alice)
        self.assertEqual(self.request("DELETE", "/v2/account", {"password": harness.PASSWORD, "confirmation": "DELETE"}, alice["token"])[0], 200)
        self.assertEqual(self.request("GET", "/v2/workspaces", token=alice["token"])[0], 401)
        with self.server.control.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0], 0)

    def test_owner_invitation_binds_registration_and_never_restores_revoked_role(self):
        from .bootstrap import manifest_path
        setup = self.server.control.prepare_owner_invite("gellar")
        path = manifest_path(self.server.control)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(setup["invite"], path.read_text())
        body = {"username": "other", "password": harness.PASSWORD, "invite": setup["invite"],
                "deviceName": "Synthetic", "platform": "test"}
        self.assertEqual(self.request("POST", "/v2/register", body)[0], 400)
        body["username"], body["invite"] = "gellar", self.server.store.create_invite()
        self.assertEqual(self.request("POST", "/v2/register", body)[0], 400)
        account = self.register("gellar", setup["invite"])
        self.assertEqual(self.request("GET", "/v2/admin/overview", token=account["token"])[1]["role"], "owner")
        # Restart after account creation or first claim is safe and idempotent.
        self.server.control = ControlStore(self.control_path, self.server.store, "preview")
        self.assertEqual(self.server.control.capabilities(account["token"])["role"], "owner")
        self.server.control.grant_role("gellar", "member")
        self.assertEqual(self.request("GET", "/v2/admin/overview", token=account["token"])[0], 403)
        with self.server.control.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit WHERE event='owner:bootstrap'").fetchone()[0], 1)
        self.assertEqual(self.login("gellar")[0], 200)
        with self.assertRaisesRegex(ValueError, "already configured"):
            self.server.control.prepare_owner_invite("another")

    def test_owner_bootstrap_rejects_existing_identity_expiry_and_foreign_source(self):
        from .bootstrap import manifest_path
        alice = self.register()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.server.control.prepare_owner_invite("alice")
        setup = self.server.control.prepare_owner_invite("gellar", 1)
        self.now += 3601
        body = {"username": "gellar", "password": harness.PASSWORD, "invite": setup["invite"],
                "deviceName": "Synthetic", "platform": "test"}
        self.assertEqual(self.request("POST", "/v2/register", body)[0], 400)
        path = manifest_path(self.server.control)
        value = json.loads(path.read_text())
        value["environment"] = "live"
        path.write_text(json.dumps(value))
        self.assertEqual(self.request("GET", "/v2/capabilities", token=alice["token"])[0], 400)
        self.assertEqual(self.server.store.me(alice["token"])["user"]["id"], alice["user"]["id"])
