#!/usr/bin/env bash
# Run on the VM: pull the latest v2 and rebuild/restart the API. Usage: /opt/scholarlens/repo/deploy/cronos/deploy.sh
set -euo pipefail
cd /opt/scholarlens/repo
git fetch --quiet origin v2
git checkout --quiet --detach origin/v2   # deploy checkout only; never edit files here
cd deploy/cronos
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
sudo docker compose ps
