import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";
import { hashApiKeyToken, hashSessionToken, type UserRole } from "./auth.js";

export interface AppUser {
  id: string;
  username: string;
  googleSub?: string;
  email?: string;
  emailNormalized?: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface UserWithPassword extends AppUser {
  passwordHash: string;
}

export interface SavedLink {
  id: string;
  userId: string;
  title: string;
  url: string;
  imageUrl?: string;
  observedPriceJson?: string;
  availability?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export type ApiKeyScope = "rest" | "mcp";

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface RunRecord {
  runId: string;
  userId: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  summaryJson: string;
}

export interface DarazCredentialRecord {
  userId: string;
  username: string;
  encryptedPassword: string;
  updatedAt: string;
}

export type PriceCheckJobStatus = "queued" | "running" | "completed" | "failed" | "needs_user_action" | "skipped";
export type PriceCheckJobSource = "link_added" | "manual" | "scheduled";

export interface UserSettings {
  userId: string;
  autoPriceCheckEnabled: boolean;
  autoPriceCheckIntervalHours: number;
  proxyCountryPreference: string;
  autoPriceCheckNextRunAt?: string;
  autoPriceCheckLastRunAt?: string;
  autoPriceCheckLastJobId?: string;
  autoPriceCheckLastStatus?: PriceCheckJobStatus;
  autoPriceCheckLastMessage?: string;
  updatedAt: string;
}

export interface PriceCheckJob {
  id: string;
  userId: string;
  source: PriceCheckJobSource;
  status: PriceCheckJobStatus;
  linkIds?: string[];
  runId?: string;
  message?: string;
  sessionJson?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export type ProxyEventSource = "web" | "rest" | "mcp" | "scheduled" | "system";
export type ProxyEventStatus = "success" | "failure" | "blocked" | "skipped";

export interface ProxyEventRecord {
  id: string;
  operation: string;
  userId?: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  source: ProxyEventSource;
  proxyFingerprint: string;
  proxyCountry?: string;
  proxySource?: string;
  proxyPoolType?: string;
  status: ProxyEventStatus;
  elapsedMs?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface ProxyEventSummary {
  total: number;
  apiKeyEvents: number;
  lastEvent?: ProxyEventRecord;
  byStatus: Array<{ key: ProxyEventStatus; count: number }>;
  bySource: Array<{ key: ProxyEventSource; count: number }>;
  byCountry: Array<{ key: string; count: number }>;
}

export interface ContactMessage {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
}

export type NotificationKind = "success" | "error" | "warning" | "info";

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
  relatedJobId?: string;
}

export type NotificationPlatform = "slack" | "discord" | "telegram";

export interface NotificationChannel {
  id: string;
  userId: string;
  platform: NotificationPlatform;
  label?: string;
  enabled: boolean;
  configured: boolean;
  webhookHost?: string;
  lastDeliveryAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationChannelRecord {
  id: string;
  userId: string;
  platform: NotificationPlatform;
  label?: string;
  enabled: boolean;
  encryptedConfig: string;
  lastDeliveryAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface SqlRow {
  [column: string]: unknown;
}

export class AppStore {
  readonly db: DatabaseSync;

  constructor(path = process.env.CARTTRUTH_SQLITE_PATH ?? ".carttruth/carttruth.db") {
    const dbPath = resolve(path);
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        google_sub TEXT,
        email TEXT,
        email_normalized TEXT,
        display_name TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        disabled INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS saved_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        image_url TEXT,
        observed_price_json TEXT,
        availability TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, url)
      );

      CREATE TABLE IF NOT EXISTS daraz_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daraz_runs (
        run_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        summary_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        auto_price_check_enabled INTEGER NOT NULL DEFAULT 0,
        auto_price_check_interval_hours INTEGER NOT NULL DEFAULT 24,
        proxy_country_preference TEXT,
        auto_price_check_next_run_at TEXT,
        auto_price_check_last_run_at TEXT,
        auto_price_check_last_job_id TEXT,
        auto_price_check_last_status TEXT,
        auto_price_check_last_message TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS price_check_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('link_added', 'manual', 'scheduled')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'needs_user_action', 'skipped')),
        link_ids_json TEXT,
        run_id TEXT,
        message TEXT,
        session_json TEXT,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proxy_events (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        api_key_id TEXT,
        api_key_prefix TEXT,
        source TEXT NOT NULL CHECK (source IN ('web', 'rest', 'mcp', 'scheduled', 'system')),
        proxy_fingerprint TEXT NOT NULL,
        proxy_country TEXT,
        proxy_source TEXT,
        proxy_pool_type TEXT,
        status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'blocked', 'skipped')),
        elapsed_ms INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_messages (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('success', 'error', 'warning', 'info')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        related_job_id TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_channels (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord', 'telegram')),
        label TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        encrypted_config TEXT NOT NULL,
        last_delivery_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.addColumnIfMissing("users", "google_sub", "TEXT");
    this.addColumnIfMissing("users", "email", "TEXT");
    this.addColumnIfMissing("users", "email_normalized", "TEXT");
    this.addColumnIfMissing("users", "display_name", "TEXT");
    this.addColumnIfMissing("users", "avatar_url", "TEXT");
    this.addColumnIfMissing("user_settings", "proxy_country_preference", "TEXT");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
        ON users(google_sub)
        WHERE google_sub IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique
        ON users(email_normalized)
        WHERE email_normalized IS NOT NULL;

      CREATE INDEX IF NOT EXISTS price_check_jobs_queue_idx
        ON price_check_jobs(status, queued_at);

      CREATE INDEX IF NOT EXISTS user_settings_auto_due_idx
        ON user_settings(auto_price_check_enabled, auto_price_check_next_run_at);

      CREATE INDEX IF NOT EXISTS api_keys_user_idx
        ON api_keys(user_id, revoked_at, created_at);

      CREATE INDEX IF NOT EXISTS proxy_events_created_idx
        ON proxy_events(created_at DESC);

      CREATE INDEX IF NOT EXISTS proxy_events_api_key_idx
        ON proxy_events(api_key_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS proxy_events_source_idx
        ON proxy_events(source, status, created_at DESC);

      CREATE INDEX IF NOT EXISTS notifications_user_created_idx
        ON notifications(user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
        ON notifications(user_id, read_at, created_at DESC);

      CREATE INDEX IF NOT EXISTS notification_channels_user_idx
        ON notification_channels(user_id, enabled, created_at DESC);
    `);
  }

  userCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as SqlRow;
    return Number(row.count ?? 0);
  }

  createUser(input: {
    username: string;
    passwordHash: string;
    role: UserRole;
    mustChangePassword?: boolean;
  }): AppUser {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO users (id, username, password_hash, role, must_change_password, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.username, input.passwordHash, input.role, input.mustChangePassword ? 1 : 0, now);
    return {
      id,
      username: input.username,
      role: input.role,
      disabled: false,
      mustChangePassword: Boolean(input.mustChangePassword),
      createdAt: now
    };
  }

  upsertGoogleUser(input: {
    googleSub: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
    role: UserRole;
  }): AppUser {
    const now = new Date().toISOString();
    const emailNormalized = normalizeEmail(input.email);
    const existing = this.findUserByGoogleSub(input.googleSub) ?? this.findUserByEmail(input.email);
    if (existing) {
      this.db.prepare(`
        UPDATE users
        SET google_sub = ?,
            email = ?,
            email_normalized = ?,
            display_name = ?,
            avatar_url = ?,
            role = ?,
            must_change_password = 0
        WHERE id = ?
      `).run(
        input.googleSub,
        input.email,
        emailNormalized,
        input.displayName ?? null,
        input.avatarUrl ?? null,
        input.role,
        existing.id
      );
      return this.findUserById(existing.id)!;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO users (
        id,
        username,
        password_hash,
        google_sub,
        email,
        email_normalized,
        display_name,
        avatar_url,
        role,
        must_change_password,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      `google:${input.googleSub}`,
      "oauth:google",
      input.googleSub,
      input.email,
      emailNormalized,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      input.role,
      now
    );
    return this.findUserById(id)!;
  }

  listUsers(): AppUser[] {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(mapUser);
  }

  findUserByUsername(username: string): UserWithPassword | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(username) as SqlRow | undefined;
    return row ? mapUserWithPassword(row) : undefined;
  }

  findUserByGoogleSub(googleSub: string): AppUser | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE google_sub = ?").get(googleSub) as SqlRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  findUserByEmail(email: string): AppUser | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE email_normalized = ?").get(normalizeEmail(email)) as SqlRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  findUserById(id: string): AppUser | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  updateUserPassword(userId: string, passwordHash: string, mustChangePassword = false): void {
    this.db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?")
      .run(passwordHash, mustChangePassword ? 1 : 0, userId);
  }

  setUserDisabled(userId: string, disabled: boolean): void {
    this.db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, userId);
  }

  syncGoogleAdminRoles(adminEmails: Set<string>): void {
    const emails = Array.from(adminEmails);
    if (emails.length === 0) {
      this.db.prepare("UPDATE users SET role = 'user' WHERE google_sub IS NOT NULL").run();
      return;
    }
    const placeholders = emails.map(() => "?").join(", ");
    this.db.prepare(`
      UPDATE users
      SET role = CASE WHEN email_normalized IN (${placeholders}) THEN 'admin' ELSE 'user' END
      WHERE google_sub IS NOT NULL
    `).run(...emails);
  }

  createSession(userId: string, tokenHash: string, expiresAt: string): AppSession {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO app_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, tokenHash, expiresAt, now);
    return { id, userId, tokenHash, expiresAt, createdAt: now };
  }

  findSessionByToken(token: string): { session: AppSession; user: AppUser } | undefined {
    const tokenHash = hashSessionToken(token);
    const row = this.db.prepare(`
      SELECT
        app_sessions.id AS session_id,
        app_sessions.user_id,
        app_sessions.token_hash,
        app_sessions.expires_at,
        app_sessions.created_at AS session_created_at,
        users.id AS user_id,
        users.username,
        users.google_sub,
        users.email,
        users.email_normalized,
        users.display_name,
        users.avatar_url,
        users.role,
        users.disabled,
        users.must_change_password,
        users.created_at AS user_created_at
      FROM app_sessions
      JOIN users ON users.id = app_sessions.user_id
      WHERE app_sessions.token_hash = ?
    `).get(tokenHash) as SqlRow | undefined;
    if (!row || String(row.expires_at) <= new Date().toISOString() || Number(row.disabled ?? 0) === 1) {
      return undefined;
    }
    return {
      session: {
        id: String(row.session_id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: String(row.expires_at),
        createdAt: String(row.session_created_at)
      },
      user: {
        id: String(row.user_id),
        username: String(row.username),
        ...(row.google_sub ? { googleSub: String(row.google_sub) } : {}),
        ...(row.email ? { email: String(row.email) } : {}),
        ...(row.email_normalized ? { emailNormalized: String(row.email_normalized) } : {}),
        ...(row.display_name ? { displayName: String(row.display_name) } : {}),
        ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
        role: String(row.role) as UserRole,
        disabled: false,
        mustChangePassword: Number(row.must_change_password ?? 0) === 1,
        createdAt: String(row.user_created_at)
      }
    };
  }

  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM app_sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }

  deleteExpiredSessions(): void {
    this.db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  }

  deleteLegacySessions(): void {
    this.db.prepare(`
      DELETE FROM app_sessions
      WHERE user_id IN (
        SELECT id FROM users WHERE google_sub IS NULL
      )
    `).run();
  }

  createApiKey(input: {
    userId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: ApiKeyScope[];
  }): ApiKeyRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO api_keys (id, user_id, name, token_hash, token_prefix, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.userId, input.name, input.tokenHash, input.tokenPrefix, JSON.stringify(normalizeApiKeyScopes(input.scopes)), now);
    return this.getApiKey(input.userId, id)!;
  }

  listApiKeys(userId: string): ApiKeyRecord[] {
    return this.db.prepare(`
      SELECT * FROM api_keys
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC
    `).all(userId).map(mapApiKey);
  }

  getApiKey(userId: string, keyId: string): ApiKeyRecord | undefined {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE user_id = ? AND id = ? AND revoked_at IS NULL").get(userId, keyId) as SqlRow | undefined;
    return row ? mapApiKey(row) : undefined;
  }

  updateApiKey(userId: string, keyId: string, input: { name?: string; scopes?: ApiKeyScope[] }): ApiKeyRecord | undefined {
    const current = this.getApiKey(userId, keyId);
    if (!current) {
      return undefined;
    }
    this.db.prepare(`
      UPDATE api_keys
      SET name = ?, scopes_json = ?
      WHERE user_id = ? AND id = ? AND revoked_at IS NULL
    `).run(
      input.name ?? current.name,
      JSON.stringify(input.scopes ? normalizeApiKeyScopes(input.scopes) : current.scopes),
      userId,
      keyId
    );
    return this.getApiKey(userId, keyId);
  }

  revokeApiKey(userId: string, keyId: string): boolean {
    const result = this.db.prepare(`
      UPDATE api_keys
      SET revoked_at = ?
      WHERE user_id = ? AND id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), userId, keyId);
    return result.changes > 0;
  }

  findApiKeyByToken(token: string): { apiKey: ApiKeyRecord; user: AppUser } | undefined {
    const row = this.db.prepare(`
      SELECT
        api_keys.id AS api_key_id,
        api_keys.user_id,
        api_keys.name,
        api_keys.token_hash,
        api_keys.token_prefix,
        api_keys.scopes_json,
        api_keys.created_at AS api_key_created_at,
        api_keys.last_used_at,
        api_keys.revoked_at,
        users.id AS user_id,
        users.username,
        users.google_sub,
        users.email,
        users.email_normalized,
        users.display_name,
        users.avatar_url,
        users.role,
        users.disabled,
        users.must_change_password,
        users.created_at AS user_created_at
      FROM api_keys
      JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.token_hash = ?
        AND api_keys.revoked_at IS NULL
    `).get(hashApiKeyToken(token)) as SqlRow | undefined;
    if (!row || Number(row.disabled ?? 0) === 1) {
      return undefined;
    }
    return {
      apiKey: mapApiKey({
        id: row.api_key_id,
        user_id: row.user_id,
        name: row.name,
        token_hash: row.token_hash,
        token_prefix: row.token_prefix,
        scopes_json: row.scopes_json,
        created_at: row.api_key_created_at,
        last_used_at: row.last_used_at,
        revoked_at: row.revoked_at
      }),
      user: {
        id: String(row.user_id),
        username: String(row.username),
        ...(row.google_sub ? { googleSub: String(row.google_sub) } : {}),
        ...(row.email ? { email: String(row.email) } : {}),
        ...(row.email_normalized ? { emailNormalized: String(row.email_normalized) } : {}),
        ...(row.display_name ? { displayName: String(row.display_name) } : {}),
        ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
        role: String(row.role) as UserRole,
        disabled: false,
        mustChangePassword: Number(row.must_change_password ?? 0) === 1,
        createdAt: String(row.user_created_at)
      }
    };
  }

  markApiKeyUsed(keyId: string): void {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), keyId);
  }

