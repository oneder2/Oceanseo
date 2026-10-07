import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "services/deployment/backup-audit.py"


class BackupAuditTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.database = self.root / "live.sqlite3"
        self.backups = self.root / "backups"
        self.backups.mkdir(mode=0o700)
        with sqlite3.connect(self.database) as connection:
            connection.execute("CREATE TABLE vault (id INTEGER PRIMARY KEY)")
            connection.commit()
        backup = self.backups / "vault-test.sqlite3"
        with sqlite3.connect(backup) as connection:
            connection.execute("CREATE TABLE vault (id INTEGER PRIMARY KEY)")
            connection.commit()
        os.chmod(self.database, 0o600)
        os.chmod(backup, 0o600)
        self.backup = backup

    def tearDown(self):
        self.tempdir.cleanup()

    def run_audit(self, *extra):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--label",
                "test",
                "--database",
                str(self.database),
                "--backup-dir",
                str(self.backups),
                "--required-table",
                "vault",
                *extra,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        return result, json.loads(result.stdout)

    def test_accepts_private_recent_integrity_checked_backup(self):
        result, report = self.run_audit()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["integrity"], "ok")

    def test_rejects_insecure_backup_mode(self):
        os.chmod(self.backup, 0o640)
        result, report = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report["status"], "error")
        self.assertIn("private", report["error"])

    def test_rejects_missing_schema(self):
        result, report = self.run_audit("--required-table", "users")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("schema", report["error"])

    def test_rejects_stale_backup(self):
        old = self.backup.stat().st_atime
        os.utime(self.backup, (old, old - 7200))
        result, report = self.run_audit("--max-age-hours", "1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("old", report["error"])


if __name__ == "__main__":
    unittest.main()
