import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyProjectEnvFiles, adjustLocalDevPublicUrls, loadProjectEnvFiles, readDotEnvFile, resolveRuntimeEnvValue, isLocalDevOrigin } from "../apps/web/src/env.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("project env files", () => {
  it("reads quoted and unquoted dotenv values", () => {
    const dir = mkdtempSync(join(tmpdir(), "carttruth-env-"));
    const path = join(dir, ".env");
    writeFileSync(path, [
      "# comment",
      "CARTTRUTH_GOOGLE_CLIENT_ID=client-id",
      'CARTTRUTH_GOOGLE_CLIENT_SECRET="client-secret"',
      ""
    ].join("\n"));

    expect(readDotEnvFile(path)).toEqual({
      CARTTRUTH_GOOGLE_CLIENT_ID: "client-id",
      CARTTRUTH_GOOGLE_CLIENT_SECRET: "client-secret"
    });
  });

  it("merges .env then .env.local with local overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "carttruth-env-"));
    writeFileSync(join(dir, ".env"), "CARTTRUTH_GOOGLE_CLIENT_ID=from-env\nCARTTRUTH_LOG_LEVEL=info\n");
    writeFileSync(join(dir, ".env.local"), "CARTTRUTH_GOOGLE_CLIENT_ID=from-local\n");

    expect(loadProjectEnvFiles(dir)).toEqual({
      CARTTRUTH_GOOGLE_CLIENT_ID: "from-local",
      CARTTRUTH_LOG_LEVEL: "info"
    });
  });

  it("applies project env files without overriding existing process env", () => {
    const dir = mkdtempSync(join(tmpdir(), "carttruth-env-"));
    writeFileSync(join(dir, ".env.local"), [
      "CARTTRUTH_GOOGLE_CLIENT_ID=local-client-id",
      "CARTTRUTH_GOOGLE_CLIENT_SECRET=local-client-secret"
    ].join("\n"));

    delete process.env.CARTTRUTH_GOOGLE_CLIENT_ID;
    delete process.env.CARTTRUTH_GOOGLE_CLIENT_SECRET;
    process.env.CARTTRUTH_LOG_LEVEL = "warn";

    applyProjectEnvFiles(dir);

    expect(process.env.CARTTRUTH_GOOGLE_CLIENT_ID).toBe("local-client-id");
    expect(process.env.CARTTRUTH_GOOGLE_CLIENT_SECRET).toBe("local-client-secret");
    expect(process.env.CARTTRUTH_LOG_LEVEL).toBe("warn");
  });

  it("maps docker /data paths to local defaults outside docker", () => {
    expect(resolveRuntimeEnvValue("CARTTRUTH_SQLITE_PATH", "/data/carttruth.db")).toBe(".carttruth/carttruth.db");
    expect(resolveRuntimeEnvValue("CARTTRUTH_SESSIONS_DIR", "/data/sessions")).toBe(".carttruth/sessions");
    expect(resolveRuntimeEnvValue("CARTTRUTH_RUNS_DIR", "/data/runs")).toBe("runs");
    expect(resolveRuntimeEnvValue("CARTTRUTH_PUBLIC_URL", "https://carttruth.knurdz.org")).toBe("https://carttruth.knurdz.org");
  });

  it("rewrites production public urls to localhost outside docker", () => {
    process.env.CARTTRUTH_PUBLIC_URL = "https://carttruth.knurdz.org";
    process.env.CARTTRUTH_GOOGLE_REDIRECT_URI = "https://carttruth.knurdz.org/api/auth/google/callback";

    adjustLocalDevPublicUrls(5173);

    expect(process.env.CARTTRUTH_PUBLIC_URL).toBe("http://localhost:5173");
    expect(process.env.CARTTRUTH_GOOGLE_REDIRECT_URI).toBe("http://localhost:5173/api/auth/google/callback");
    expect(isLocalDevOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalDevOrigin("https://carttruth.knurdz.org")).toBe(false);
  });
});
