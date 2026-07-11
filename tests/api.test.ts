import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/web/src/api.js";
import { LocalRuntime, nextScheduledPriceCheckAt, type DarazAutoLoginAttempt, type DarazSessionCaptureManager } from "../apps/web/src/runtime.js";
import type { GoogleIdentity, GoogleOAuthClient } from "../apps/web/src/auth.js";
import { parseProxyString } from "@carttruth/core";
import type { DarazCheckRequest, DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";

let server: Server;
let baseUrl: string;
let runsDir: string;
let sessionsDir: string;
let sqlitePath: string;
let runtime: LocalRuntime;
let sessionCapture: FakeDarazSessionCapture;
let fakeGoogle: FakeGoogleOAuthClient;
let cookie = "";

const oauthStateCookie = "carttruth_oauth_state";
const oauthNonceCookie = "carttruth_oauth_nonce";

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
  sessionCapture = new FakeDarazSessionCapture();
  fakeGoogle = new FakeGoogleOAuthClient();
  process.env.CARTTRUTH_GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.CARTTRUTH_GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.CARTTRUTH_GOOGLE_REDIRECT_URI = "http://127.0.0.1/api/auth/google/callback";
  process.env.CARTTRUTH_ADMIN_EMAILS = "admin@example.com";
  process.env.CARTTRUTH_ENCRYPTION_KEY = "test-encryption-key";
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
    sessionCapture,
    googleOAuth: fakeGoogle
  });
  await runtime.bootstrap();
  server = createServer(createApiApp(runtime));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  cookie = await loginWithGoogle();
  fakeGoogle.callbackInputs = [];
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.close();
  await rm(runsDir, { recursive: true, force: true });
  await rm(sessionsDir, { recursive: true, force: true });
  await rm(join(sqlitePath, ".."), { recursive: true, force: true });
  delete process.env.CARTTRUTH_GOOGLE_CLIENT_ID;
  delete process.env.CARTTRUTH_GOOGLE_CLIENT_SECRET;
  delete process.env.CARTTRUTH_GOOGLE_REDIRECT_URI;
  delete process.env.CARTTRUTH_ADMIN_EMAILS;
  delete process.env.CARTTRUTH_ENCRYPTION_KEY;
  cookie = "";
});

