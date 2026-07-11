# CartTruth

A hosted Daraz.lk final-price checker for multiple users.

Users sign in to CartTruth with Google, save Daraz product links, connect their own Daraz account, and run on-demand Buy Now checkout checks. Each user has an isolated Daraz browser profile and can only see their own links, runs, and evidence.

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

CartTruth uses Google OAuth only. Configure a Google Web application OAuth client before signing in locally. For local development, add this authorized redirect URI in Google Cloud:

```text
http://localhost:5173/api/auth/google/callback
```

## Daraz Login Model

- Any verified Google account can sign up.
- Admin access is granted to emails listed in `CARTTRUTH_ADMIN_EMAILS`.
- Each user logs into CartTruth with their own Google account.
- Each user opens their own Daraz browser session from the dashboard.
- If Daraz asks for OTP, captcha, or verification, that user completes it in their own remote browser.
- Saved Daraz profiles are stored per user under `/data/sessions/users/{userId}/` in Docker.
- Optional Daraz credentials are encrypted with `CARTTRUTH_ENCRYPTION_KEY` and used only for best-effort auto-login.

The checker uses Daraz Buy Now checkout extraction and is designed to stop before purchase. It must not submit orders, pay, confirm purchases, or save payment details.

On VPS/Docker, user login and OTP/captcha handling use the VNC browser, while automated Buy Now final-price checks run headless by default. Set `CARTTRUTH_DARAZ_CHECK_HEADLESS=false` only for local headed debugging with a real display or Xvfb.

## Required Environment

Create `.env` from `.env.example` on the VPS. Required production values:

```bash
CARTTRUTH_DOMAIN=carttruth.knurdz.org
CARTTRUTH_PUBLIC_URL=https://carttruth.knurdz.org
CARTTRUTH_LOG_LEVEL=debug
CARTTRUTH_BROWSER_MODE=vnc
CARTTRUTH_DARAZ_CHECK_HEADLESS=true
CARTTRUTH_BROWSER_IDLE_TIMEOUT_MS=900000
CARTTRUTH_GOOGLE_CLIENT_ID=your-google-client-id
CARTTRUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret
CARTTRUTH_GOOGLE_REDIRECT_URI=https://carttruth.knurdz.org/api/auth/google/callback
CARTTRUTH_ADMIN_EMAILS=your-admin@gmail.com
CARTTRUTH_ENCRYPTION_KEY=replace-with-openssl-rand-base64-32
CARTTRUTH_TORCH_ISP_PROXY=host:61234:username:password
```

Generate an encryption key:

```bash
openssl rand -base64 32
```

## Google OAuth Setup

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen/branding for the app.
4. Create credentials:

```text
APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
Application type: Web application
```

5. Add authorized redirect URIs:

```text
https://carttruth.knurdz.org/api/auth/google/callback
http://localhost:5173/api/auth/google/callback
```

6. Copy the generated Client ID and Client Secret into `.env`:

```bash
CARTTRUTH_GOOGLE_CLIENT_ID=...
CARTTRUTH_GOOGLE_CLIENT_SECRET=...
CARTTRUTH_GOOGLE_REDIRECT_URI=https://carttruth.knurdz.org/api/auth/google/callback
CARTTRUTH_ADMIN_EMAILS=your-admin@gmail.com
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

Set `CARTTRUTH_GOOGLE_CLIENT_ID`, `CARTTRUTH_GOOGLE_CLIENT_SECRET`, `CARTTRUTH_ADMIN_EMAILS`, `CARTTRUTH_TORCH_ISP_PROXY`, and `CARTTRUTH_ENCRYPTION_KEY`.

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
- Sign in with a Google account listed in `CARTTRUTH_ADMIN_EMAILS`.
- Other users sign in with Google to create their own normal accounts.
- Each user opens their Daraz browser, completes OTP/captcha if needed, saves the Daraz session, saves product links, and runs checks.

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
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db "select email, role, disabled from users;"'
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
