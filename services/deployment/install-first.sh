#!/bin/sh
set -eu
if [ "$(id -u)" != 0 ]; then
    printf 'Run with administrator privileges\n' >&2
    exit 1
fi
deployment_source=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for existing_path in /opt/tideplan-sync /opt/tideplan-monitor /var/lib/tideplan-sync /etc/tideplan-sync.env /etc/tideplan-monitor.env; do
    if [ -e "$existing_path" ]; then
        printf 'Existing deployment found at %s; refusing first-install overwrite\n' "$existing_path" >&2
        exit 1
    fi
done
caddy validate --config "$deployment_source/deployment/Caddyfile" --adapter caddyfile
if ! getent passwd tideplan-sync >/dev/null; then
    useradd --system --user-group --home-dir /var/lib/tideplan-sync --shell /usr/sbin/nologin tideplan-sync
fi
install -d -m 755 /opt/tideplan-sync /opt/tideplan-monitor /opt/oceanseo-alert
install -d -o tideplan-sync -g tideplan-sync -m 700 /var/lib/tideplan-sync /var/backups/tideplan-sync
install -m 644 "$deployment_source/sync/server.py" /opt/tideplan-sync/server.py
install -m 644 "$deployment_source/sync/backup.py" /opt/tideplan-sync/backup.py
install -m 755 "$deployment_source/deployment/backup-daily.sh" /opt/tideplan-sync/backup-daily.sh
install -m 755 "$deployment_source/deployment/backup-audit.py" /opt/tideplan-sync/backup-audit.py
install -m 755 "$deployment_source/deployment/backup-alert.py" /opt/oceanseo-alert/backup-alert.py
install -m 644 "$deployment_source/host-monitor/collector.py" /opt/tideplan-monitor/collector.py
install -m 644 "$deployment_source/sync/tideplan-sync.service" /etc/systemd/system/tideplan-sync.service
install -m 644 "$deployment_source/host-monitor/tideplan-monitor.service" /etc/systemd/system/tideplan-monitor.service
install -m 644 "$deployment_source/deployment/tideplan-sync-backup.service" /etc/systemd/system/tideplan-sync-backup.service
install -m 644 "$deployment_source/deployment/tideplan-sync-backup.timer" /etc/systemd/system/tideplan-sync-backup.timer
install -m 644 "$deployment_source/deployment/tideplan-backup-audit.service" /etc/systemd/system/tideplan-backup-audit.service
install -m 644 "$deployment_source/deployment/tideplan-backup-audit.timer" /etc/systemd/system/tideplan-backup-audit.timer
install -m 644 "$deployment_source/deployment/oceanseo-backup-alert@.service" /etc/systemd/system/oceanseo-backup-alert@.service
python3 "$deployment_source/deployment/generate-credentials.py"
if [ -f /etc/caddy/Caddyfile ]; then
    caddy_snapshot="/etc/caddy/Caddyfile.before-oceanseo-$(date -u +%Y%m%dT%H%M%SZ)"
    install -m 600 /etc/caddy/Caddyfile "$caddy_snapshot"
fi
install -o root -g caddy -m 640 "$deployment_source/deployment/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now tideplan-sync.service tideplan-monitor.service
systemctl enable --now tideplan-sync-backup.timer
systemctl reload caddy.service
systemctl start tideplan-sync-backup.service
systemctl enable --now tideplan-backup-audit.timer
systemctl start tideplan-backup-audit.service
systemctl is-active tideplan-sync.service tideplan-monitor.service caddy.service
printf 'First install complete; verify HTTPS, authentication and backups before connecting clients\n'
