#!/bin/sh
set -eu
backup_name="$(date -u +vault-%Y%m%dT%H%M%SZ.sqlite3)"
exec /usr/bin/python3 /opt/tideplan-sync/backup.py \
    /var/lib/tideplan-sync/vault.sqlite3 \
    "/var/backups/tideplan-sync/$backup_name"
