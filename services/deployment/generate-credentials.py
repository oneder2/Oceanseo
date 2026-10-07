import os
import secrets
from pathlib import Path


def create_environment(path, values):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as environment:
        environment.write("".join(f"{name}={value}\n" for name, value in values.items()))
        environment.flush()
        os.fsync(environment.fileno())


if __name__ == "__main__":
    paths = [Path("/etc/tideplan-sync.env"), Path("/etc/tideplan-monitor.env")]
    if any(path.exists() for path in paths):
        raise SystemExit("Existing credentials found; refusing to replace them")
    os.umask(0o077)
    create_environment(paths[0], {
        "TIDEPLAN_SYNC_TOKEN": secrets.token_urlsafe(32),
        "TIDEPLAN_SYNC_HOST": "127.0.0.1",
        "TIDEPLAN_SYNC_PORT": "4789",
        "TIDEPLAN_SYNC_DB": "/var/lib/tideplan-sync/vault.sqlite3",
    })
    create_environment(paths[1], {
        "TIDEPLAN_MONITOR_TOKEN": secrets.token_urlsafe(32),
        "TIDEPLAN_MONITOR_PORT": "4790",
        "TIDEPLAN_MONITOR_DISK": "/",
    })
    print("Independent credentials created with mode 600; values not displayed")
