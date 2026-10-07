#!/usr/bin/env bash
# Publish only static output and the two explicitly approved beta artifacts.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f dist-landing/index.html
test -f dist-landing/privacy/index.html
rg -Fq '/downloads/Tideplan_0.18.0_android_arm64_internal.apk' dist-landing/index.html
apk=src-tauri/target/release/bundle/apk/Tideplan_0.18.0_android_arm64_internal.apk
deb=src-tauri/target/release/bundle/deb/Tideplan_0.18.0_amd64.deb
printf '%s  %s\n' 37f013e8da37afaee137b14fbf15651647e492b4d31c5bbdf97a7347c6b12adf "$apk" | sha256sum -c -
printf '%s  %s\n' 267b4c53afddaa2f1c113cb5e2af8678aa276ca9c1874e1b6b4502bf406ec7d3 "$deb" | sha256sum -c -
local_stage=$(mktemp -d /tmp/oceanseo-publish.XXXXXXXX)
remote_stage=$(ssh Oceanseo 'mktemp -d /tmp/oceanseo-publish.XXXXXXXX')
[[ "$remote_stage" =~ ^/tmp/oceanseo-publish\.[a-zA-Z0-9]{8}$ ]]
release_id="web-$(date -u +%Y%m%dT%H%M%SZ)"
tar -czf "$local_stage/site.tar.gz" -C dist-landing .
scp "$local_stage/site.tar.gz" services/deployment/Caddyfile "$apk" "$apk.sha256" "$deb" "$deb.sha256" "Oceanseo:$remote_stage/"
ssh Oceanseo "bash -s -- '$remote_stage' '$release_id'" <<'REMOTE'
set -euo pipefail
stage="$1"
id="$2"
[[ "$stage" =~ ^/tmp/oceanseo-publish\.[a-zA-Z0-9]{8}$ ]]
[[ "$id" =~ ^web-[0-9]{8}T[0-9]{6}Z$ ]]
base=/var/www/oceanseo
sudo cmp -s /etc/caddy/Caddyfile "$stage/Caddyfile"
sudo caddy validate --config "$stage/Caddyfile" --adapter caddyfile
cd "$stage"
printf '%s  %s\n' 37f013e8da37afaee137b14fbf15651647e492b4d31c5bbdf97a7347c6b12adf Tideplan_0.18.0_android_arm64_internal.apk | sha256sum -c -
printf '%s  %s\n' 267b4c53afddaa2f1c113cb5e2af8678aa276ca9c1874e1b6b4502bf406ec7d3 Tideplan_0.18.0_amd64.deb | sha256sum -c -
sudo install -d -m 0755 "$base/releases" "$base/downloads"
test ! -e "$base/releases/$id"
sudo mkdir -m 0755 "$base/releases/$id"
sudo tar -xzf "$stage/site.tar.gz" -C "$base/releases/$id" --no-same-owner
sudo find "$base/releases/$id" -type d -exec chmod 0755 {} +
sudo find "$base/releases/$id" -type f -exec chmod 0644 {} +
for file in Tideplan_0.18.0_android_arm64_internal.apk Tideplan_0.18.0_amd64.deb; do
  if test -e "$base/downloads/$file"; then
    test "$(sha256sum "$file" | cut -d ' ' -f 1)" = "$(sha256sum "$base/downloads/$file" | cut -d ' ' -f 1)"
  else
    sudo install -m 0644 "$file" "$base/downloads/$file"
  fi
  # Existing hash files must also match, never silently replace releases.
  if test -e "$base/downloads/$file.sha256"; then
    cmp "$file.sha256" "$base/downloads/$file.sha256"
  else
    sudo install -m 0644 "$file.sha256" "$base/downloads/$file.sha256"
  fi
done
previous=$(readlink "$base/current" || true)
backup="/etc/caddy/Caddyfile.before-$id"
sudo cp -a /etc/caddy/Caddyfile "$backup"
sudo ln -s "$base/releases/$id" "$base/current-$id"
sudo mv -Tf "$base/current-$id" "$base/current"
sudo install -o root -g caddy -m 0640 "$stage/Caddyfile" /etc/caddy/Caddyfile
if ! sudo systemctl reload caddy; then
  sudo cp -a "$backup" /etc/caddy/Caddyfile
  if test -n "$previous"; then
    sudo ln -s "$previous" "$base/rollback-$id"
    sudo mv -Tf "$base/rollback-$id" "$base/current"
  fi
  sudo systemctl reload caddy
  echo 'Reload failed; previous config restored.' >&2
  exit 1
fi
sudo systemctl is-active caddy tideplan-sync tideplan-monitor
curl --fail --silent --show-error --resolve oceanseo.gellaronline.cc:443:127.0.0.1 https://oceanseo.gellaronline.cc/health
echo
echo "Published $base/releases/$id"
REMOTE
# These are only this invocation's validated staging directories, not user data.
rm -r -- "$local_stage"
ssh Oceanseo "rm -r -- '$remote_stage'"
