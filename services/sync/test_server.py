import concurrent.futures
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from server import create_server, VaultStore

TOKEN = "tideplan-local-test-token-not-for-production-123456"
KEY = "task:00000000-0000-4000-8000-000000000001"


class SyncServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "vault.sqlite3"
        self.server = create_server(("127.0.0.1", 0), self.db, TOKEN)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method="GET", value=None, token=TOKEN, raw=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        body = raw if raw is not None else json.dumps(value) if value is not None else None
        conn.request(method, "/v1/vault", body, {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        response = conn.getresponse()
        data = json.loads(response.read())
        status = response.status
        conn.close()
        return status, data

    def put(self, old, records):
        return self.request("PUT", dict(protocol=1, vaultId=old["vaultId"], expectedRevision=old["revision"], records=records))

    def test_auth_and_no_accidental_reset(self):
        self.assertEqual(self.request(token="wrong")[0], 401)
        _, old = self.request()
        code, saved = self.put(old, {KEY: {"title": "private"}})
        self.assertEqual(code, 200)
        self.assertEqual(self.put(saved, {})[0], 400)
        self.assertEqual(VaultStore(self.db).get(), saved)

    def test_stale_device_and_retry(self):
        _, old = self.request()
        _, saved = self.put(old, {KEY: {"title": "手机"}})
        self.assertEqual(self.put(old, {KEY: {"title": "旧电脑"}})[0], 409)
        self.assertEqual(self.put(saved, saved["records"]), (200, saved))

    def test_simultaneous_writers_only_one_wins(self):
        _, old = self.request()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            statuses = list(pool.map(lambda title: self.put(old, {KEY: {"title": title}})[0], ["A", "B"]))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_tombstones_survive_restart(self):
        _, old = self.request()
        _, saved = self.put(old, {KEY: {"title": "事项"}})
        _, deleted = self.put(saved, {KEY: None})
        self.assertIsNone(VaultStore(self.db).get()["records"][KEY])
        self.assertEqual(self.put(deleted, {})[0], 400)

    def test_reject_unknown_duplicate_and_nonfinite_payload(self):
        _, old = self.request()
        self.assertEqual(self.put(old, {"api_key": {}})[0], 400)
        self.assertEqual(self.request("PUT", raw='{"protocol":1,"protocol":1}')[0], 400)
        self.assertEqual(self.request("PUT", raw='{"value":NaN}')[0], 400)


if __name__ == "__main__":
    unittest.main()