  upsertSavedLink(userId: string, product: DarazSearchResult): SavedLink {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM saved_links WHERE user_id = ? AND url = ?").get(userId, product.url) as SqlRow | undefined;
    const observed = product.observedPrice ? JSON.stringify(product.observedPrice) : undefined;
    if (existing?.id) {
      this.db.prepare(`
        UPDATE saved_links
        SET title = ?, image_url = ?, observed_price_json = ?, availability = ?, updated_at = ?
        WHERE id = ?
      `).run(product.title, product.imageUrl ?? null, observed ?? null, product.availability ?? null, now, String(existing.id));
      return this.getSavedLink(userId, String(existing.id))!;
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO saved_links (id, user_id, title, url, image_url, observed_price_json, availability, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, product.title, product.url, product.imageUrl ?? null, observed ?? null, product.availability ?? null, now, now);
    return this.getSavedLink(userId, id)!;
  }

  updateSavedLinkProduct(userId: string, product: DarazSearchResult): void {
    const observed = product.observedPrice ? JSON.stringify(product.observedPrice) : undefined;
    this.db.prepare(`
      UPDATE saved_links
      SET title = ?,
          image_url = ?,
          observed_price_json = ?,
          availability = ?,
          updated_at = ?
      WHERE user_id = ? AND url = ?
    `).run(product.title, product.imageUrl ?? null, observed ?? null, product.availability ?? null, new Date().toISOString(), userId, product.url);
  }

  listSavedLinks(userId: string): SavedLink[] {
    return this.db.prepare("SELECT * FROM saved_links WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId)
      .map(mapSavedLink);
  }

  getSavedLink(userId: string, linkId: string): SavedLink | undefined {
    const row = this.db.prepare("SELECT * FROM saved_links WHERE user_id = ? AND id = ?").get(userId, linkId) as SqlRow | undefined;
    return row ? mapSavedLink(row) : undefined;
  }

  getSavedLinkByUrl(userId: string, url: string): SavedLink | undefined {
    const row = this.db.prepare("SELECT * FROM saved_links WHERE user_id = ? AND url = ?").get(userId, url) as SqlRow | undefined;
    return row ? mapSavedLink(row) : undefined;
  }

  deleteSavedLink(userId: string, linkId: string): void {
    this.db.prepare("DELETE FROM saved_links WHERE user_id = ? AND id = ?").run(userId, linkId);
  }

  recordRun(userId: string, result: DarazCheckResult): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO daraz_runs (run_id, user_id, status, started_at, finished_at, summary_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(result.runId, userId, result.status, result.startedAt, result.finishedAt, JSON.stringify(result));
  }

  listRuns(userId: string): RunRecord[] {
    return this.db.prepare("SELECT * FROM daraz_runs WHERE user_id = ? ORDER BY started_at DESC")
      .all(userId)
      .map(mapRunRecord);
  }

  findRun(userId: string, runId: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM daraz_runs WHERE user_id = ? AND run_id = ?").get(userId, runId) as SqlRow | undefined;
    return row ? mapRunRecord(row) : undefined;
  }

  runOwner(runId: string): string | undefined {
    const row = this.db.prepare("SELECT user_id FROM daraz_runs WHERE run_id = ?").get(runId) as SqlRow | undefined;
    return row?.user_id ? String(row.user_id) : undefined;
  }

  saveDarazCredentials(userId: string, username: string, encryptedPassword: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO daraz_credentials (user_id, username, encrypted_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        encrypted_password = excluded.encrypted_password,
        updated_at = excluded.updated_at
    `).run(userId, username, encryptedPassword, now, now);
  }

  getDarazCredentials(userId: string): DarazCredentialRecord | undefined {
    const row = this.db.prepare("SELECT * FROM daraz_credentials WHERE user_id = ?").get(userId) as SqlRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      userId: String(row.user_id),
      username: String(row.username),
      encryptedPassword: String(row.encrypted_password),
      updatedAt: String(row.updated_at)
    };
  }

  deleteDarazCredentials(userId: string): void {
    this.db.prepare("DELETE FROM daraz_credentials WHERE user_id = ?").run(userId);
  }

  getUserSettings(userId: string, defaultProxyCountry = "US"): UserSettings {
    const existing = this.db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(userId) as SqlRow | undefined;
    if (existing) {
      if (!existing.proxy_country_preference) {
        this.db.prepare("UPDATE user_settings SET proxy_country_preference = ?, updated_at = ? WHERE user_id = ?")
          .run(normalizeProxyCountry(defaultProxyCountry), new Date().toISOString(), userId);
        return this.getUserSettings(userId, defaultProxyCountry);
      }
      return mapUserSettings(existing);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_settings (user_id, auto_price_check_enabled, auto_price_check_interval_hours, proxy_country_preference, updated_at)
      VALUES (?, 0, 24, ?, ?)
    `).run(userId, normalizeProxyCountry(defaultProxyCountry), now);
    return this.getUserSettings(userId, defaultProxyCountry);
  }

  updateUserSettings(userId: string, input: {
    autoPriceCheckEnabled?: boolean;
    autoPriceCheckIntervalHours?: number;
    autoPriceCheckNextRunAt?: string | null;
    proxyCountryPreference?: string;
  }): UserSettings {
    const current = this.getUserSettings(userId);
    const now = new Date().toISOString();
    const enabled = input.autoPriceCheckEnabled ?? current.autoPriceCheckEnabled;
    this.db.prepare(`
      UPDATE user_settings
      SET auto_price_check_enabled = ?,
          auto_price_check_interval_hours = ?,
          proxy_country_preference = ?,
          auto_price_check_next_run_at = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(
      enabled ? 1 : 0,
      input.autoPriceCheckIntervalHours ?? current.autoPriceCheckIntervalHours,
      input.proxyCountryPreference ? normalizeProxyCountry(input.proxyCountryPreference) : current.proxyCountryPreference,
      input.autoPriceCheckNextRunAt === undefined ? current.autoPriceCheckNextRunAt ?? null : input.autoPriceCheckNextRunAt,
      now,
      userId
    );
    return this.getUserSettings(userId);
  }

  listDueAutoPriceCheckSettings(nowIso: string): UserSettings[] {
    return this.db.prepare(`
      SELECT user_settings.*
      FROM user_settings
      JOIN users ON users.id = user_settings.user_id
      WHERE user_settings.auto_price_check_enabled = 1
        AND user_settings.auto_price_check_next_run_at IS NOT NULL
        AND user_settings.auto_price_check_next_run_at <= ?
        AND users.disabled = 0
      ORDER BY user_settings.auto_price_check_next_run_at ASC
    `).all(nowIso).map(mapUserSettings);
  }

  markAutoPriceCheckScheduled(userId: string, jobId: string, nextRunAt: string, message: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_settings
      SET auto_price_check_next_run_at = ?,
          auto_price_check_last_job_id = ?,
          auto_price_check_last_status = 'queued',
          auto_price_check_last_message = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(nextRunAt, jobId, message, now, userId);
  }

  markAutoPriceCheckJobFinished(userId: string, job: PriceCheckJob): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE user_settings
      SET auto_price_check_last_run_at = ?,
          auto_price_check_last_job_id = ?,
          auto_price_check_last_status = ?,
          auto_price_check_last_message = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(job.finishedAt ?? now, job.id, job.status, job.message ?? null, now, userId);
  }

  createPriceCheckJob(input: { userId: string; source: PriceCheckJobSource; linkIds?: string[] }): PriceCheckJob {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO price_check_jobs (id, user_id, source, status, link_ids_json, queued_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).run(id, input.userId, input.source, input.linkIds ? JSON.stringify(input.linkIds) : null, now, now);
    return this.getPriceCheckJob(input.userId, id)!;
  }

  listPriceCheckJobs(userId: string, limit = 20): PriceCheckJob[] {
    return this.db.prepare(`
      SELECT * FROM price_check_jobs
      WHERE user_id = ?
      ORDER BY queued_at DESC
      LIMIT ?
    `).all(userId, limit).map(mapPriceCheckJob);
  }

  getPriceCheckJob(userId: string, jobId: string): PriceCheckJob | undefined {
    const row = this.db.prepare("SELECT * FROM price_check_jobs WHERE user_id = ? AND id = ?").get(userId, jobId) as SqlRow | undefined;
    return row ? mapPriceCheckJob(row) : undefined;
  }

  claimNextPriceCheckJob(): PriceCheckJob | undefined {
    const row = this.db.prepare(`
      SELECT price_check_jobs.*
      FROM price_check_jobs
      JOIN users ON users.id = price_check_jobs.user_id
      WHERE price_check_jobs.status = 'queued'
        AND users.disabled = 0
      ORDER BY price_check_jobs.queued_at ASC
      LIMIT 1
    `).get() as SqlRow | undefined;
    if (!row) {
      return undefined;
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE price_check_jobs
      SET status = 'running', started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, now, String(row.id));
    return mapPriceCheckJob({
      ...row,
      status: "running",
      started_at: now,
      updated_at: now
    });
  }

  finishPriceCheckJob(jobId: string, input: {
    status: Exclude<PriceCheckJobStatus, "queued" | "running">;
    runId?: string;
    message?: string;
    session?: unknown;
  }): PriceCheckJob | undefined {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE price_check_jobs
      SET status = ?,
          run_id = ?,
          message = ?,
          session_json = ?,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(input.status, input.runId ?? null, input.message ?? null, input.session ? JSON.stringify(input.session) : null, now, now, jobId);
    const row = this.db.prepare("SELECT * FROM price_check_jobs WHERE id = ?").get(jobId) as SqlRow | undefined;
    return row ? mapPriceCheckJob(row) : undefined;
  }

  requeueRunningPriceCheckJobs(): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE price_check_jobs
      SET status = 'queued',
          started_at = NULL,
          message = 'Requeued after server restart.',
          updated_at = ?
      WHERE status = 'running'
    `).run(now);
  }

  recordProxyEvent(input: {
    operation: string;
    userId?: string;
    apiKeyId?: string;
    apiKeyPrefix?: string;
    source: ProxyEventSource;
    proxyFingerprint: string;
    proxyCountry?: string;
    proxySource?: string;
    proxyPoolType?: string;
    status: ProxyEventStatus;
    elapsedMs?: number;
    errorMessage?: string;
  }): ProxyEventRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO proxy_events (
        id,
        operation,
        user_id,
        api_key_id,
        api_key_prefix,
        source,
        proxy_fingerprint,
        proxy_country,
        proxy_source,
        proxy_pool_type,
        status,
        elapsed_ms,
        error_message,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.operation,
      input.userId ?? null,
      input.apiKeyId ?? null,
      input.apiKeyPrefix ?? null,
      input.source,
      input.proxyFingerprint,
      input.proxyCountry ?? null,
      input.proxySource ?? null,
      input.proxyPoolType ?? null,
      input.status,
      input.elapsedMs ?? null,
      input.errorMessage ? input.errorMessage.slice(0, 500) : null,
      now
    );
    return this.listProxyEvents(1)[0]!;
  }

  listProxyEvents(limit = 50): ProxyEventRecord[] {
    return this.db.prepare(`
      SELECT * FROM proxy_events
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 500))).map(mapProxyEvent);
  }

  proxyEventSummary(): ProxyEventSummary {
    const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM proxy_events").get() as SqlRow;
    const apiKeyRow = this.db.prepare("SELECT COUNT(*) AS count FROM proxy_events WHERE api_key_id IS NOT NULL").get() as SqlRow;
    const lastEvent = this.listProxyEvents(1)[0];
    return {
      total: Number(countRow.count ?? 0),
      apiKeyEvents: Number(apiKeyRow.count ?? 0),
      ...(lastEvent ? { lastEvent } : {}),
      byStatus: this.countProxyEventsBy("status").map((item) => ({ key: item.key as ProxyEventStatus, count: item.count })),
      bySource: this.countProxyEventsBy("source").map((item) => ({ key: item.key as ProxyEventSource, count: item.count })),
      byCountry: this.countProxyEventsBy("proxy_country").map((item) => ({ key: item.key || "unknown", count: item.count }))
    };
  }

  private countProxyEventsBy(column: "status" | "source" | "proxy_country"): Array<{ key: string; count: number }> {
    return this.db.prepare(`
      SELECT COALESCE(${column}, '') AS key, COUNT(*) AS count
      FROM proxy_events
      GROUP BY COALESCE(${column}, '')
      ORDER BY count DESC, key ASC
    `).all().map((row) => {
      const item = row as SqlRow;
      return { key: String(item.key ?? ""), count: Number(item.count ?? 0) };
    });
  }

  createContactMessage(input: { subject: string; content: string }): ContactMessage {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO contact_messages (id, subject, content, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, input.subject, input.content, now);
    return {
      id,
      subject: input.subject,
      content: input.content,
      createdAt: now
    };
  }

  listContactMessages(): ContactMessage[] {
    const rows = this.db.prepare(`
      SELECT id, subject, content, created_at
      FROM contact_messages
      ORDER BY created_at DESC
    `).all() as SqlRow[];
    return rows.map((row) => ({
      id: String(row.id),
      subject: String(row.subject),
      content: String(row.content),
      createdAt: String(row.created_at)
    }));
  }

  deleteContactMessage(id: string): void {
    this.db.prepare(`DELETE FROM contact_messages WHERE id = ?`).run(id);
  }

  listAdminUserIds(): string[] {
    const rows = this.db.prepare(`
      SELECT id FROM users WHERE role = 'admin' AND disabled = 0
    `).all() as SqlRow[];
    return rows.map((row) => String(row.id));
  }

  createNotification(input: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    relatedJobId?: string;
  }): AppNotification {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO notifications (id, user_id, kind, title, body, related_job_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.userId, input.kind, input.title, input.body, input.relatedJobId ?? null, now);
    return {
      id,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      createdAt: now,
      ...(input.relatedJobId ? { relatedJobId: input.relatedJobId } : {})
    };
  }

  listNotifications(userId: string, limit = 30): AppNotification[] {
    const rows = this.db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as SqlRow[];
    return rows.map(mapNotification);
  }

  unreadNotificationCount(userId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `).get(userId) as SqlRow;
    return Number(row.count ?? 0);
  }

  markNotificationRead(userId: string, notificationId: string): AppNotification | undefined {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE notifications
      SET read_at = ?
      WHERE id = ? AND user_id = ? AND read_at IS NULL
    `).run(now, notificationId, userId);
    const row = this.db.prepare(`
      SELECT * FROM notifications WHERE id = ? AND user_id = ?
    `).get(notificationId, userId) as SqlRow | undefined;
    return row ? mapNotification(row) : undefined;
  }

  markAllNotificationsRead(userId: string): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notifications
      SET read_at = ?
      WHERE user_id = ? AND read_at IS NULL
    `).run(now, userId);
    return Number(result.changes ?? 0);
  }