describe("Google auth", () => {
  it("starts Google sign-in with state and nonce cookies", async () => {
    const started = await startGoogle();

    expect(started.response.status).toBe(302);
    expect(started.response.headers.get("location")).toContain("https://google.example.test/oauth");
    expect(started.state).toBeTruthy();
    expect(started.nonce).toBeTruthy();
    expect(fakeGoogle.lastAuthorization?.redirectUri).toBe("http://127.0.0.1/api/auth/google/callback");
  });

  it("rejects callback state mismatches", async () => {
    const started = await startGoogle();

    const response = await fetch(`${baseUrl}/api/auth/google/callback?code=fake-code&state=wrong-state`, {
      headers: { cookie: started.requestCookie },
      redirect: "manual"
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid Google sign-in state.");
    expect(fakeGoogle.callbackInputs).toHaveLength(0);
  });

  it("rejects missing Google ID tokens", async () => {
    fakeGoogle.error = new Error("Google did not return an ID token.");
    const started = await startGoogle();

    const response = await fetch(`${baseUrl}/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(started.state)}`, {
      headers: { cookie: started.requestCookie },
      redirect: "manual"
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Google did not return an ID token.");
  });

  it("rejects unverified Google emails", async () => {
    fakeGoogle.identity = {
      sub: "unverified-sub",
      email: "unverified@example.com",
      emailVerified: false
    };
    const started = await startGoogle();

    const response = await fetch(`${baseUrl}/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(started.state)}`, {
      headers: { cookie: started.requestCookie },
      redirect: "manual"
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe("Google email is not verified.");
  });

  it("creates normal users for any verified Google email", async () => {
    const normalCookie = await loginWithGoogle({
      sub: "buyer-sub",
      email: "buyer@example.com",
      emailVerified: true,
      displayName: "Buyer Example"
    });
    const previous = cookie;
    cookie = normalCookie;

    const response = await get("/api/auth/me");

    expect(response.user.email).toBe("buyer@example.com");
    expect(response.user.displayName).toBe("Buyer Example");
    expect(response.user.role).toBe("user");
    cookie = previous;
  });

  it("promotes configured Google admin emails", async () => {
    const response = await get("/api/auth/me");

    expect(response.user.email).toBe("admin@example.com");
    expect(response.user.role).toBe("admin");
  });

  it("removes password login and password-managed user endpoints", async () => {
    const loginResponse = await postRaw("/api/auth/login", { username: "admin", password: "password123" });
    const changeResponse = await postRaw("/api/auth/change-password", { password: "new-password" });
    const createResponse = await postRaw("/api/admin/users", { username: "new-user", password: "password123", role: "user" });
    const resetResponse = await postRaw(`/api/admin/users/${currentUser().id}/password`, { password: "password123" });

    expect(loginResponse.status).toBe(404);
    expect(changeResponse.status).toBe(404);
    expect(createResponse.status).toBe(404);
    expect(resetResponse.status).toBe(404);
  });

  it("deletes legacy password sessions during bootstrap", async () => {
    const legacy = runtime.store.createUser({
      username: "legacy-admin",
      passwordHash: "legacy-password-hash",
      role: "admin",
      mustChangePassword: true
    });
    runtime.store.createSession(legacy.id, "legacy-token-hash", new Date(Date.now() + 60_000).toISOString());

    await runtime.bootstrap();

    expect(runtime.store.findSessionByToken("not-the-hashed-token")).toBeUndefined();
    expect(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM app_sessions WHERE user_id = ?").get(legacy.id)).toEqual({ count: 0 });
  });
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

  it("returns default settings and updates auto price check scheduling", async () => {
    const settings = await get("/api/settings");
    expect(settings.autoPriceCheckEnabled).toBe(false);
    expect(settings.autoPriceCheckIntervalHours).toBe(24);
    expect(settings.proxyCountryPreference).toBe("US");
    expect(settings.autoPriceCheckNextRunAt).toBeUndefined();

    const updated = await patch("/api/settings", {
      autoPriceCheckEnabled: true,
      autoPriceCheckIntervalHours: 2,
      proxyCountryPreference: "gb"
    });

    expect(updated.autoPriceCheckEnabled).toBe(true);
    expect(updated.autoPriceCheckIntervalHours).toBe(2);
    expect(updated.proxyCountryPreference).toBe("GB");
    expect(new Date(updated.autoPriceCheckNextRunAt).getMinutes()).toBe(0);
  });

  it("shows masked proxy status to logged-in users", async () => {
    const status = await get("/api/proxy/status");

    expect(status.proxy).toEqual(expect.objectContaining({
      enabled: true,
      source: "torchproxies",
      poolType: "isp",
      country: "US",
      masked: "http://user_abc:***@proxy.example:61234"
    }));
    expect(status.countryOptions).toContain("LK");
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("anchors auto price check intervals to local midnight", () => {
    const next = nextScheduledPriceCheckAt(new Date("2026-07-11T03:15:00"), 2);

    expect(next.getHours()).toBe(4);
    expect(next.getMinutes()).toBe(0);
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
    const status = await get("/api/daraz/session/status");
    expect(status.live).toBe(true);
    expect(status.captureId).toBe("fake-daraz-capture");
    expect(status.browserUrl).toBe("/vnc/fake-token/vnc.html");
    const saved = await post("/api/daraz/session/save", { captureId: started.captureId });
    expect(saved.exists).toBe(true);
    expect(saved.session.browserUrl).toBe("/vnc/fake-token/vnc.html");
  });

  it("returns a recoverable conflict when Daraz profile is locked during session start", async () => {
    sessionCapture.startError = new Error("Daraz browser profile is still locked after automatic repair. Stop any open Daraz browser and try again.");

    const response = await postRaw("/api/daraz/session/start", {});
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Daraz browser profile is still locked");
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

  it("saves product links without credentials and marks the queued checkout job as needing action", async () => {
    const response = await post("/api/links", { url: "https://www.daraz.lk/products/sample-i1-s1.html" });

    expect(response.link.title).toBe("Sample Daraz Product");
    expect(response.checkJob.status).toBe("queued");
    const job = await waitForJob(response.checkJob.id);
    expect(job.status).toBe("needs_user_action");
    expect(job.message).toBe("Save your Daraz email/phone and password, or open the remote Daraz browser and save a session before checking final prices.");
  });

  it("requires Daraz credentials or a saved session before checking saved links", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);

    const response = await post("/api/links/check", {});

    expect(response.error).toBe("Save your Daraz email/phone and password, or open the remote Daraz browser and save a session before checking final prices.");
  });

  it("saves a product link with credentials, then queues and completes the first final-price check", async () => {
    const credentials = await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });
    expect(credentials.saved).toBe(true);
    expect(JSON.stringify(credentials)).not.toContain("daraz-password");

    const created = await post("/api/links", { url: "https://www.daraz.lk/products/sample-i1-s1.html" });
    expect(created.link.title).toBe("Sample Daraz Product");
    expect(created.checkJob.source).toBe("link_added");

    const job = await waitForJob(created.checkJob.id);
    expect(job.status).toBe("completed");
    expect(job.runId).toBe("daraz-test-run");
    const checked = await get(`/api/daraz/runs/${job.runId}`);
    expect(checked.products).toHaveLength(1);
    expect(checked.products[0].url).toBe(fakeSearchResult.url);
  });

  it("queues manual saved-link checks", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);
    await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });

    const queued = await post("/api/links/check-jobs", {});
    const job = await waitForJob(queued.job.id);

    expect(queued.job.source).toBe("manual");
    expect(job.status).toBe("completed");
    expect(job.runId).toBe("daraz-test-run");
  });

  it("uses saved Daraz credentials to reconnect before checking saved links", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);
    await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });

    const checked = await post("/api/links/check", {});

    expect(checked.status).toBe("checked");
    expect(sessionCapture.starts).toBe(1);
    expect(sessionCapture.saves).toBe(1);
  });

  it("returns needs_user_action when auto-login needs Daraz verification during saved-link check", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);
    await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });
    sessionCapture.saveError = new Error("captcha required before login can continue");

    const response = await post("/api/links/check", {});

    expect(response.status).toBe("needs_user_action");
    expect(response.message).toContain("Daraz needs OTP, captcha, or verification");
    expect(response.browserUrl).toBe("/vnc/fake-token/vnc.html");
    expect(response.session.captureId).toBe("fake-daraz-capture");
  });

  it("stores needs_user_action when submitted auto-login remains on the Daraz login page", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);
    await post("/api/daraz/credentials", {
      username: "fresh@example.com",
      password: "daraz-password"
    });
    sessionCapture.saveError = new Error("Daraz still shows the login page. Finish login in the inbuilt browser, then save again.");

    const queued = await post("/api/links/check-jobs", {});
    const job = await waitForJob(queued.job.id);

    expect(queued.job.status).toBe("queued");
    expect(job.status).toBe("needs_user_action");
    expect(job.message).toContain("Daraz kept the login page after auto-login");
    expect(job.session.captureId).toBe("fake-daraz-capture");
    expect(job.session.browserUrl).toBe("/vnc/fake-token/vnc.html");
  });

  it("keeps rejected Daraz credentials on the credential failure path", async () => {
    const user = currentUser();
    runtime.store.upsertSavedLink(user.id, fakeSearchResult);
    await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "wrong-password"
    });
    sessionCapture.autoLogin = {
      usernameFound: true,
      passwordFound: true,
      loginButtonFound: true,
      submitted: true,
      credentialsRejected: true
    };
    sessionCapture.saveError = new Error("Daraz still shows the login page. Finish login in the inbuilt browser, then save again.");

    const response = await post("/api/links/check", {});

    expect(response.error).toContain("Could not log in to Daraz automatically");
    expect(response.error).toContain("Check your saved Daraz email/phone and password");
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

  it("records local proxy events and exposes admin proxy summaries without secrets", async () => {
    await post("/api/daraz/search", { query: "phone" });

    const summary = await get("/api/admin/proxy/summary");
    const events = await get("/api/admin/proxy/events?limit=5");

    expect(summary.proxy.masked).toBe("http://user_abc:***@proxy.example:61234");
    expect(summary.events.total).toBeGreaterThan(0);
    expect(summary.events.bySource.some((item: { key: string; count: number }) => item.key === "web" && item.count > 0)).toBe(true);
    expect(summary.external.provider).toBe("torchproxies");
    expect(events.events[0]).toEqual(expect.objectContaining({
      operation: "daraz_search",
      source: "web",
      status: "success",
      proxyCountry: "US"
    }));
    expect(JSON.stringify({ summary, events })).not.toContain("secret");
  });

  it("protects proxy test and admin proxy telemetry endpoints", async () => {
    const adminCookie = cookie;
    cookie = "";
    const missing = await postRaw("/api/proxy/test", {});
    expect(missing.status).toBe(401);

    cookie = await loginWithGoogle({
      sub: "buyer-proxy-sub",
      email: "buyer-proxy@example.com",
      emailVerified: true,
      displayName: "Buyer Proxy"
    });
    const deniedLegacyTest = await postRaw("/api/proxy/test", {});
    const deniedAdminTest = await postRaw("/api/admin/proxy/test", {});
    const deniedSummary = await fetch(`${baseUrl}/api/admin/proxy/summary`, { headers: { cookie } });

    expect(deniedLegacyTest.status).toBe(403);
    expect(deniedAdminTest.status).toBe(403);
    expect(deniedSummary.status).toBe(403);
    cookie = adminCookie;
  });
});

