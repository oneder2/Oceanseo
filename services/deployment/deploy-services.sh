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
  services/deployment/backup-alert.py \
  services/deployment/tideplan-backup-audit.service \
  services/deployment/tideplan-backup-audit.timer \
  services/deployment/oceanseo-accounts-backup-audit.service \
  services/deployment/oceanseo-accounts-backup-audit.timer \
  services/deployment/oceanseo-backup-alert@.service \
  services/deployment/Caddyfile \
  | ssh Oceanseo "tar -xzf - -C '$remote_stage'"

ssh Oceanseo "bash -s -- '$remote_stage'" <<'REMOTE'
set -euo pipefail
stage="$1"
[[ "$stage" =~ ^/tmp/oceanseo-services\.[A-Za-z0-9]{8}$ ]]
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/oceanseo-services-$stamp"
sudo install -d -m 700 "$backup/accounts" "$backup/sync"
sudo install -d -m 700 "$backup/alert"
sudo cp -a /opt/oceanseo-accounts/services/accounts/store.py "$backup/accounts/store.py"
sudo cp -a /opt/oceanseo-accounts/services/accounts/server.py "$backup/accounts/server.py"
sudo cp -a /opt/tideplan-sync/server.py "$backup/sync/server.py"
if sudo test -e /opt/tideplan-sync/backup-audit.py; then sudo cp -a /opt/tideplan-sync/backup-audit.py "$backup/sync/backup-audit.py"; fi
if sudo test -e /opt/oceanseo-alert/backup-alert.py; then sudo cp -a /opt/oceanseo-alert/backup-alert.py "$backup/alert/backup-alert.py"; fi
if sudo test -e /etc/systemd/system/oceanseo-backup-alert@.service; then sudo cp -a /etc/systemd/system/oceanseo-backup-alert@.service "$backup/alert/oceanseo-backup-alert@.service"; fi
if sudo test -e /etc/systemd/system/tideplan-backup-audit.service; then sudo cp -a /etc/systemd/system/tideplan-backup-audit.service "$backup/tideplan-backup-audit.service"; fi
if sudo test -e /etc/systemd/system/tideplan-backup-audit.timer; then sudo cp -a /etc/systemd/system/tideplan-backup-audit.timer "$backup/tideplan-backup-audit.timer"; fi
if sudo test -e /opt/oceanseo-accounts/services/deployment/backup-audit.py; then sudo cp -a /opt/oceanseo-accounts/services/deployment/backup-audit.py "$backup/accounts/backup-audit.py"; fi
if sudo test -e /etc/systemd/system/oceanseo-accounts-backup-audit.service; then sudo cp -a /etc/systemd/system/oceanseo-accounts-backup-audit.service "$backup/oceanseo-accounts-backup-audit.service"; fi
if sudo test -e /etc/systemd/system/oceanseo-accounts-backup-audit.timer; then sudo cp -a /etc/systemd/system/oceanseo-accounts-backup-audit.timer "$backup/oceanseo-accounts-backup-audit.timer"; fi
sudo cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"

