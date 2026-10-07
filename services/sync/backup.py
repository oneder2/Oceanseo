"""Online SQLite backup. Use an explicit destination outside the live data dir."""
import argparse
import os
import sqlite3
from pathlib import Path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if not args.source.is_file() or args.destination.exists():
        parser.error("Source must exist; destination must be a new file")
    os.umask(0o077)
    with sqlite3.connect(args.source.resolve().as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(args.destination) as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Backup integrity check failed")
    print("Backup complete. Copy it to independent private storage.")