describe("Automation API and MCP", () => {
  it("creates, updates, and deletes scoped API keys without exposing stored secrets", async () => {
    const created = await post("/api/api-keys", { name: "Build bot", scopes: ["rest"] });

    expect(created.token).toMatch(/^ct_/);
    expect(created.apiKey.name).toBe("Build bot");
    expect(created.apiKey.scopes).toEqual(["rest"]);
    expect(JSON.stringify(runtime.store.listApiKeys(currentUser().id))).not.toContain(created.token);

    const updated = await patch(`/api/api-keys/${created.apiKey.id}`, { name: "MCP bot", scopes: ["mcp"] });
    expect(updated.apiKey.name).toBe("MCP bot");
    expect(updated.apiKey.scopes).toEqual(["mcp"]);

    const listed = await get("/api/api-keys");
    expect(listed.apiKeys.some((apiKey: { id: string }) => apiKey.id === created.apiKey.id)).toBe(true);

    const deleted = await deleteRaw(`/api/api-keys/${created.apiKey.id}`);
    expect(deleted.status).toBe(200);
    const afterDelete = await apiGetRaw("/api/v1/links", created.token);
    expect(afterDelete.status).toBe(401);
  });

  it("requires bearer auth and REST scope for v1 endpoints", async () => {
    const mcpOnly = await post("/api/api-keys", { name: "MCP only", scopes: ["mcp"] });

    const missing = await fetch(`${baseUrl}/api/v1/links`);
    const wrongScope = await apiGetRaw("/api/v1/links", mcpOnly.token);

    expect(missing.status).toBe(401);
    expect(wrongScope.status).toBe(403);
  });

  it("automates links, settings, queued jobs, and runs through REST v1", async () => {
    const createdKey = await post("/api/api-keys", { name: "REST bot", scopes: ["rest"] });

    const created = await apiPost("/api/v1/links", createdKey.token, { url: "https://www.daraz.lk/products/sample-i1-s1.html" });
    expect(created.link.title).toBe("Sample Daraz Product");
    expect(created.checkJob.status).toBe("queued");

    const updatedSettings = await apiPatch("/api/v1/settings", createdKey.token, {
      autoPriceCheckEnabled: true,
      autoPriceCheckIntervalHours: 4,
      proxyCountryPreference: "SG"
    });
    expect(updatedSettings.autoPriceCheckEnabled).toBe(true);
    expect(updatedSettings.autoPriceCheckIntervalHours).toBe(4);
    expect(updatedSettings.proxyCountryPreference).toBe("SG");
    expect(runtime.store.listProxyEvents(20).some((event) => event.source === "rest" && event.apiKeyPrefix === createdKey.apiKey.tokenPrefix)).toBe(true);

    await post("/api/daraz/credentials", {
      username: "buyer@example.com",
      password: "daraz-password"
    });
    const queued = await apiPost("/api/v1/links/check-jobs", createdKey.token, {});
    const job = await waitForApiJob(createdKey.token, queued.job.id);
    expect(job.status).toBe("completed");
    expect(job.runId).toBe("daraz-test-run");

    const runs = await apiGet("/api/v1/runs", createdKey.token);
    expect(runs.runs.some((run: { runId: string }) => run.runId === "daraz-test-run")).toBe(true);
    const run = await apiGet(`/api/v1/runs/${job.runId}`, createdKey.token);
    expect(run.runId).toBe("daraz-test-run");
  });

  it("rate limits task-creating REST calls per API key", async () => {
    const createdKey = await post("/api/api-keys", { name: "Limited bot", scopes: ["rest"] });
    let limited: Response | undefined;

    for (let index = 0; index < 11; index += 1) {
      const response = await apiPostRaw("/api/v1/links/check-jobs", createdKey.token, {});
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
  });

  it("lists and calls CartTruth MCP tools with MCP-scoped keys", async () => {
    const createdKey = await post("/api/api-keys", { name: "MCP bot", scopes: ["mcp"] });
    const restOnly = await post("/api/api-keys", { name: "REST only", scopes: ["rest"] });

    const denied = await mcpRaw(restOnly.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    });
    expect(denied.status).toBe(403);

    const initialized = await mcpRequest(createdKey.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "carttruth-test", version: "0.1.0" }
      }
    });
    expect(initialized.result.serverInfo.name).toBe("carttruth");

    const listed = await mcpRequest(createdKey.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    expect(listed.result.tools.some((tool: { name: string }) => tool.name === "carttruth_add_link")).toBe(true);

    const added = await mcpRequest(createdKey.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "carttruth_add_link",
        arguments: { url: "https://www.daraz.lk/products/sample-i1-s1.html" }
      }
    });
    const payload = JSON.parse(added.result.content[0].text);
    expect(payload.link.title).toBe("Sample Daraz Product");
    expect(payload.checkJob.source).toBe("link_added");
  });
});

