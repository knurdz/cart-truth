import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";
import { hashSessionToken, type UserRole } from "./auth.js";

export interface AppUser {
  id: string;
  username: string;
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

  listUsers(): AppUser[] {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(mapUser);
  }

  findUserByUsername(username: string): UserWithPassword | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(username) as SqlRow | undefined;
    return row ? mapUserWithPassword(row) : undefined;
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
