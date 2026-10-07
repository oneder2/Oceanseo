import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

from .server import create_server

spec = importlib.util.spec_from_file_location("verify_accounts", Path(__file__).parents[1] / "deployment" / "verify-accounts.py")
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)


class DeploymentTest(unittest.TestCase):
    def test_http_restart_restore_and_scoped_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "accounts.sqlite3"
            server = create_server(("127.0.0.1", 0), database)
            port = server.server_port
            existing = server.store.register("existing-user", "Synthetic-existing-123!",
                                             server.store.create_invite(), "Existing device", "test")
            args = SimpleNamespace(endpoint=f"http://127.0.0.1:{port}", database=database,
                                   state=root / "state.json", phase="exercise", allow_local=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    verification.run(args)
            finally:
                server.shutdown(); server.server_close(); thread.join()
            server = create_server(("127.0.0.1", port), database)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                args.phase = "resume"
                with contextlib.redirect_stdout(io.StringIO()):
                    verification.run(args)
                self.assertEqual(server.store.me(existing["token"])["user"], existing["user"])
                self.assertEqual(server.store.get_vault(existing["token"])["records"], {})
                with server.store.connect() as db:
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM users WHERE disabled=1").fetchone()[0], 2)
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)
                self.assertEqual(args.state.stat().st_mode & 0o777, 0o600)
                self.assertEqual((root / "restored.sqlite3").stat().st_mode & 0o777, 0o600)
            finally:
                server.shutdown(); server.server_close(); thread.join()

    def test_plain_http_and_missing_database_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = SimpleNamespace(endpoint="http://example.com", database=root / "missing.sqlite3",
                                   state=root / "state.json", phase="exercise", allow_local=False)
            with self.assertRaisesRegex(RuntimeError, "endpoint"):
                verification.run(args)
            args.endpoint = "https://example.com"
            with self.assertRaisesRegex(RuntimeError, "existing account database"):
                verification.run(args)
            self.assertEqual(list(root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
