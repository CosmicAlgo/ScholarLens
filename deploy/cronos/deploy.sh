#!/usr/bin/env bash
# Run on the VM: pull the latest v2 and rebuild/restart the API. Usage: /opt/scholarlens/repo/deploy/cronos/deploy.sh
set -euo pipefail
cd /opt/scholarlens/repo
git fetch --quiet origin v2
git checkout --quiet --detach origin/v2   # deploy checkout only; never edit files here
cd deploy/cronos
sudo docker compose up -d --build
# The Caddyfile is bind-mounted; a changed file needs a restart of the proxy to take effect.
sum=$(sha256sum Caddyfile | cut -d' ' -f1)
if [ "$(cat /opt/scholarlens/.caddyfile.sha 2>/dev/null)" != "$sum" ]; then
  sudo docker compose restart caddy
  echo "$sum" | sudo tee /opt/scholarlens/.caddyfile.sha >/dev/null
fi
sudo docker image prune -f >/dev/null
sudo docker compose ps