  listNotificationChannels(userId: string): NotificationChannelRecord[] {
    return this.db.prepare(`
      SELECT * FROM notification_channels
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId).map(mapNotificationChannelRecord);
  }

  listEnabledNotificationChannels(userId: string): NotificationChannelRecord[] {
    return this.db.prepare(`
      SELECT * FROM notification_channels
      WHERE user_id = ? AND enabled = 1
      ORDER BY created_at DESC
    `).all(userId).map(mapNotificationChannelRecord);
  }

  getNotificationChannel(userId: string, channelId: string): NotificationChannelRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM notification_channels WHERE user_id = ? AND id = ?
    `).get(userId, channelId) as SqlRow | undefined;
    return row ? mapNotificationChannelRecord(row) : undefined;
  }

  createNotificationChannel(input: {
    userId: string;
    platform: NotificationPlatform;
    label?: string;
    encryptedConfig: string;
    enabled?: boolean;
  }): NotificationChannelRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO notification_channels (
        id, user_id, platform, label, enabled, encrypted_config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      input.platform,
      input.label ?? null,
      input.enabled === false ? 0 : 1,
      input.encryptedConfig,
      now,
      now
    );
    return this.getNotificationChannel(input.userId, id)!;
  }

  updateNotificationChannel(userId: string, channelId: string, input: {
    label?: string | null;
    enabled?: boolean;
    encryptedConfig?: string;
    lastDeliveryAt?: string | null;
    lastError?: string | null;
  }): NotificationChannelRecord | undefined {
    const current = this.getNotificationChannel(userId, channelId);
    if (!current) {
      return undefined;
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE notification_channels
      SET label = ?,
          enabled = ?,
          encrypted_config = ?,
          last_delivery_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.label === undefined ? current.label ?? null : input.label,
      input.enabled === undefined ? (current.enabled ? 1 : 0) : (input.enabled ? 1 : 0),
      input.encryptedConfig ?? current.encryptedConfig,
      input.lastDeliveryAt === undefined ? current.lastDeliveryAt ?? null : input.lastDeliveryAt,
      input.lastError === undefined ? current.lastError ?? null : input.lastError,
      now,
      channelId,
      userId
    );
    return this.getNotificationChannel(userId, channelId);
  }

