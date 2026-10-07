import json
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


_SPEC = importlib.util.spec_from_file_location(
    "backup_alert", Path(__file__).with_name("backup-alert.py")
)
backup_alert = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(backup_alert)


class FakeResponse:
    def __init__(self, status=204):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class BackupAlertTests(unittest.TestCase):
    def test_payload_contains_only_redacted_failure_metadata(self):
        value = backup_alert.payload("accounts", backup_alert.datetime.datetime(2026, 1, 2, tzinfo=backup_alert.datetime.timezone.utc))
        self.assertEqual(value, {
            "event": "backup_audit_failed",
            "source": "oceanseo",
            "component": "accounts",
            "occurredAt": "2026-01-02T00:00:00+00:00",
        })

    def test_rejects_non_https_or_embedded_credentials(self):
        for value in ("http://alerts.example/hook", "https://user:pass@alerts.example/hook", "https://alerts.example/hook#secret"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                backup_alert.validate_webhook(value)

    def test_posts_json_without_sensitive_fields(self):
        requests = []

        def opener(request, timeout):
            requests.append((request, timeout))
            return FakeResponse()

        backup_alert.send_alert(
            "https://alerts.example/hook",
            "sync",
            opener=opener,
            now=backup_alert.datetime.datetime(2026, 1, 2, tzinfo=backup_alert.datetime.timezone.utc),
        )
        request, timeout = requests[0]
        self.assertEqual(timeout, 10)
        self.assertEqual(json.loads(request.data), {
            "event": "backup_audit_failed",
            "source": "oceanseo",
            "component": "sync",
            "occurredAt": "2026-01-02T00:00:00+00:00",
        })
        self.assertNotIn("token", request.data.decode())
        self.assertEqual(request.get_header("User-agent"), "oceanseo-backup-alert/1")

    def test_missing_webhook_is_a_no_op(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(backup_alert.main(["backup-alert.py", "sync"]), 0)


if __name__ == "__main__":
    unittest.main()
