# CartTruth

CartTruth is a hosted final-checkout price verification platform. Currently in **MVP preview**, the system supports price checking on **Daraz.lk**, but it is architected for generic extraction and we are actively expanding support for other major e-commerce platforms and tourism package booking websites.

Users sign in with Google, save product links (currently supporting Daraz), connect their own Daraz account, and run Buy Now checkout checks that stop before purchase. CartTruth compares product-page prices with final checkout totals, including delivery and other checkout-level charges when Daraz exposes them.

Production app:

```text
https://carttruth.knurdz.org
```

## What CartTruth Does

- Lets any verified Google account create a CartTruth account.
- Gives admin access only to Google emails listed in `CARTTRUTH_ADMIN_EMAILS`.
- Lets users save product links (currently supporting Daraz).
- Opens an isolated server-side Daraz browser for each user.
- Lets users complete Daraz login, OTP, captcha, or verification in that remote browser.
- Saves each user's Daraz browser profile separately.
- Optionally stores encrypted Daraz credentials for best-effort auto-login.
- Runs final checkout checks through Daraz Buy Now flow.
- Stores run history and evidence artifacts per user.
- Supports automatic scheduled price checks.
- Supports user-created API keys for REST API and MCP automation.
- Supports scoped API keys: REST only, MCP only, or both.
- Shows TorchProxies network settings and local proxy telemetry.

CartTruth is not a purchasing bot. It must not submit orders, pay, confirm purchases, or save payment details.

## Main Users

### Normal Users

Normal users can:

- Sign in with Google.
- Save Daraz product URLs.
- Open and save their own Daraz browser session.
- Save encrypted Daraz login credentials for best-effort reconnect.
- Run manual final-price checks.
- Enable scheduled automatic checks.
- Create, rename, scope, and delete API keys.
- Use REST API and MCP tools with their own API keys.
- Set a TorchProxies requested country preference as an MVP preview setting.

Normal users can only access their own links, jobs, runs, evidence, settings, credentials, and API keys.

### Admin Users

Admins can:

- View users.
- Enable or disable users.
- View masked TorchProxies runtime status.
- View local proxy events recorded by CartTruth.
- View local proxy usage grouped by source, status, country, and API-key-driven events.
- Run an admin-only proxy connectivity test.

Admins do not see raw proxy passwords, API key tokens, Daraz passwords, cookies, or session secrets.

## Product Workflow

1. User signs in with Google.
2. User opens the Daraz browser from the dashboard.
3. User logs in to Daraz and completes OTP, captcha, or verification if needed.
4. User saves the Daraz session.
5. User saves product links.
6. CartTruth reads product-page prices and queues final checkout checks.
7. User can run checks manually or enable scheduled automatic checks.
8. CartTruth stores results, evidence, and job history.
9. User can automate the same workflows through REST API or MCP.

## Daraz Login And Session Model

- Google OAuth is the only CartTruth login method.
- Each user has their own isolated Daraz browser profile.
- Browser profiles are stored under `/data/sessions/users/{userId}/` in Docker.
- Run artifacts are stored under `/data/runs` in Docker.
- SQLite data is stored at `/data/carttruth.db` in Docker.
- Optional Daraz credentials are encrypted using `CARTTRUTH_ENCRYPTION_KEY`.
- If Daraz requires manual action, the job returns `needs_user_action`.
- The user must complete Daraz verification in the CartTruth web dashboard before retrying.

On VPS/Docker:

- User login and OTP/captcha handling use the noVNC browser.
- Automated final checkout checks run headless by default.
- Set `CARTTRUTH_DARAZ_CHECK_HEADLESS=false` only for local headed debugging with a real display or Xvfb.

## TorchProxies Support

CartTruth can route Daraz browser/check traffic through a configured proxy profile. The current production-oriented profile is loaded from `CARTTRUTH_TORCH_ISP_PROXY` and is displayed as a masked TorchProxies profile in the app.

Current MVP support:

- Loads TorchProxies-style ISP proxy configuration from environment.
- Masks proxy username/password everywhere in health responses, logs, and UI.
- Shows user-side `TorchProxies Network` settings.
- Lets users save a requested country preference.
- Shows preview controls for sticky checkout session, rotate before next check, and auto fallback country.
- Records local CartTruth proxy events for Daraz search/product/check/admin-test flows.
- Shows admin-side `Proxy Operations` with local usage, recent events, status, source, country, pool type, and API-key-driven proxy usage.

