"""Send a redacted backup-audit failure notification to an HTTPS webhook.

The hook is opt-in. It intentionally sends no database names, paths, tokens,
exception text, or backup contents. Without a configured webhook it is a no-op.
"""
import datetime
import json
import os
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")


def validate_webhook(value):
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc or parts.username or parts.password:
        raise ValueError("OCEANSEO_ALERT_WEBHOOK_URL must be an HTTPS URL")
    if parts.fragment:
        raise ValueError("OCEANSEO_ALERT_WEBHOOK_URL must not contain a fragment")
    return value


def payload(component, now=None):
    if not SAFE_COMPONENT.fullmatch(component):
        raise ValueError("invalid alert component")
    timestamp = (now or datetime.datetime.now(datetime.timezone.utc)).isoformat()
    return {
        "event": "backup_audit_failed",
        "source": "oceanseo",
        "component": component,
        "occurredAt": timestamp,
    }


def send_alert(webhook, component, opener=urlopen, now=None):
    body = json.dumps(payload(component, now), separators=(",", ":")).encode("utf-8")
    request = Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "oceanseo-backup-alert/1"},
        method="POST",
    )
    with opener(request, timeout=10) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"webhook returned HTTP {response.status}")


def main(argv):
    if len(argv) != 2:
        print("usage: backup-alert.py COMPONENT", file=sys.stderr)
        return 2
    component = argv[1]
    webhook = os.environ.get("OCEANSEO_ALERT_WEBHOOK_URL", "").strip()
    if not webhook:
        print("Oceanseo backup alert disabled: no webhook configured")
        return 0
    try:
        send_alert(validate_webhook(webhook), component)
    except (OSError, ValueError, RuntimeError):
        print("Oceanseo backup alert delivery failed", file=sys.stderr)
        return 1
    print("Oceanseo backup alert delivered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