describe("Contact Form Messages", () => {
  it("allows public contact message submission and lists/deletes them for admins", async () => {
    const prevCookie = cookie;
    cookie = ""; // clear cookie to simulate anonymous public user
    const submitResponse = await postRaw("/api/contact", {
      subject: "Test Subject",
      content: "Test Message Content"
    });
    expect(submitResponse.status).toBe(201);
    const submitJson = await submitResponse.json();
    expect(submitJson.ok).toBe(true);
    expect(submitJson.message.subject).toBe("Test Subject");
    expect(submitJson.message.content).toBe("Test Message Content");
    expect(submitJson.message.id).toBeDefined();

    const badSubmit = await postRaw("/api/contact", {
      subject: "   ",
      content: "Valid message content"
    });
    expect(badSubmit.status).toBe(400);

    const userCookie = await loginWithGoogle({
      sub: "user-sub",
      email: "user@example.com",
      emailVerified: true,
      displayName: "Normal User"
    });
    cookie = userCookie;
    
    const listDenied = await fetch(`${baseUrl}/api/admin/messages`, { headers: { cookie } });
    expect(listDenied.status).toBe(403);

    cookie = prevCookie; // restore admin cookie
    const listResult = await get("/api/admin/messages");
    expect(listResult.messages).toBeDefined();
    expect(listResult.messages.length).toBeGreaterThanOrEqual(1);
    const createdMsg = listResult.messages.find((m: any) => m.id === submitJson.message.id);
    expect(createdMsg).toBeDefined();
    expect(createdMsg.subject).toBe("Test Subject");
    expect(createdMsg.content).toBe("Test Message Content");

    const deleteResult = await deleteRaw(`/api/admin/messages/${createdMsg.id}`);
    expect(deleteResult.status).toBe(200);

    const listResultAfter = await get("/api/admin/messages");
    const goneMsg = listResultAfter.messages.find((m: any) => m.id === createdMsg.id);
    expect(goneMsg).toBeUndefined();
  });
});


