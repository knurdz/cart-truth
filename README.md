# CartTruth

A hosted Daraz.lk final-price checker for multiple users.

Users sign in to CartTruth, save Daraz product links, connect their own Daraz account, and run on-demand Buy Now checkout checks. Each user has an isolated Daraz browser profile and can only see their own links, runs, and evidence.

Production domain:

```text
https://carttruth.knurdz.org
```

## Local Development

```bash
cd /Users/rk_vishva/Documents/Projects/CartTruth
pnpm install
pnpm web
```

Open the URL printed by the server, usually:

```text
http://localhost:5173
```

On first start, if the SQLite database has no users, the app creates a bootstrap admin. Defaults:

```text
username: admin
password: admin12345
```

Set `CARTTRUTH_ADMIN_USERNAME` and `CARTTRUTH_ADMIN_PASSWORD` in `.env.local` before first start to override this.

## Daraz Login Model

- Admin creates CartTruth users.
- Each user logs into CartTruth with their own app account.
- Each user opens their own Daraz browser session from the dashboard.
- If Daraz asks for OTP, captcha, or verification, that user completes it in their own remote browser.
- Saved Daraz profiles are stored per user under `/data/sessions/users/{userId}/` in Docker.
- Optional Daraz credentials are encrypted with `CARTTRUTH_ENCRYPTION_KEY` and used only for best-effort auto-login.

The checker uses Daraz Buy Now checkout extraction and is designed to stop before purchase. It must not submit orders, pay, confirm purchases, or save payment details.

## Required Environment

Create `.env` from `.env.example` on the VPS. Required production values:

```bash
CARTTRUTH_DOMAIN=carttruth.knurdz.org
CARTTRUTH_PUBLIC_URL=https://carttruth.knurdz.org
CARTTRUTH_LOG_LEVEL=debug
CARTTRUTH_BROWSER_MODE=vnc
CARTTRUTH_BROWSER_IDLE_TIMEOUT_MS=900000
CARTTRUTH_ADMIN_USERNAME=admin
CARTTRUTH_ADMIN_PASSWORD=temporary-strong-password
CARTTRUTH_ENCRYPTION_KEY=replace-with-openssl-rand-base64-32
CARTTRUTH_TORCH_ISP_PROXY=host:61234:username:password
```

Generate an encryption key:

```bash
openssl rand -base64 32
```

## VPS Hosting Via Git

1. Push code to GitHub from your machine:

```bash
git status
git add .
git commit -m "Finish hosted CartTruth deployment"
git push origin main
```

2. Point DNS:

Create an `A` record:

```text
carttruth.knurdz.org -> YOUR_VPS_PUBLIC_IP
```

Confirm:

```bash
dig +short carttruth.knurdz.org
```

3. Prepare Ubuntu VPS:

```bash
ssh root@YOUR_VPS_PUBLIC_IP
apt update && apt upgrade -y
apt install -y git curl ca-certificates openssl
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

4. Clone:

```bash
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPO.git /opt/carttruth
cd /opt/carttruth
```

5. Configure:

```bash
cp .env.example .env
nano .env
```

Set `CARTTRUTH_TORCH_ISP_PROXY`, `CARTTRUTH_ENCRYPTION_KEY`, and a temporary `CARTTRUTH_ADMIN_PASSWORD`.

6. Start:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f carttruth
```

7. Verify:

```bash
curl -I https://carttruth.knurdz.org
curl https://carttruth.knurdz.org/api/health
docker compose logs --tail=100 caddy
```

8. First app setup:

- Open `https://carttruth.knurdz.org`.
- Login with the bootstrap admin.
- Change the admin password.
- Create normal users.
- Each user logs in, opens their Daraz browser, completes OTP/captcha if needed, saves the Daraz session, saves product links, and runs checks.

## Update Later

```bash
cd /opt/carttruth
git pull --ff-only
docker compose up -d --build
docker compose logs -f carttruth
```

Or:

```bash
./scripts/update.sh
```

## Debug Logs

Application logs are JSON lines. Use:

```bash
docker compose logs -f carttruth
docker compose logs -f caddy
```

Useful checks:

```bash
docker compose exec carttruth sh -lc 'ls -lah /data /data/runs /data/sessions'
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db ".tables"'
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db "select username, role, disabled from users;"'
```

Look for fields like:

- `requestId`
- `userId`
- `runId`
- `captureId`
- `browserMode`
- `proxy.masked`
- `elapsedMs`
- `status`

Secrets, passwords, cookies, tokens, and proxy passwords are redacted.

## Backup And Restore

Backup:

```bash
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db ".backup /data/carttruth-backup.db"'
docker cp carttruth-carttruth-1:/data/carttruth-backup.db ./carttruth-backup.db
docker run --rm -v carttruth_carttruth-data:/data -v "$PWD":/backup alpine tar czf /backup/carttruth-data.tgz /data
```

Restore during maintenance:

```bash
docker compose down
docker run --rm -v carttruth_carttruth-data:/data -v "$PWD":/backup alpine sh -lc 'cd / && tar xzf /backup/carttruth-data.tgz'
docker compose up -d
```

## Useful Commands

```bash
pnpm typecheck
pnpm test -- --reporter=dot
pnpm exec vite build apps/web
docker compose config
docker compose build
```
