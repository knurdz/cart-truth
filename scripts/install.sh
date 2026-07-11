#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CARTTRUTH_APP_DIR:-$HOME/carttruth}"
REPO_URL="${CARTTRUTH_REPO_URL:-}"
DOMAIN="${CARTTRUTH_DOMAIN:-carttruth.knurdz.org}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine first, then rerun this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install the Docker compose plugin, then rerun this script." >&2
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "Set CARTTRUTH_REPO_URL to your GitHub repo URL for first install." >&2
    echo "Example: CARTTRUTH_REPO_URL=https://github.com/you/carttruth.git ./scripts/install.sh" >&2
    exit 1
  fi
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '\n')"
  ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  cat > .env <<EOF
CARTTRUTH_DOMAIN=$DOMAIN
CARTTRUTH_PUBLIC_URL=https://$DOMAIN
CARTTRUTH_LOG_LEVEL=debug
CARTTRUTH_BROWSER_MODE=vnc
CARTTRUTH_BROWSER_IDLE_TIMEOUT_MS=900000
CARTTRUTH_ADMIN_USERNAME=admin
CARTTRUTH_ADMIN_PASSWORD=$ADMIN_PASSWORD
CARTTRUTH_ENCRYPTION_KEY=$ENCRYPTION_KEY
CARTTRUTH_TORCH_ISP_PROXY=
EOF
  chmod 600 .env
  echo "Created .env with bootstrap admin password:"
  echo "$ADMIN_PASSWORD"
  echo "Edit .env and set CARTTRUTH_TORCH_ISP_PROXY before production use."
fi

if ! grep -Eq '^CARTTRUTH_TORCH_ISP_PROXY=.+$' .env; then
  echo "Warning: CARTTRUTH_TORCH_ISP_PROXY is empty in .env. Daraz traffic will not use TorchProxies until you set it." >&2
fi

docker compose build
docker compose up -d
docker compose ps

echo ""
echo "CartTruth should be available after DNS/TLS is ready:"
echo "https://$DOMAIN"
echo ""
echo "Debug logs:"
echo "docker compose logs -f carttruth"
echo "docker compose logs -f caddy"
