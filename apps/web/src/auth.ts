import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";

const scrypt = promisify(scryptCallback);
const SESSION_BYTES = 32;
const API_KEY_BYTES = 32;
const PASSWORD_KEY_BYTES = 64;
const OAUTH_BYTES = 32;
const OAUTH_MAX_AGE_SECONDS = 10 * 60;

export type UserRole = "admin" | "user";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface GoogleOAuthClient {
  authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string;
  verifyCallback(input: { code: string; nonce: string; redirectUri: string }): Promise<GoogleIdentity>;
}

export interface SessionCookie {
  token: string;
  hash: string;
  expiresAt: string;
}

export function newSessionCookie(days = 14): SessionCookie {
  const token = randomBytes(SESSION_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return {
    token,
    hash: hashSessionToken(token),
    expiresAt
  };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newApiKeyToken(): { token: string; hash: string; prefix: string } {
  const token = `ct_${randomBytes(API_KEY_BYTES).toString("base64url")}`;
  return {
    token,
    hash: hashApiKeyToken(token),
    prefix: apiKeyPrefix(token)
  };
}

export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function apiKeyPrefix(token: string): string {
  return token.slice(0, 12);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, PASSWORD_KEY_BYTES) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, encoded] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !encoded) {
    return false;
  }
  const expected = Buffer.from(encoded, "base64url");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function serializeSessionCookie(token: string, expiresAt: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `carttruth_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie(): string {
  return "carttruth_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return undefined;
}

export function newOAuthCookieValue(): string {
  return randomBytes(OAUTH_BYTES).toString("base64url");
}

export function serializeOAuthCookie(name: string, value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_MAX_AGE_SECONDS}${secure}`;
}

export function clearOAuthCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function safeEqualString(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function googleRedirectUri(env = process.env): string {
  if (env.CARTTRUTH_GOOGLE_REDIRECT_URI) {
    return env.CARTTRUTH_GOOGLE_REDIRECT_URI;
  }
  const publicUrl = env.CARTTRUTH_PUBLIC_URL ?? `http://localhost:${env.PORT ?? "5173"}`;
  return `${publicUrl.replace(/\/+$/, "")}/api/auth/google/callback`;
}

export function googleAdminEmails(env = process.env): Set<string> {
  return new Set((env.CARTTRUTH_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function roleForGoogleEmail(email: string, env = process.env): UserRole {
  return googleAdminEmails(env).has(email.trim().toLowerCase()) ? "admin" : "user";
}

export function createGoogleOAuthClientFromEnv(env = process.env): GoogleOAuthClient {
  const clientId = env.CARTTRUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.CARTTRUTH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured. Set CARTTRUTH_GOOGLE_CLIENT_ID and CARTTRUTH_GOOGLE_CLIENT_SECRET.");
  }
  return new GoogleOAuthClientImpl(clientId, clientSecret);
}

export function encryptSecret(value: string, keyMaterial = process.env.CARTTRUTH_ENCRYPTION_KEY): string {
  const key = encryptionKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string, keyMaterial = process.env.CARTTRUTH_ENCRYPTION_KEY): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyMaterial), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey(keyMaterial: string | undefined): Buffer {
  if (!keyMaterial) {
    throw new Error("CARTTRUTH_ENCRYPTION_KEY is required to store Daraz credentials.");
  }
  return createHash("sha256").update(keyMaterial).digest();
}

class GoogleOAuthClientImpl implements GoogleOAuthClient {
  constructor(private readonly clientId: string, private readonly clientSecret: string) {}

  authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string {
    return this.client(input.redirectUri).generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state: input.state,
      nonce: input.nonce,
      access_type: "online"
    });
  }

  async verifyCallback(input: { code: string; nonce: string; redirectUri: string }): Promise<GoogleIdentity> {
    const client = this.client(input.redirectUri);
    const { tokens } = await client.getToken(input.code);
    if (!tokens.id_token) {
      throw new Error("Google did not return an ID token.");
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId
    });
    const payload = ticket.getPayload() as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
      nonce?: string;
    } | undefined;
    if (!payload?.sub || !payload.email) {
      throw new Error("Google did not return the required user identity.");
    }
    if (!safeEqualString(payload.nonce, input.nonce)) {
      throw new Error("Google sign-in nonce did not match.");
    }
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    if (!emailVerified) {
      throw new Error("Google email is not verified.");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified,
      ...(payload.name ? { displayName: payload.name } : {}),
      ...(payload.picture ? { avatarUrl: payload.picture } : {})
    };
  }

  private client(redirectUri: string): OAuth2Client {
    return new OAuth2Client(this.clientId, this.clientSecret, redirectUri);
  }
}