Important MVP limits:

- Requested country is saved but not applied to live proxy routing yet.
- Preview controls are UI-only until routing support is implemented.
- CartTruth does not fetch TorchProxies dashboard/API data yet.
- `TORCHPROXIES_API_KEY` is reserved for a future external dashboard sync. It is not used by current code.

## REST API And MCP

Users create API keys from Settings. Each key has:

- Name.
- Token prefix shown later.
- One-time full token display at creation.
- Scope list: `rest`, `mcp`, or both.
- Last-used timestamp.
- Delete/revoke action.

API keys start with `ct_`. Store them in environment variables or a secret manager. If a key is exposed, delete it and create a new one.

### REST API

REST endpoints live under:

```text
/api/v1
```

Authentication:

```http
Authorization: Bearer ct_your_api_key
```

Available REST endpoints:

```text
GET    /api/v1/me
GET    /api/v1/settings
PATCH  /api/v1/settings
GET    /api/v1/links
POST   /api/v1/links
DELETE /api/v1/links/:linkId
POST   /api/v1/links/check-jobs
GET    /api/v1/price-check-jobs
GET    /api/v1/price-check-jobs/:jobId
GET    /api/v1/runs
GET    /api/v1/runs/:runId
GET    /api/v1/runs/:runId/artifacts/:file
```

Example:

```bash
export CARTTRUTH_API_KEY=ct_your_api_key

curl https://carttruth.knurdz.org/api/v1/links \
  -H "Authorization: Bearer $CARTTRUTH_API_KEY"
```

Add a Daraz link and queue a final checkout check:

```bash
curl https://carttruth.knurdz.org/api/v1/links \
  -H "Authorization: Bearer $CARTTRUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.daraz.lk/products/example.html"}'
```

Update settings:

```bash
curl -X PATCH https://carttruth.knurdz.org/api/v1/settings \
  -H "Authorization: Bearer $CARTTRUTH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "autoPriceCheckEnabled": true,
    "autoPriceCheckIntervalHours": 4,
    "proxyCountryPreference": "SG"
  }'
```

Task-creating REST calls are rate limited per API key and return `429` with `Retry-After` and `x-ratelimit-*` headers when limited.

Default rate limits:

```text
CARTTRUTH_API_RATE_LIMIT_PER_MINUTE=120
CARTTRUTH_API_TASK_RATE_LIMIT_PER_MINUTE=10
CARTTRUTH_MCP_RATE_LIMIT_PER_MINUTE=60
```

### MCP

MCP endpoint:

```text
https://carttruth.knurdz.org/mcp
```

MCP requires an API key with the `mcp` scope.

Available MCP tools:

```text
carttruth_list_links
carttruth_add_link
carttruth_delete_link
carttruth_get_settings
carttruth_update_settings
carttruth_queue_check
carttruth_list_jobs
carttruth_get_job
carttruth_list_runs
carttruth_get_run
```

MCP clients cannot save Daraz credentials or control the remote browser. If Daraz needs login, OTP, captcha, or verification, complete that in the web UI.

Codex config:

```toml
[mcp_servers.carttruth]
url = "https://carttruth.knurdz.org/mcp"
bearer_token_env_var = "CARTTRUTH_API_KEY"
```

Cursor config:

```json
{
  "mcpServers": {
    "carttruth": {
      "url": "https://carttruth.knurdz.org/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CARTTRUTH_API_KEY}"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http carttruth https://carttruth.knurdz.org/mcp \
  --header "Authorization: Bearer $CARTTRUTH_API_KEY"
```

VS Code:

```json
{
  "inputs": [
    {
      "id": "carttruth-api-key",
      "type": "promptString",
      "description": "CartTruth API key",
      "password": true
    }
  ],
  "servers": {
    "carttruth": {
      "type": "http",
      "url": "https://carttruth.knurdz.org/mcp",
      "headers": {
        "Authorization": "Bearer ${input:carttruth-api-key}"
      }
    }
  }
}
```

## Web App Routes

```text
/       Main app dashboard
/docs   Public REST API and MCP documentation
```

Public or session routes:

```text
GET  /api/health
GET  /api/auth/google/start
GET  /api/auth/google/callback
GET  /api/auth/me
POST /api/auth/logout
```

Logged-in user API routes include settings, Daraz session, credentials, links, jobs, runs, evidence, API keys, and proxy status.

Admin-only API routes:

```text
GET  /api/admin/users
POST /api/admin/users/:userId/disabled
GET  /api/admin/proxy/summary
GET  /api/admin/proxy/events
POST /api/admin/proxy/test
POST /api/proxy/test
```

The legacy `/api/proxy/test` route exists for compatibility but requires admin login.

## Data Stored

CartTruth uses SQLite through Node's `DatabaseSync`.

Main tables:

```text
users
app_sessions
api_keys
saved_links
daraz_credentials
daraz_runs
user_settings
price_check_jobs
proxy_events
```

Sensitive storage rules:

- API key tokens are hashed before storage.
- Session tokens are hashed before storage.
- Daraz passwords are encrypted before storage.
- Proxy passwords are never displayed in full.
- Logs redact secrets, passwords, cookies, tokens, authorization headers, and proxy passwords.

## Project Structure

```text
apps/web          Web app, API server, MCP handler, runtime, SQLite store
apps/cli          CLI entrypoint
packages/core     Shared runner, evidence, money, proxy, safety, redaction logic
packages/adapters Daraz browser adapter and related browser/session helpers
packages/schemas  Shared Zod schemas and types
tests             Vitest coverage for API, Daraz flow, proxy, safety, schemas, deploy checks
scripts           Deployment/update helper scripts
docs              Additional project docs
examples          Example inputs/configs
```

## Local Development

Install dependencies:

```bash
cd /Users/rk_vishva/Documents/Projects/CartTruth
pnpm install
```

Run the web app:

```bash
pnpm web
```

Open the URL printed by the server. It usually starts at:

```text
http://localhost:5173
```

If that port is busy, the server automatically tries the next available port.

Run API-only server:

```bash
pnpm api
```

Run checks:

```bash
pnpm typecheck
pnpm test
pnpm exec vite build apps/web
```

## Google OAuth Setup

CartTruth requires a Google Web application OAuth client.

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen/branding.
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

If local development uses another port, add that exact callback URL too.

6. Copy credentials into `.env`:

```bash
CARTTRUTH_GOOGLE_CLIENT_ID=...
CARTTRUTH_GOOGLE_CLIENT_SECRET=...
CARTTRUTH_GOOGLE_REDIRECT_URI=https://carttruth.knurdz.org/api/auth/google/callback
CARTTRUTH_ADMIN_EMAILS=your-admin@gmail.com
```

## Environment Variables

Create `.env` from `.env.example`.

Required production values:

```bash
CARTTRUTH_DOMAIN=carttruth.knurdz.org
CARTTRUTH_PUBLIC_URL=https://carttruth.knurdz.org
CARTTRUTH_LOG_LEVEL=debug
CARTTRUTH_BROWSER_MODE=vnc
CARTTRUTH_DARAZ_CHECK_HEADLESS=true
CARTTRUTH_BROWSER_IDLE_TIMEOUT_MS=900000
CARTTRUTH_SQLITE_PATH=/data/carttruth.db
CARTTRUTH_SESSIONS_DIR=/data/sessions
CARTTRUTH_RUNS_DIR=/data/runs
CARTTRUTH_GOOGLE_CLIENT_ID=your-google-client-id
CARTTRUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret
CARTTRUTH_GOOGLE_REDIRECT_URI=https://carttruth.knurdz.org/api/auth/google/callback
CARTTRUTH_ADMIN_EMAILS=your-admin@gmail.com
CARTTRUTH_ENCRYPTION_KEY=replace-with-openssl-rand-base64-32
CARTTRUTH_TORCH_ISP_PROXY=host:61234:username:password
```

Generate encryption key:

```bash
openssl rand -base64 32
```

Proxy configuration options:

```bash
# Preferred single-string format
CARTTRUTH_TORCH_ISP_PROXY=host:61234:username:password

# Alternative separate fields
CARTTRUTH_PROXY_HOST=host
CARTTRUTH_PROXY_PORT=61234
CARTTRUTH_PROXY_USERNAME=username
CARTTRUTH_PROXY_PASSWORD=password
CARTTRUTH_PROXY_PROTOCOL=http
CARTTRUTH_PROXY_COUNTRY=US
```

Optional rate limit values:

```bash
CARTTRUTH_API_RATE_LIMIT_PER_MINUTE=120
CARTTRUTH_API_TASK_RATE_LIMIT_PER_MINUTE=10
CARTTRUTH_MCP_RATE_LIMIT_PER_MINUTE=60
```

