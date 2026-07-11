import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/web/src/api.js";
import { LocalRuntime, type DarazSessionCaptureManager } from "../apps/web/src/runtime.js";
import { parseProxyString } from "@carttruth/core";
import type { DarazCheckRequest, DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";

let server: Server;
let baseUrl: string;
let runsDir: string;
let sessionsDir: string;
let sqlitePath: string;
let runtime: LocalRuntime;
let cookie = "";

const fakeSearchResult: DarazSearchResult = {
  id: "item-1",
  title: "Sample Daraz Product",
  url: "https://www.daraz.lk/products/sample-i1-s1.html",
  observedPrice: { currency: "LKR", minorUnits: 123400 },
  availability: "available"
};

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "daraz-api-"));
  sessionsDir = await mkdtemp(join(tmpdir(), "daraz-api-sessions-"));
  const dbDir = await mkdtemp(join(tmpdir(), "daraz-api-db-"));
  sqlitePath = join(dbDir, "carttruth.db");
  runtime = new LocalRuntime({
    runsDir,
    sessionsDir,
    sqlitePath,
    proxyProfile: parseProxyString("http://user_abc:secret@proxy.example:61234", {
      id: "torch-isp-trial",
      poolType: "isp",
      country: "US",
      source: "torchproxies"
    }),
    darazService: {
      async search() {
        return [fakeSearchResult];
      },
      async productFromUrl() {
        return fakeSearchResult;
      },
      async check(request: DarazCheckRequest) {
        return {
          runId: "daraz-test-run",
          status: "checked",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          products: request.products.map((product) => ({
            title: product.title,
            url: product.url,
            quantity: product.quantity,
            observedPrice: product.observedPrice,
            checkoutUnitPrice: product.observedPrice,
            checkoutLinePrice: product.observedPrice,
            breakdown: [],
            status: "checked"
          })),
          priceBreakdown: [],
          globalAdjustments: [],
          evidence: []
        } satisfies DarazCheckResult;
      }
    },
    sessionCapture: new FakeDarazSessionCapture()
  });
  process.env.CARTTRUTH_ADMIN_USERNAME = "admin";
  process.env.CARTTRUTH_ADMIN_PASSWORD = "password123";
  process.env.CARTTRUTH_ENCRYPTION_KEY = "test-encryption-key";
  await runtime.bootstrap();
  server = createServer(createApiApp(runtime));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  cookie = await login();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.close();
  await rm(runsDir, { recursive: true, force: true });
  await rm(sessionsDir, { recursive: true, force: true });
  await rm(join(sqlitePath, ".."), { recursive: true, force: true });
  delete process.env.CARTTRUTH_ADMIN_USERNAME;
  delete process.env.CARTTRUTH_ADMIN_PASSWORD;
  delete process.env.CARTTRUTH_ENCRYPTION_KEY;
  cookie = "";
});

describe("Daraz API", () => {
  it("reports masked proxy status in health", async () => {
    const response = await get("/api/health");
    expect(response.proxy).toEqual(expect.objectContaining({
      enabled: true,
      id: "torch-isp-trial",
      masked: "http://user_abc:***@proxy.example:61234"
    }));
    expect(JSON.stringify(response.proxy)).not.toContain("secret");
  });

  it("searches products", async () => {
    const response = await post("/api/daraz/search", { query: "phone" });
    expect(response.results[0].title).toBe("Sample Daraz Product");
  });

  it("adds a product from a pasted link", async () => {
    const response = await post("/api/daraz/product", { url: "https://www.daraz.lk/products/sample-i1-s1.html?pvid=test" });
    expect(response.product.title).toBe("Sample Daraz Product");
  });

  it("checks selected products", async () => {
    const response = await post("/api/daraz/check", { products: [{ ...fakeSearchResult, quantity: 5 }] });
    expect(response.status).toBe("checked");
    expect(response.products[0].quantity).toBe(1);
    expect(response.products[0].checkoutLinePrice.minorUnits).toBe(123400);
  });

  it("supports session start/save", async () => {
    const started = await post("/api/daraz/session/start", {});
    expect(started.captureId).toBe("fake-daraz-capture");
    expect(started.profilePath).toContain("default-profile");
    expect(started.browserUrl).toBe("/vnc/fake-token/vnc.html");
    const saved = await post("/api/daraz/session/save", { captureId: started.captureId });
    expect(saved.exists).toBe(true);
  });

  it("repairs a stale Daraz browser profile lock for the current user", async () => {
    const started = await post("/api/daraz/session/start", {});
    await mkdir(started.profilePath, { recursive: true });
    const lockPath = join(started.profilePath, "SingletonLock");
    await writeFile(lockPath, "stale", "utf8");

    const repaired = await post("/api/daraz/session/repair", {});

    expect(repaired.repair.reason).toBe("stale_lock_removed");
    expect(repaired.repair.removedFiles).toContain("SingletonLock");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("requires Daraz credentials or a saved session before saving product links", async () => {
    const response = await post("/api/links", { url: "https://www.daraz.lk/products/sample-i1-s1.html" });
    expect(response.error).toBe("Add your Daraz email/phone and password before saving products.");
  });

  it("saves a product link with credentials, then checks that one link", async () => {
    const credentials = await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });
    expect(credentials.saved).toBe(true);
    expect(JSON.stringify(credentials)).not.toContain("daraz-password");

    const created = await post("/api/links", { url: "https://www.daraz.lk/products/sample-i1-s1.html" });
    expect(created.link.title).toBe("Sample Daraz Product");
    expect(created.autoCheck).toBeUndefined();

    const checked = await post("/api/links/check", { linkIds: [created.link.id] });
    expect(checked.status).toBe("checked");
    expect(checked.products).toHaveLength(1);
    expect(checked.products[0].url).toBe(fakeSearchResult.url);
  });

  it("lists and reads Daraz runs", async () => {
    await post("/api/daraz/check", { products: [{ ...fakeSearchResult, quantity: 1 }] });

    const runs = await get("/api/daraz/runs");
    expect(runs.some((run: { runId: string }) => run.runId === "daraz-test-run")).toBe(true);
    const detail = await get("/api/daraz/runs/daraz-test-run");
    expect(detail.runId).toBe("daraz-test-run");
  });

  it("requires login for protected Daraz endpoints", async () => {
    const previous = cookie;
    cookie = "";
    const response = await post("/api/daraz/search", { query: "phone" });
    expect(response.error).toBe("Login required.");
    cookie = previous;
  });
});

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : {}
  });
  return response.json();
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function login(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password123" })
  });
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login did not set a cookie");
  }
  return setCookie.split(";")[0] ?? "";
}

class FakeDarazSessionCapture implements DarazSessionCaptureManager {
  async start(_userId: string, profilePath: string) {
    return {
      captureId: "fake-daraz-capture",
      loginUrl: "https://member.daraz.lk/user/login",
      profilePath,
      storagePath: profilePath,
      browserUrl: "/vnc/fake-token/vnc.html"
    };
  }

  async save(_userId: string, captureId: string) {
    return {
      captureId,
      profilePath: "/tmp/daraz-profile",
      storagePath: "/tmp/daraz-profile",
      exists: true,
      session: { status: "saved" as const, live: true, captureId }
    };
  }

  activeCapture(_userId: string) {
    return undefined;
  }

  activeContext(_userId: string) {
    return undefined;
  }

  async reset(_userId: string) {}

  async close() {}
}
