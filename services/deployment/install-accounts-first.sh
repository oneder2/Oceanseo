#!/bin/sh
# Add v2 only; never reuse or migrate the private v1 database.
set -eu
if [ "$(id -u)" != 0 ] || [ "$#" != 1 ]; then
    printf 'Usage: sudo sh install-accounts-first.sh EXPECTED_CADDY_SHA256\n' >&2
    exit 1
fi
deployment_source=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
expected_caddy_sha=$1
case "$expected_caddy_sha" in *[!a-f0-9]*|'') exit 1;; esac
[ "${#expected_caddy_sha}" = 64 ]
actual_caddy_sha=$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)
if [ "$actual_caddy_sha" != "$expected_caddy_sha" ]; then
    printf 'Caddy changed since preflight; refusing replacement\n' >&2
    exit 1
fi
for existing_path in /opt/oceanseo-accounts /var/lib/oceanseo-accounts /var/backups/oceanseo-accounts /etc/oceanseo-accounts.env /etc/systemd/system/oceanseo-accounts.service /etc/systemd/system/oceanseo-accounts-backup.service /etc/systemd/system/oceanseo-accounts-backup.timer; do
    if [ -e "$existing_path" ] || [ -L "$existing_path" ]; then
        printf 'Existing account deployment at %s; refusing first-install overwrite\n' "$existing_path" >&2
        exit 1
    fi
done
if getent passwd oceanseo-accounts >/dev/null || getent group oceanseo-accounts >/dev/null; then
    printf 'Account service identity already exists; inspect before installing\n' >&2
    exit 1
fi
systemctl is-active --quiet tideplan-sync.service
systemctl is-active --quiet tideplan-monitor.service
systemctl is-active --quiet caddy.service
python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",4791)); s.close()'
caddy validate --config "$deployment_source/deployment/Caddyfile" --adapter caddyfile
caddy_snapshot="/etc/caddy/Caddyfile.before-accounts-$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$caddy_snapshot" ]
install -m 600 /etc/caddy/Caddyfile "$caddy_snapshot"
units_installed=false
caddy_installed=false
rollback() {
    if [ "$caddy_installed" = true ]; then
        install -o root -g caddy -m 640 "$caddy_snapshot" /etc/caddy/Caddyfile
        systemctl reload caddy.service || true
    fi
    if [ "$units_installed" = true ]; then
        systemctl disable --now oceanseo-accounts-backup.timer oceanseo-accounts.service || true
    fi
    printf 'Install failed; new private directories preserved for inspection\n' >&2
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
useradd --system --user-group --home-dir /var/lib/oceanseo-accounts --shell /usr/sbin/nologin oceanseo-accounts
install -d -m 755 /opt/oceanseo-accounts/services/accounts /opt/oceanseo-accounts/services/sync /opt/oceanseo-accounts/services/deployment
install -d -o oceanseo-accounts -g oceanseo-accounts -m 700 /var/lib/oceanseo-accounts /var/backups/oceanseo-accounts
for module in __init__.py security.py store.py server.py admin.py; do
    install -m 644 "$deployment_source/accounts/$module" "/opt/oceanseo-accounts/services/accounts/$module"
done
for module in server.py backup.py; do
    install -m 644 "$deployment_source/sync/$module" "/opt/oceanseo-accounts/services/sync/$module"
done
install -m 755 "$deployment_source/deployment/accounts-backup-daily.sh" /opt/oceanseo-accounts/services/deployment/accounts-backup-daily.sh
install -m 644 "$deployment_source/deployment/verify-accounts.py" /opt/oceanseo-accounts/services/deployment/verify-accounts.py
install -o root -g root -m 600 "$deployment_source/accounts/accounts.env.example" /etc/oceanseo-accounts.env
install -m 644 "$deployment_source/accounts/oceanseo-accounts.service" /etc/systemd/system/oceanseo-accounts.service
install -m 644 "$deployment_source/deployment/oceanseo-accounts-backup.service" /etc/systemd/system/oceanseo-accounts-backup.service
install -m 644 "$deployment_source/deployment/oceanseo-accounts-backup.timer" /etc/systemd/system/oceanseo-accounts-backup.timer
units_installed=true
systemctl daemon-reload
systemctl enable --now oceanseo-accounts.service
systemctl is-active --quiet oceanseo-accounts.service
python3 -c 'import time, urllib.request, urllib.error
for attempt in range(20):
    try: urllib.request.urlopen("http://127.0.0.1:4791/v2/me",timeout=2)
    except urllib.error.HTTPError as e:
        if e.code==401: break
    except urllib.error.URLError: pass
    time.sleep(0.5)
else: raise SystemExit("Account loopback health check failed")'
install -o root -g caddy -m 640 "$deployment_source/deployment/Caddyfile" /etc/caddy/Caddyfile
caddy_installed=true
systemctl reload caddy.service
systemctl enable --now oceanseo-accounts-backup.timer
systemctl start oceanseo-accounts-backup.service
systemctl is-active oceanseo-accounts.service tideplan-sync.service tideplan-monitor.service caddy.service
trap - EXIT HUP INT TERM
printf 'Independent v2 installed; run HTTPS/isolation/restart/backup verification before inviting users\n'
