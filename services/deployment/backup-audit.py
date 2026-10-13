#!/usr/bin/env python3
"""Check that a private SQLite backup is recent, private, and readable.

This command deliberately reports metadata only. It never prints table rows,
database paths supplied by callers, or any application data.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit one SQLite backup set")
    parser.add_argument("--label", required=True)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--backup-dir", required=True, type=Path)
    parser.add_argument("--max-age-hours", type=float, default=30.0)
    parser.add_argument("--required-table", action="append", default=[])
    parser.add_argument("--status-file", type=Path)
    return parser.parse_args()


def private_mode(path: Path) -> bool:
    return stat.S_IMODE(path.stat().st_mode) & 0o077 == 0


def snapshot_uri(path: Path) -> str:
    # Online backups can retain WAL journal mode even though all committed
    # pages are in the standalone snapshot. Ordinary mode=ro can then try to
    # create WAL/SHM files, which correctly fails in our read-only sandbox.
    # immutable must never ignore pending transactions in an active database.
    for suffix in ("-wal", "-journal", "-shm"):
        sidecar = path.with_name(path.name + suffix)
        if sidecar.is_symlink() or (sidecar.exists() and (
            not sidecar.is_file() or (suffix != "-shm" and sidecar.stat().st_size > 0)
        )):
            fail("backup is not a standalone snapshot")
    return path.resolve().as_uri() + "?mode=ro&immutable=1"


def integrity_check(path: Path) -> str:
    uri = snapshot_uri(path)
    with sqlite3.connect(uri, uri=True) as connection:
        row = connection.execute("PRAGMA integrity_check").fetchone()
        return str(row[0]) if row else ""


def table_names(path: Path) -> set[str]:
    uri = snapshot_uri(path)
    with sqlite3.connect(uri, uri=True) as connection:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }


def fail(message: str) -> None:
    raise RuntimeError(message)


def write_status(path: Path | None, status: str) -> None:
    if path is None:
        return
    if not path.is_absolute():
        raise RuntimeError("status path must be absolute")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(json.dumps({"status": status}) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def audit(args: argparse.Namespace) -> dict[str, object]:
    database = args.database
    backup_dir = args.backup_dir
    if not database.is_absolute() or not backup_dir.is_absolute():
        fail("paths must be absolute")
    if args.max_age_hours <= 0:
        fail("max age must be positive")
    if not database.is_file() or database.is_symlink():
        fail("source database is unavailable")
    if not backup_dir.is_dir() or backup_dir.is_symlink():
        fail("backup directory is unavailable")
    if not private_mode(backup_dir):
        fail("backup directory is not private")

    candidates = sorted(
        (item for item in backup_dir.glob("*.sqlite3") if item.is_file() and not item.is_symlink()),
        key=lambda item: (item.stat().st_mtime_ns, item.name),
        reverse=True,
    )
    if not candidates:
        fail("no SQLite backup found")
    latest = candidates[0]
    if latest.samefile(database):
        fail("backup must not be the live database")
    if not private_mode(latest):
        fail("latest backup is not private")
    age_seconds = max(0.0, time.time() - latest.stat().st_mtime)
    max_age_seconds = args.max_age_hours * 3600
    if age_seconds > max_age_seconds:
        fail("latest backup is too old")
    integrity = integrity_check(latest)
    if integrity != "ok":
        fail("latest backup failed integrity check")
    tables = table_names(latest)
    missing = sorted(set(args.required_table) - tables)
    if missing:
        fail("latest backup is missing required schema")
    return {
        "status": "ok",
        "label": args.label,
        "backupCount": len(candidates),
        "latestAgeSeconds": round(age_seconds, 3),
        "integrity": integrity,
        "requiredTables": sorted(set(args.required_table)),
    }


def main() -> int:
    args = parse_args()
    try:
        result = audit(args)
    except (OSError, RuntimeError, sqlite3.DatabaseError) as error:
        try:
            write_status(args.status_file, "error")
        except (OSError, RuntimeError):
            pass
        print(json.dumps({"status": "error", "label": args.label, "error": str(error)}))
        return 1
    write_status(args.status_file, "ok")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