  touchNotificationChannelDelivery(channelId: string, input: {
    lastDeliveryAt?: string;
    lastError?: string | null;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE notification_channels
      SET last_delivery_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.lastDeliveryAt ?? now,
      input.lastError ?? null,
      now,
      channelId
    );
  }

  deleteNotificationChannel(userId: string, channelId: string): void {
    this.db.prepare(`DELETE FROM notification_channels WHERE user_id = ? AND id = ?`).run(userId, channelId);
  }

  private addColumnIfMissing(table: "users" | "user_settings", name: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === name)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function savedLinkToProduct(link: SavedLink): DarazSearchResult {
  return {
    id: link.id,
    title: link.title,
    url: link.url,
    ...(link.imageUrl ? { imageUrl: link.imageUrl } : {}),
    ...(link.observedPriceJson ? { observedPrice: JSON.parse(link.observedPriceJson) as DarazSearchResult["observedPrice"] } : {}),
    ...(link.availability ? { availability: link.availability } : {})
  };
}

export function normalizeApiKeyScopes(scopes: ApiKeyScope[]): ApiKeyScope[] {
  const allowed = new Set<ApiKeyScope>(["rest", "mcp"]);
  const normalized = Array.from(new Set(scopes.filter((scope): scope is ApiKeyScope => allowed.has(scope))));
  if (normalized.length === 0) {
    throw new Error("Select at least one API key scope.");
  }
  return normalized;
}

function normalizeProxyCountry(country: string): string {
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "US";
}

function mapUser(row: SqlRow): AppUser {
  return {
    id: String(row.id),
    username: String(row.username),
    ...(row.google_sub ? { googleSub: String(row.google_sub) } : {}),
    ...(row.email ? { email: String(row.email) } : {}),
    ...(row.email_normalized ? { emailNormalized: String(row.email_normalized) } : {}),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    ...(row.avatar_url ? { avatarUrl: String(row.avatar_url) } : {}),
    role: String(row.role) as UserRole,
    disabled: Number(row.disabled ?? 0) === 1,
    mustChangePassword: Number(row.must_change_password ?? 0) === 1,
    createdAt: String(row.created_at)
  };
}

function mapUserWithPassword(row: SqlRow): UserWithPassword {
  return {
    ...mapUser(row),
    passwordHash: String(row.password_hash)
  };
}

function mapApiKey(row: SqlRow): ApiKeyRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    tokenHash: String(row.token_hash),
    tokenPrefix: String(row.token_prefix),
    scopes: normalizeApiKeyScopes(JSON.parse(String(row.scopes_json)) as ApiKeyScope[]),
    createdAt: String(row.created_at),
    ...(row.last_used_at ? { lastUsedAt: String(row.last_used_at) } : {}),
    ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {})
  };
}

