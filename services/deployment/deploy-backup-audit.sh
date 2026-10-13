#!/usr/bin/env bash
# Update only the snapshot audit reader, preserving service code and databases.
set -euo pipefail
cd "$(dirname "$0")/../.."
stage=$(ssh -o BatchMode=yes Oceanseo 'mktemp -d /tmp/oceanseo-audit.XXXXXXXX')
[[ "$stage" =~ ^/tmp/oceanseo-audit\.[A-Za-z0-9]{8}$ ]]
trap 'ssh -o BatchMode=yes Oceanseo "rm -rf -- '\''$stage'\''" >/dev/null 2>&1 || true' EXIT
scp -q services/deployment/backup-audit.py "Oceanseo:$stage/backup-audit.py"
ssh -o BatchMode=yes Oceanseo "bash -s -- '$stage'" <<'REMOTE'
set -euo pipefail
stage="$1"
[[ "$stage" =~ ^/tmp/oceanseo-audit\.[A-Za-z0-9]{8}$ ]]
backup="/var/backups/oceanseo-audit-fix-$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 700 "$backup"
sudo -n cp -a /opt/tideplan-sync/backup-audit.py "$backup/sync-audit.py"
sudo -n cp -a /opt/oceanseo-accounts/services/deployment/backup-audit.py "$backup/accounts-audit.py"
committed=false
rollback() {
  if [ "$committed" = false ]; then
    sudo -n install -m 755 "$backup/sync-audit.py" /opt/tideplan-sync/backup-audit.py
    sudo -n install -m 755 "$backup/accounts-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py
  fi
}
trap rollback EXIT
sudo -n install -m 755 "$stage/backup-audit.py" /opt/tideplan-sync/backup-audit.py
sudo -n install -m 755 "$stage/backup-audit.py" /opt/oceanseo-accounts/services/deployment/backup-audit.py
sudo -n systemctl reset-failed tideplan-backup-audit.service oceanseo-accounts-backup-audit.service
# Run the actual sandboxed services, not an unsandboxed substitute.
sudo -n systemctl start tideplan-backup-audit.service oceanseo-accounts-backup-audit.service
for unit in tideplan-backup-audit.service oceanseo-accounts-backup-audit.service; do
  test "$(sudo -n systemctl show "$unit" --property=Result --value)" = success
done
for endpoint in accounts sync; do
  curl --fail --silent --show-error --max-time 15 \
    --resolve oceanseo.gellaronline.cc:443:127.0.0.1 \
    "https://oceanseo.gellaronline.cc/health/$endpoint"
done
committed=true
printf '\nSnapshot audits recovered; original readers preserved at %s\n' "$backup"
REMOTE