Optional future TorchProxies API placeholder:

```bash
TORCHPROXIES_API_KEY=not-used-yet
```

## VPS Deployment

### DNS

Create an `A` record:

```text
carttruth.knurdz.org -> YOUR_VPS_PUBLIC_IP
```

Verify:

```bash
dig +short carttruth.knurdz.org
```

### Server Setup

```bash
ssh root@YOUR_VPS_PUBLIC_IP
apt update && apt upgrade -y
apt install -y git curl ca-certificates openssl
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### Clone And Configure

```bash
git clone https://github.com/knurdz/cart-truth.git /opt/carttruth
cd /opt/carttruth
cp .env.example .env
nano .env
```

Set these at minimum:

```text
CARTTRUTH_GOOGLE_CLIENT_ID
CARTTRUTH_GOOGLE_CLIENT_SECRET
CARTTRUTH_GOOGLE_REDIRECT_URI
CARTTRUTH_ADMIN_EMAILS
CARTTRUTH_ENCRYPTION_KEY
CARTTRUTH_TORCH_ISP_PROXY
```

### Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f carttruth
```

Caddy handles HTTPS for the configured domain.

### Verify Deployment

```bash
curl -I https://carttruth.knurdz.org
curl https://carttruth.knurdz.org/api/health
docker compose logs --tail=100 caddy
```

First setup:

- Open `https://carttruth.knurdz.org`.
- Sign in with a Google account listed in `CARTTRUTH_ADMIN_EMAILS`.
- Confirm the account appears as admin.
- Open Settings and confirm API keys and TorchProxies Network panels load.
- Open Admin and confirm Users and Proxy Operations panels load.
- Have each user open and save their Daraz browser session before relying on checks.

## Updating Production

```bash
cd /opt/carttruth
git pull --ff-only
docker compose up -d --build
docker compose logs -f carttruth
```

Or use:

```bash
./scripts/update.sh
```

## Backup And Restore

Backup SQLite:

```bash
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db ".backup /data/carttruth-backup.db"'
docker cp carttruth-carttruth-1:/data/carttruth-backup.db ./carttruth-backup.db
```

Backup full data volume:

```bash
docker run --rm \
  -v carttruth_carttruth-data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/carttruth-data.tgz /data
```

Restore during maintenance:

```bash
docker compose down
docker run --rm \
  -v carttruth_carttruth-data:/data \
  -v "$PWD":/backup \
  alpine sh -lc 'cd / && tar xzf /backup/carttruth-data.tgz'
docker compose up -d
```

## Debugging

Application logs are JSON lines:

```bash
docker compose logs -f carttruth
docker compose logs -f caddy
```

Useful checks:

```bash
docker compose exec carttruth sh -lc 'ls -lah /data /data/runs /data/sessions'
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db ".tables"'
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db "select email, role, disabled from users;"'
docker compose exec carttruth sh -lc 'sqlite3 /data/carttruth.db "select operation, source, status, proxy_country, created_at from proxy_events order by created_at desc limit 10;"'
```

Useful log fields:

```text
requestId
userId
apiKeyId
runId
jobId
captureId
browserMode
proxy.masked
elapsedMs
status
```

Common problems:

- Google sign-in fails: verify redirect URI exactly matches `CARTTRUTH_GOOGLE_REDIRECT_URI`.
- User is not admin: add their Google email to `CARTTRUTH_ADMIN_EMAILS` and restart.
- Daraz asks for OTP/captcha: user must complete it in the remote browser.
- Auto-login fails: verify encrypted Daraz credentials or save a fresh Daraz browser session.
- Proxy test fails: verify `CARTTRUTH_TORCH_ISP_PROXY`, proxy country, and network access from the VPS.
- REST/MCP returns `403`: API key does not have the required scope.
- REST/MCP returns `429`: API key hit the configured rate limit.

## Security Notes

- Keep `.env` out of source control.
- Rotate exposed API keys immediately.
- Rotate exposed TorchProxies credentials immediately.
- Use the narrowest API key scope that works.
- Do not share browser session files.
- Do not log or paste Daraz passwords.
- Do not use real payment details in automated test flows.
- Review Admin Proxy Operations as local CartTruth telemetry, not official TorchProxies billing data.

## Useful Commands

```bash
git status
pnpm typecheck
pnpm test
pnpm verify
pnpm exec vite build apps/web
docker compose config
docker compose build
docker compose up -d
docker compose logs -f carttruth
```
