#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CARTTRUTH_APP_DIR:-$HOME/carttruth}"

cd "$APP_DIR"
git pull --ff-only
docker compose config >/dev/null
docker compose build
docker compose up -d
docker compose ps
echo ""
echo "Follow logs with:"
echo "docker compose logs -f carttruth"
