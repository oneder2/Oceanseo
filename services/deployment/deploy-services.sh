#!/usr/bin/env bash
# Roll out service health endpoints and Caddy routes without touching databases or env files.
set -euo pipefail
cd "$(dirname "$0")/../.."

remote_stage=$(ssh Oceanseo 'mktemp -d /tmp/oceanseo-services.XXXXXXXX')
[[ "$remote_stage" =~ ^/tmp/oceanseo-services\.[A-Za-z0-9]{8}$ ]]
cleanup() { ssh Oceanseo "rm -rf -- '$remote_stage'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

tar -czf - \
  services/accounts/store.py \
  services/accounts/server.py \
  services/sync/server.py \
  services/deployment/backup-audit.py \
  services/deployment/tideplan-backup-audit.service \
  services/deployment/tideplan-backup-audit.timer \
  services/deployment/oceanseo-accounts-backup-audit.service \
  services/deployment/oceanseo-accounts-backup-audit.timer \
  services/deployment/Caddyfile \
  | ssh Oceanseo "tar -xzf - -C '$remote_stage'"

ssh Oceanseo "bash -s -- '$remote_stage'" <<'REMOTE'
set -euo pipefail
stage="$1"
[[ "$stage" =~ ^/tmp/oceanseo-services\.[A-Za-z0-9]{8}$ ]]
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/oceanseo-services-$stamp"
sudo install -d -m 700 "$backup/accounts" "$backup/sync"
sudo cp -a /opt/oceanseo-accounts/services/accounts/store.py "$backup/accounts/store.py"
sudo cp -a /opt/oceanseo-accounts/services/accounts/server.py "$backup/accounts/server.py"
sudo cp -a /opt/tideplan-sync/server.py "$backup/sync/server.py"
if sudo test -e /opt/tideplan-sync/backup-audit.py; then sudo cp -a /opt/tideplan-sync/backup-audit.py "$backup/sync/backup-audit.py"; fi
if sudo test -e /etc/systemd/system/tideplan-backup-audit.service; then sudo cp -a /etc/systemd/system/tideplan-backup-audit.service "$backup/tideplan-backup-audit.service"; fi
if sudo test -e /etc/systemd/system/tideplan-backup-audit.timer; then sudo cp -a /etc/systemd/system/tideplan-backup-audit.timer "$backup/tideplan-backup-audit.timer"; fi
if sudo test -e /opt/oceanseo-accounts/services/deployment/backup-audit.py; then sudo cp -a /opt/oceanseo-accounts/services/deployment/backup-audit.py "$backup/accounts/backup-audit.py"; fi
if sudo test -e /etc/systemd/system/oceanseo-accounts-backup-audit.service; then sudo cp -a /etc/systemd/system/oceanseo-accounts-backup-audit.service "$backup/oceanseo-accounts-backup-audit.service"; fi
if sudo test -e /etc/systemd/system/oceanseo-accounts-backup-audit.timer; then sudo cp -a /etc/systemd/system/oceanseo-accounts-backup-audit.timer "$backup/oceanseo-accounts-backup-audit.timer"; fi
sudo cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"

rollback_needed=true
rollback() {
  set +e
  if ! sudo test -e "$backup/tideplan-backup-audit.timer"; then sudo systemctl disable --now tideplan-backup-audit.timer; fi
  if ! sudo test -e "$backup/oceanseo-accounts-backup-audit.timer"; then sudo systemctl disable --now oceanseo-accounts-backup-audit.timer; fi
  sudo install -m 644 "$backup/accounts/store.py" /opt/oceanseo-accounts/services/accounts/store.py
  sudo install -m 644 "$backup/accounts/server.py" /opt/oceanseo-accounts/services/accounts/server.py
  sudo install -m 644 "$backup/sync/server.py" /opt/tideplan-sync/server.py
  if sudo test -e "$backup/sync/backup-audit.py"; then sudo install -m 755 "$backup/sync/backup-audit.py" /opt/tideplan-sync/backup-audit.py; else sudo rm -f /opt/tideplan-sync/backup-audit.py; fi
  if sudo test -e "$backup/tideplan-backup-audit.service"; then sudo install -m 644 "$backup/tideplan-backup-audit.service" /etc/systemd/system/tideplan-backup-audit.service; else sudo rm -f /etc/systemd/system/tideplan-backup-audit.service; fi
  if sudo test -e "$backup/tideplan-backup-audit.timer"; then sudo install -m 644 "$backup/tideplan-backup-audit.timer" /etc/systemd/system/tideplan-backup-audit.timer; else sudo rm -f /etc/systemd/system/tideplan-backup-audit.timer; fi
  if sudo test -e "$backup/accounts/backup-audit.py"; then sudo install -m 755 "$backup/accounts/backup-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py; else sudo rm -f /opt/oceanseo-accounts/services/deployment/backup-audit.py; fi
  if sudo test -e "$backup/oceanseo-accounts-backup-audit.service"; then sudo install -m 644 "$backup/oceanseo-accounts-backup-audit.service" /etc/systemd/system/oceanseo-accounts-backup-audit.service; else sudo rm -f /etc/systemd/system/oceanseo-accounts-backup-audit.service; fi
  if sudo test -e "$backup/oceanseo-accounts-backup-audit.timer"; then sudo install -m 644 "$backup/oceanseo-accounts-backup-audit.timer" /etc/systemd/system/oceanseo-accounts-backup-audit.timer; else sudo rm -f /etc/systemd/system/oceanseo-accounts-backup-audit.timer; fi
  sudo install -o root -g caddy -m 640 "$backup/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl daemon-reload
  sudo systemctl restart oceanseo-accounts tideplan-sync
  sudo systemctl reload caddy
}
cleanup() {
  if [ "$rollback_needed" = true ]; then
    rollback
  fi
}
trap cleanup EXIT

sudo install -m 644 "$stage/services/accounts/store.py" /opt/oceanseo-accounts/services/accounts/store.py
sudo install -m 644 "$stage/services/accounts/server.py" /opt/oceanseo-accounts/services/accounts/server.py
sudo install -m 644 "$stage/services/sync/server.py" /opt/tideplan-sync/server.py
sudo install -m 755 "$stage/services/deployment/backup-audit.py" /opt/tideplan-sync/backup-audit.py
sudo install -m 644 "$stage/services/deployment/tideplan-backup-audit.service" /etc/systemd/system/tideplan-backup-audit.service
sudo install -m 644 "$stage/services/deployment/tideplan-backup-audit.timer" /etc/systemd/system/tideplan-backup-audit.timer
sudo install -m 755 "$stage/services/deployment/backup-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py
sudo install -m 644 "$stage/services/deployment/oceanseo-accounts-backup-audit.service" /etc/systemd/system/oceanseo-accounts-backup-audit.service
sudo install -m 644 "$stage/services/deployment/oceanseo-accounts-backup-audit.timer" /etc/systemd/system/oceanseo-accounts-backup-audit.timer
sudo install -o root -g caddy -m 640 "$stage/services/deployment/Caddyfile" /etc/caddy/Caddyfile
if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  exit 1
fi
sudo systemctl restart oceanseo-accounts tideplan-sync
sudo systemctl daemon-reload
sudo systemctl enable --now tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer
sudo systemctl start tideplan-backup-audit.service oceanseo-accounts-backup-audit.service
wait_for() {
  for _ in $(seq 1 20); do
    if "$@" >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
wait_for curl --fail --silent --show-error --max-time 2 http://127.0.0.1:4791/v2/health
wait_for curl --fail --silent --show-error --max-time 2 http://127.0.0.1:4789/health
sudo systemctl reload caddy
sudo systemctl is-active oceanseo-accounts tideplan-sync tideplan-monitor caddy
if ! wait_for curl --fail --silent --show-error --max-time 2 --resolve oceanseo.gellaronline.cc:443:127.0.0.1 https://oceanseo.gellaronline.cc/health/accounts; then
  exit 1
fi
curl --fail --silent --show-error --resolve oceanseo.gellaronline.cc:443:127.0.0.1 https://oceanseo.gellaronline.cc/health/accounts
printf '\n'
if ! wait_for curl --fail --silent --show-error --max-time 2 --resolve oceanseo.gellaronline.cc:443:127.0.0.1 https://oceanseo.gellaronline.cc/health/sync; then
  exit 1
fi
curl --fail --silent --show-error --resolve oceanseo.gellaronline.cc:443:127.0.0.1 https://oceanseo.gellaronline.cc/health/sync
printf '\n'
rollback_needed=false
printf 'Service health rollout complete; rollback is available at %s\n' "$backup"
REMOTE