function mapSavedLink(row: SqlRow): SavedLink {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    url: String(row.url),
    ...(row.image_url ? { imageUrl: String(row.image_url) } : {}),
    ...(row.observed_price_json ? { observedPriceJson: String(row.observed_price_json) } : {}),
    ...(row.availability ? { availability: String(row.availability) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRunRecord(row: SqlRow): RunRecord {
  return {
    runId: String(row.run_id),
    userId: String(row.user_id),
    status: String(row.status),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
    summaryJson: String(row.summary_json)
  };
}

function mapUserSettings(row: SqlRow): UserSettings {
  return {
    userId: String(row.user_id),
    autoPriceCheckEnabled: Number(row.auto_price_check_enabled ?? 0) === 1,
    autoPriceCheckIntervalHours: Number(row.auto_price_check_interval_hours ?? 24),
    proxyCountryPreference: normalizeProxyCountry(String(row.proxy_country_preference ?? "US")),
    ...(row.auto_price_check_next_run_at ? { autoPriceCheckNextRunAt: String(row.auto_price_check_next_run_at) } : {}),
    ...(row.auto_price_check_last_run_at ? { autoPriceCheckLastRunAt: String(row.auto_price_check_last_run_at) } : {}),
    ...(row.auto_price_check_last_job_id ? { autoPriceCheckLastJobId: String(row.auto_price_check_last_job_id) } : {}),
    ...(row.auto_price_check_last_status ? { autoPriceCheckLastStatus: String(row.auto_price_check_last_status) as PriceCheckJobStatus } : {}),
    ...(row.auto_price_check_last_message ? { autoPriceCheckLastMessage: String(row.auto_price_check_last_message) } : {}),
    updatedAt: String(row.updated_at)
  };
}

function mapProxyEvent(row: SqlRow): ProxyEventRecord {
  return {
    id: String(row.id),
    operation: String(row.operation),
    ...(row.user_id ? { userId: String(row.user_id) } : {}),
    ...(row.api_key_id ? { apiKeyId: String(row.api_key_id) } : {}),
    ...(row.api_key_prefix ? { apiKeyPrefix: String(row.api_key_prefix) } : {}),
    source: String(row.source) as ProxyEventSource,
    proxyFingerprint: String(row.proxy_fingerprint),
    ...(row.proxy_country ? { proxyCountry: String(row.proxy_country) } : {}),
    ...(row.proxy_source ? { proxySource: String(row.proxy_source) } : {}),
    ...(row.proxy_pool_type ? { proxyPoolType: String(row.proxy_pool_type) } : {}),
    status: String(row.status) as ProxyEventStatus,
    ...(row.elapsed_ms !== null && row.elapsed_ms !== undefined ? { elapsedMs: Number(row.elapsed_ms) } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    createdAt: String(row.created_at)
  };
}

function mapNotificationChannelRecord(row: SqlRow): NotificationChannelRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform: String(row.platform) as NotificationPlatform,
    ...(row.label ? { label: String(row.label) } : {}),
    enabled: Number(row.enabled ?? 1) === 1,
    encryptedConfig: String(row.encrypted_config),
    ...(row.last_delivery_at ? { lastDeliveryAt: String(row.last_delivery_at) } : {}),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapNotification(row: SqlRow): AppNotification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: String(row.kind) as NotificationKind,
    title: String(row.title),
    body: String(row.body),
    createdAt: String(row.created_at),
    ...(row.read_at ? { readAt: String(row.read_at) } : {}),
    ...(row.related_job_id ? { relatedJobId: String(row.related_job_id) } : {})
  };
}

function mapPriceCheckJob(row: SqlRow): PriceCheckJob {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    source: String(row.source) as PriceCheckJobSource,
    status: String(row.status) as PriceCheckJobStatus,
    ...(row.link_ids_json ? { linkIds: JSON.parse(String(row.link_ids_json)) as string[] } : {}),
    ...(row.run_id ? { runId: String(row.run_id) } : {}),
    ...(row.message ? { message: String(row.message) } : {}),
    ...(row.session_json ? { sessionJson: String(row.session_json) } : {}),
    queuedAt: String(row.queued_at),
    ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
    ...(row.finished_at ? { finishedAt: String(row.finished_at) } : {}),
    updatedAt: String(row.updated_at)
  };
}
