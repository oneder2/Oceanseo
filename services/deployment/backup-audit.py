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
    return parser.parse_args()


def private_mode(path: Path) -> bool:
    return stat.S_IMODE(path.stat().st_mode) & 0o077 == 0


def integrity_check(path: Path) -> str:
    uri = f"file:{path.resolve()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        row = connection.execute("PRAGMA integrity_check").fetchone()
        return str(row[0]) if row else ""


def table_names(path: Path) -> set[str]:
    uri = f"file:{path.resolve()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }


def fail(message: str) -> None:
    raise RuntimeError(message)


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
        print(json.dumps({"status": "error", "label": args.label, "error": str(error)}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