async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : {}
  });
  return response.json();
}

async function post(path: string, body: unknown) {
  const response = await postRaw(path, body);
  return response.json();
}

async function patch(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function deleteRaw(path: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {}
  });
}

async function postRaw(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return response;
}

async function apiGet(path: string, token: string) {
  const response = await apiGetRaw(path, token);
  return response.json();
}

async function apiGetRaw(path: string, token: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

async function apiPost(path: string, token: string, body: unknown) {
  const response = await apiPostRaw(path, token, body);
  return response.json();
}

async function apiPostRaw(path: string, token: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function apiPatch(path: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function mcpRaw(token: string, body: unknown) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(body)
  });
}

async function mcpRequest(token: string, body: unknown) {
  const response = await mcpRaw(token, body);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP ${response.status}: ${text}`);
  }
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) {
      throw new Error(`MCP event stream did not contain data: ${text}`);
    }
    return JSON.parse(dataLine.slice("data: ".length));
  }
  return JSON.parse(text);
}

async function startGoogle() {
  const response = await fetch(`${baseUrl}/api/auth/google/start`, { redirect: "manual" });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const state = cookieValue(setCookie, oauthStateCookie);
  const nonce = cookieValue(setCookie, oauthNonceCookie);
  return {
    response,
    state,
    nonce,
    requestCookie: `${oauthStateCookie}=${encodeURIComponent(state)}; ${oauthNonceCookie}=${encodeURIComponent(nonce)}`
  };
}

async function loginWithGoogle(identity: GoogleIdentity = {
  sub: "admin-sub",
  email: "admin@example.com",
  emailVerified: true,
  displayName: "Admin Example"
}): Promise<string> {
  fakeGoogle.identity = identity;
  fakeGoogle.error = undefined;
  const started = await startGoogle();
  const response = await fetch(`${baseUrl}/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(started.state)}`, {
    headers: { cookie: started.requestCookie },
    redirect: "manual"
  });
  if (response.status !== 302) {
    throw new Error(`Google login failed with ${response.status}: ${await response.text()}`);
  }
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.match(/carttruth_session=[^;]+/)?.[0];
  if (!sessionCookie) {
    throw new Error("Login did not set a cookie");
  }
  return sessionCookie;
}

function cookieValue(header: string, name: string): string {
  const match = header.match(new RegExp(`${name}=([^;,]+)`));
  if (!match?.[1]) {
    throw new Error(`Missing ${name} cookie`);
  }
  return decodeURIComponent(match[1]);
}

function currentUser() {
  const user = runtime.store.findUserByEmail("admin@example.com");
  if (!user) {
    throw new Error("Expected Google admin user.");
  }
  return user;
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await get(`/api/price-check-jobs/${jobId}`);
    if (!["queued", "running"].includes(response.job.status)) {
      return response.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for price check job ${jobId}`);
}

