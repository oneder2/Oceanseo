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

    def test_writes_private_status_marker(self):
        marker = self.root / "status.json"
        result, report = self.run_audit("--status-file", str(marker))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(json.loads(marker.read_text()), {"status": "ok"})
        self.assertEqual(stat.S_IMODE(marker.stat().st_mode), 0o600)

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

    def test_audits_wal_snapshot_without_creating_sidecars(self):
        with sqlite3.connect(self.backup) as connection:
            self.assertEqual(connection.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            connection.execute("INSERT INTO vault VALUES (1)")
            connection.commit()
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.close()
        self.assertEqual(self.backup.read_bytes()[18:20], b"\x02\x02")
        os.chmod(self.backups, 0o500)
        try:
            result, report = self.run_audit()
            self.assertEqual(result.returncode, 0, report)
            self.assertEqual(report["integrity"], "ok")
            for suffix in ("-wal", "-shm", "-journal"):
                self.assertFalse(Path(str(self.backup) + suffix).exists())
        finally:
            os.chmod(self.backups, 0o700)

    def test_rejects_snapshot_with_pending_wal_or_journal(self):
        for suffix in ("-wal", "-journal"):
            with self.subTest(suffix=suffix):
                sidecar = Path(str(self.backup) + suffix)
                sidecar.write_bytes(b"pending transaction")
                result, report = self.run_audit()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("standalone", report["error"])
                sidecar.unlink()

    def test_rejects_live_database_masquerading_as_backup(self):
        self.backup.unlink()
        os.link(self.database, self.backup)
        result, report = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("live database", report["error"])


if __name__ == "__main__":
    unittest.main()