rollback_needed=true
wait_for_port() {
  local host="$1"
  local port="$2"
  for _ in $(seq 1 40); do
    if timeout 2 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
rollback() {
  set +e
  sudo systemctl stop tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer || true
  if ! sudo test -e "$backup/tideplan-backup-audit.timer"; then sudo systemctl disable tideplan-backup-audit.timer; fi
  if ! sudo test -e "$backup/oceanseo-accounts-backup-audit.timer"; then sudo systemctl disable oceanseo-accounts-backup-audit.timer; fi
  sudo install -m 644 "$backup/accounts/store.py" /opt/oceanseo-accounts/services/accounts/store.py
  sudo install -m 644 "$backup/accounts/server.py" /opt/oceanseo-accounts/services/accounts/server.py
  sudo install -m 644 "$backup/sync/server.py" /opt/tideplan-sync/server.py
  if sudo test -e "$backup/sync/backup-audit.py"; then sudo install -m 755 "$backup/sync/backup-audit.py" /opt/tideplan-sync/backup-audit.py; else sudo rm -f /opt/tideplan-sync/backup-audit.py; fi
  if sudo test -e "$backup/alert/backup-alert.py"; then sudo install -m 755 "$backup/alert/backup-alert.py" /opt/oceanseo-alert/backup-alert.py; else sudo rm -f /opt/oceanseo-alert/backup-alert.py; fi
  if sudo test -e "$backup/alert/oceanseo-backup-alert@.service"; then sudo install -m 644 "$backup/alert/oceanseo-backup-alert@.service" /etc/systemd/system/oceanseo-backup-alert@.service; else sudo rm -f /etc/systemd/system/oceanseo-backup-alert@.service; fi
  if sudo test -e "$backup/tideplan-backup-audit.service"; then sudo install -m 644 "$backup/tideplan-backup-audit.service" /etc/systemd/system/tideplan-backup-audit.service; else sudo rm -f /etc/systemd/system/tideplan-backup-audit.service; fi
  if sudo test -e "$backup/tideplan-backup-audit.timer"; then sudo install -m 644 "$backup/tideplan-backup-audit.timer" /etc/systemd/system/tideplan-backup-audit.timer; else sudo rm -f /etc/systemd/system/tideplan-backup-audit.timer; fi
  if sudo test -e "$backup/accounts/backup-audit.py"; then sudo install -m 755 "$backup/accounts/backup-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py; else sudo rm -f /opt/oceanseo-accounts/services/deployment/backup-audit.py; fi
  if sudo test -e "$backup/oceanseo-accounts-backup-audit.service"; then sudo install -m 644 "$backup/oceanseo-accounts-backup-audit.service" /etc/systemd/system/oceanseo-accounts-backup-audit.service; else sudo rm -f /etc/systemd/system/oceanseo-accounts-backup-audit.service; fi
  if sudo test -e "$backup/oceanseo-accounts-backup-audit.timer"; then sudo install -m 644 "$backup/oceanseo-accounts-backup-audit.timer" /etc/systemd/system/oceanseo-accounts-backup-audit.timer; else sudo rm -f /etc/systemd/system/oceanseo-accounts-backup-audit.timer; fi
  sudo install -o root -g caddy -m 640 "$backup/Caddyfile" /etc/caddy/Caddyfile
  sudo systemctl daemon-reload
  sudo systemctl restart oceanseo-accounts tideplan-sync
  wait_for_port 127.0.0.1 4791
  wait_for_port 127.0.0.1 4789
  for unit in tideplan-backup-audit.service oceanseo-accounts-backup-audit.service; do
    sudo systemctl reset-failed "$unit"
    for _ in $(seq 1 10); do
      if sudo systemctl start "$unit"; then break; fi
      sleep 1
    done
  done
  sudo systemctl start tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer
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
sudo install -d -m 755 /opt/oceanseo-alert
sudo install -m 755 "$stage/services/deployment/backup-alert.py" /opt/oceanseo-alert/backup-alert.py
sudo install -m 644 "$stage/services/deployment/tideplan-backup-audit.service" /etc/systemd/system/tideplan-backup-audit.service
sudo install -m 644 "$stage/services/deployment/tideplan-backup-audit.timer" /etc/systemd/system/tideplan-backup-audit.timer
sudo install -m 755 "$stage/services/deployment/backup-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py
sudo install -m 644 "$stage/services/deployment/oceanseo-accounts-backup-audit.service" /etc/systemd/system/oceanseo-accounts-backup-audit.service
sudo install -m 644 "$stage/services/deployment/oceanseo-accounts-backup-audit.timer" /etc/systemd/system/oceanseo-accounts-backup-audit.timer
sudo install -m 644 "$stage/services/deployment/oceanseo-backup-alert@.service" /etc/systemd/system/oceanseo-backup-alert@.service
sudo install -o root -g caddy -m 640 "$stage/services/deployment/Caddyfile" /etc/caddy/Caddyfile
if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  exit 1
fi
sudo systemctl stop tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer || true
sudo systemctl daemon-reload
sudo systemctl restart oceanseo-accounts tideplan-sync
wait_for() {
  for _ in $(seq 1 20); do
    if "$@" >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
wait_for_port 127.0.0.1 4791
wait_for_port 127.0.0.1 4789
sudo systemctl enable tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer
start_audit() {
  local unit="$1"
  for _ in $(seq 1 10); do
    sudo systemctl reset-failed "$unit"
    if sudo systemctl start "$unit"; then
      return 0
    fi
    sleep 1
  done
  return 1
}
start_audit tideplan-backup-audit.service
start_audit oceanseo-accounts-backup-audit.service
sudo systemctl start tideplan-backup-audit.timer oceanseo-accounts-backup-audit.timer
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
