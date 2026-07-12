import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ENV_FILES = [".env", ".env.local"] as const;
const DOCKER_DATA_PATH_KEYS = [
  "CARTTRUTH_SQLITE_PATH",
  "CARTTRUTH_SESSIONS_DIR",
  "CARTTRUTH_RUNS_DIR"
] as const;
const LOCAL_DATA_PATH_DEFAULTS: Record<(typeof DOCKER_DATA_PATH_KEYS)[number], string> = {
  CARTTRUTH_SQLITE_PATH: ".carttruth/carttruth.db",
  CARTTRUTH_SESSIONS_DIR: ".carttruth/sessions",
  CARTTRUTH_RUNS_DIR: "runs"
};

export function readDotEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match?.[1]) {
      continue;
    }
    values[match[1]] = unquoteEnvValue(match[2] ?? "");
  }
  return values;
}

export function loadProjectEnvFiles(cwd = process.cwd()): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const filename of PROJECT_ENV_FILES) {
    Object.assign(merged, readDotEnvFile(resolve(cwd, filename)));
  }
  return merged;
}

export function loadProjectEnv(cwd = process.cwd()): Record<string, string | undefined> {
  return {
    ...loadProjectEnvFiles(cwd),
    ...process.env
  };
}

export function applyProjectEnvFiles(cwd = process.cwd()): void {
  for (const [key, value] of Object.entries(loadProjectEnvFiles(cwd))) {
    if (process.env[key] === undefined) {
      process.env[key] = resolveRuntimeEnvValue(key, value);
    }
  }
}

export function resolveRuntimeEnvValue(key: string, value: string): string {
  if (!isDockerDataPathKey(key) || !value.startsWith("/data/")) {
    return value;
  }
  if (isDockerRuntime()) {
    return value;
  }
  return LOCAL_DATA_PATH_DEFAULTS[key];
}

export function adjustLocalDevPublicUrls(port: number): void {
  if (isDockerRuntime()) {
    return;
  }

  const localOrigin = `http://localhost:${port}`;
  const publicUrl = process.env.CARTTRUTH_PUBLIC_URL?.trim();

  if (!publicUrl || !isLocalDevOrigin(publicUrl)) {
    process.env.CARTTRUTH_PUBLIC_URL = localOrigin;
  }

  const redirectUri = process.env.CARTTRUTH_GOOGLE_REDIRECT_URI?.trim();
  const expectedRedirectUri = `${process.env.CARTTRUTH_PUBLIC_URL}/api/auth/google/callback`;
  if (!redirectUri || !isLocalDevOrigin(redirectUri)) {
    process.env.CARTTRUTH_GOOGLE_REDIRECT_URI = expectedRedirectUri;
  }
}

export function isLocalDevOrigin(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function isDockerDataPathKey(key: string): key is (typeof DOCKER_DATA_PATH_KEYS)[number] {
  return (DOCKER_DATA_PATH_KEYS as readonly string[]).includes(key);
}

function isDockerRuntime(): boolean {
  return existsSync("/.dockerenv") || existsSync("/data");
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
