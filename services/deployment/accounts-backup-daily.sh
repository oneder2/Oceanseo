#!/bin/sh
set -eu
backup_name="$(date -u +accounts-%Y%m%dT%H%M%SZ.sqlite3)"
exec /usr/bin/python3 /opt/oceanseo-accounts/services/sync/backup.py \
    /var/lib/oceanseo-accounts/accounts.sqlite3 \
    "/var/backups/oceanseo-accounts/$backup_name"
