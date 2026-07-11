import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const SECRET_KEY = /password|secret|token|cookie|authorization|credential/i;

export function createLogger(options: { level?: string; base?: LogFields } = {}): Logger {
  const configured = normalizeLevel(options.level ?? process.env.CARTTRUTH_LOG_LEVEL ?? "info");
  return new JsonLogger(configured, options.base ?? {});
}

export function requestId(): string {
  return randomUUID().slice(0, 12);
}

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = SECRET_KEY.test(key) ? "[redacted]" : redactForLog(nested);
    }
    return redacted;
  }
  if (typeof value === "string" && /:\/\/[^/\s:]+:[^@\s]+@/.test(value)) {
    return value.replace(/:\/\/([^/\s:]+):([^@\s]+)@/g, "://$1:***@");
  }
  return value;
}

class JsonLogger implements Logger {
  constructor(private readonly level: LogLevel, private readonly base: LogFields) {}

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  child(fields: LogFields): Logger {
    return new JsonLogger(this.level, { ...this.base, ...fields });
  }

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVELS[level] < LEVELS[this.level]) {
      return;
    }
    const payload = redactForLog({
      time: new Date().toISOString(),
      level,
      message,
      ...this.base,
      ...fields
    });
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

function normalizeLevel(level: string): LogLevel {
  return level === "debug" || level === "warn" || level === "error" ? level : "info";
}
