import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";
import { hashSessionToken, type UserRole } from "./auth.js";

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
    `);
    this.addUserColumnIfMissing("google_sub", "TEXT");
    this.addUserColumnIfMissing("email", "TEXT");
    this.addUserColumnIfMissing("email_normalized", "TEXT");
    this.addUserColumnIfMissing("display_name", "TEXT");
    this.addUserColumnIfMissing("avatar_url", "TEXT");
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

  getUserSettings(userId: string): UserSettings {
    const existing = this.db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(userId) as SqlRow | undefined;
    if (existing) {
      return mapUserSettings(existing);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_settings (user_id, auto_price_check_enabled, auto_price_check_interval_hours, updated_at)
      VALUES (?, 0, 24, ?)
    `).run(userId, now);
    return this.getUserSettings(userId);
  }

  updateUserSettings(userId: string, input: {
    autoPriceCheckEnabled?: boolean;
    autoPriceCheckIntervalHours?: number;
    autoPriceCheckNextRunAt?: string | null;
  }): UserSettings {
    const current = this.getUserSettings(userId);
    const now = new Date().toISOString();
    const enabled = input.autoPriceCheckEnabled ?? current.autoPriceCheckEnabled;
    this.db.prepare(`
      UPDATE user_settings
      SET auto_price_check_enabled = ?,
          auto_price_check_interval_hours = ?,
          auto_price_check_next_run_at = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(
      enabled ? 1 : 0,
      input.autoPriceCheckIntervalHours ?? current.autoPriceCheckIntervalHours,
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

  private addUserColumnIfMissing(name: string, type: string): void {
    const columns = this.db.prepare("PRAGMA table_info(users)").all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === name)) {
      return;
    }
    this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
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
    ...(row.auto_price_check_next_run_at ? { autoPriceCheckNextRunAt: String(row.auto_price_check_next_run_at) } : {}),
    ...(row.auto_price_check_last_run_at ? { autoPriceCheckLastRunAt: String(row.auto_price_check_last_run_at) } : {}),
    ...(row.auto_price_check_last_job_id ? { autoPriceCheckLastJobId: String(row.auto_price_check_last_job_id) } : {}),
    ...(row.auto_price_check_last_status ? { autoPriceCheckLastStatus: String(row.auto_price_check_last_status) as PriceCheckJobStatus } : {}),
    ...(row.auto_price_check_last_message ? { autoPriceCheckLastMessage: String(row.auto_price_check_last_message) } : {}),
    updatedAt: String(row.updated_at)
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