async function waitForApiJob(token: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await apiGet(`/api/v1/price-check-jobs/${jobId}`, token);
    if (!["queued", "running"].includes(response.job.status)) {
      return response.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for price check job ${jobId}`);
}

class FakeDarazSessionCapture implements DarazSessionCaptureManager {
  starts = 0;
  saves = 0;
  startError: Error | undefined;
  saveError: Error | undefined;
  autoLogin: DarazAutoLoginAttempt = {
    usernameFound: true,
    passwordFound: true,
    loginButtonFound: true,
    submitted: true
  };
  active: { userId: string; captureId: string; profilePath: string; browserUrl: string } | undefined;

  async start(userId: string, profilePath: string, credentials?: { username: string; password: string }) {
    this.starts += 1;
    if (this.startError) {
      throw this.startError;
    }
    this.active = {
      userId,
      captureId: "fake-daraz-capture",
      profilePath,
      browserUrl: "/vnc/fake-token/vnc.html"
    };
    return {
      captureId: "fake-daraz-capture",
      loginUrl: "https://member.daraz.lk/user/login",
      profilePath,
      storagePath: profilePath,
      browserUrl: "/vnc/fake-token/vnc.html",
      ...(credentials ? { autoLogin: this.autoLogin } : {})
    };
  }

  async save(_userId: string, captureId: string) {
    this.saves += 1;
    if (this.saveError) {
      throw this.saveError;
    }
    return {
      captureId,
      profilePath: "/tmp/daraz-profile",
      storagePath: "/tmp/daraz-profile",
      exists: true,
      session: { status: "saved" as const, live: true, captureId, browserUrl: "/vnc/fake-token/vnc.html" }
    };
  }

  activeCapture(userId: string) {
    if (this.active?.userId === userId) {
      return {
        captureId: this.active.captureId,
        profilePath: this.active.profilePath,
        browserUrl: this.active.browserUrl
      };
    }
    return undefined;
  }

  activeContext(_userId: string) {
    return undefined;
  }

  async reset(userId: string) {
    if (this.active?.userId === userId) {
      this.active = undefined;
    }
  }

  async close() {
    this.active = undefined;
  }
}

class FakeGoogleOAuthClient implements GoogleOAuthClient {
  identity: GoogleIdentity = {
    sub: "admin-sub",
    email: "admin@example.com",
    emailVerified: true,
    displayName: "Admin Example"
  };
  error: Error | undefined;
  lastAuthorization: { state: string; nonce: string; redirectUri: string } | undefined;
  callbackInputs: Array<{ code: string; nonce: string; redirectUri: string }> = [];

  authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string {
    this.lastAuthorization = input;
    return `https://google.example.test/oauth?state=${encodeURIComponent(input.state)}&nonce=${encodeURIComponent(input.nonce)}&redirect_uri=${encodeURIComponent(input.redirectUri)}`;
  }

  async verifyCallback(input: { code: string; nonce: string; redirectUri: string }): Promise<GoogleIdentity> {
    this.callbackInputs.push(input);
    if (this.error) {
      throw this.error;
    }
    return this.identity;
  }
}
