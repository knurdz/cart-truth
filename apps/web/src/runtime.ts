import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  loadProxyProfileFromEnv,
  LocalEvidenceStore,
  proxySummary,
  proxyToPlaywright,
  testProxyConnectivity,
  type ProxySummary
} from "@carttruth/core";
import {
  DarazCheckRequestSchema,
  type DarazCheckRequest,
  type DarazCheckRequestInput,
  type DarazCheckResult,
  type DarazSearchResult,
  type ProxyProfile
} from "@carttruth/schemas";
import {
  DarazService,
  clearDarazProfileSession,
  darazProfilePath,
  hasDarazProfileSession,
  invalidateDarazProfileSession,
  markDarazProfileSessionNeedsVerification,
  markDarazProfileSessionSaved,
  readDarazProfileSessionMetadata,
  validateDarazSessionPage,
  type DarazSessionMetadata
} from "@carttruth/adapters";
import { decryptSecret, hashPassword } from "./auth.js";
import { AppStore, savedLinkToProduct, type AppUser, type SavedLink } from "./store.js";
import { createLogger, type Logger } from "./logger.js";

interface DarazChecker {
  search(query: string): Promise<DarazSearchResult[]>;
  productFromUrl(url: string): Promise<DarazSearchResult>;
  check(request: DarazCheckRequest): Promise<DarazCheckResult>;
}

export interface RuntimeOptions {
  runsDir?: string;
  sessionsDir?: string;
  sqlitePath?: string;
  proxyProfile?: ProxyProfile;
  darazService?: DarazChecker;
  sessionCapture?: DarazSessionCaptureManager;
  store?: AppStore;
  logger?: Logger;
}

export class LocalRuntime {
  readonly runsDir: string;
  readonly sessionsDir: string;
  readonly evidenceStore: LocalEvidenceStore;
  readonly store: AppStore;
  readonly logger: Logger;
  private readonly proxyProfile: ProxyProfile | undefined;
  private readonly sessionCapture: DarazSessionCaptureManager;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.runsDir = resolve(options.runsDir ?? process.env.CARTTRUTH_RUNS_DIR ?? "runs");
    this.sessionsDir = resolve(options.sessionsDir ?? process.env.CARTTRUTH_SESSIONS_DIR ?? ".carttruth/sessions");
    this.evidenceStore = new LocalEvidenceStore(this.runsDir);
    this.store = options.store ?? new AppStore(options.sqlitePath);
    this.logger = options.logger ?? createLogger({ base: { service: "carttruth-web" } });
    this.proxyProfile = options.proxyProfile ?? loadProxyProfileFromEnv(loadRuntimeEnv());
    this.sessionCapture = options.sessionCapture ?? createDarazSessionCaptureManager(this.proxyProfile, this.logger);
    this.logger.info("runtime initialized", {
      runsDir: this.runsDir,
      sessionsDir: this.sessionsDir,
      proxy: proxySummary(this.proxyProfile),
      browserMode: browserMode()
    });
  }

  async bootstrap(): Promise<void> {
    this.store.deleteExpiredSessions();
    if (this.store.userCount() > 0) {
      this.logger.debug("bootstrap skipped because users already exist");
      return;
    }
    const username = process.env.CARTTRUTH_ADMIN_USERNAME ?? "admin";
    const password = process.env.CARTTRUTH_ADMIN_PASSWORD ?? "admin12345";
    this.store.createUser({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
      mustChangePassword: true
    });
    this.logger.warn("bootstrap admin user created", { username });
  }

  async searchDaraz(userId: string, query: string): Promise<DarazSearchResult[]> {
    this.logger.debug("daraz search requested", { userId, query });
    return this.darazServiceForUser(userId).search(query);
  }

  async findDarazProduct(userId: string, url: string): Promise<DarazSearchResult> {
    this.logger.debug("daraz product lookup requested", { userId, url });
    return this.darazServiceForUser(userId).productFromUrl(url);
  }

  async checkDaraz(userId: string, rawRequest: DarazCheckRequestInput): Promise<DarazCheckResult> {
    const request = DarazCheckRequestSchema.parse(rawRequest);
    this.logger.info("daraz check started", { userId, productCount: request.products.length });
    const result = await this.darazServiceForUser(userId).check(request);
    this.store.recordRun(userId, result);
    this.logger.info("daraz check finished", { userId, runId: result.runId, status: result.status });
    return result;
  }

  async checkSavedLinks(userId: string, linkIds?: string[]): Promise<DarazCheckResult> {
    const links = this.store.listSavedLinks(userId).filter((link) => !linkIds || linkIds.includes(link.id));
    if (links.length === 0) {
      throw new Error("Add at least one saved Daraz link first.");
    }
    return this.checkDaraz(userId, {
      products: links.map((link) => ({ ...savedLinkToProduct(link), quantity: 1 }))
    });
  }

  async addSavedLink(userId: string, url: string): Promise<SavedLink> {
    const product = await this.findDarazProduct(userId, url);
    const link = this.store.upsertSavedLink(userId, product);
    this.logger.info("saved daraz link", { userId, linkId: link.id, url: link.url });
    return link;
  }

  listSavedLinks(userId: string): SavedLink[] {
    return this.store.listSavedLinks(userId);
  }

  deleteSavedLink(userId: string, linkId: string): void {
    this.store.deleteSavedLink(userId, linkId);
    this.logger.info("deleted saved daraz link", { userId, linkId });
  }

  async listDarazRuns(userId: string): Promise<DarazCheckResult[]> {
    return this.store.listRuns(userId).map((run) => JSON.parse(run.summaryJson) as DarazCheckResult);
  }

  async readDarazRun(userId: string, runId: string): Promise<DarazCheckResult> {
    const run = this.store.findRun(userId, runId);
    if (run) {
      return JSON.parse(run.summaryJson) as DarazCheckResult;
    }
    return JSON.parse(await readFile(join(this.runsDir, runId, "result.json"), "utf8")) as DarazCheckResult;
  }

  async startDarazSession(userId: string) {
    const credentials = this.store.getDarazCredentials(userId);
    this.logger.info("daraz browser session requested", { userId, hasStoredCredentials: Boolean(credentials) });
    return this.sessionCapture.start(userId, darazProfilePath(this.sessionsDirForUser(userId)), credentials ? {
      username: credentials.username,
      password: decryptSecret(credentials.encryptedPassword)
    } : undefined);
  }

  async saveDarazSession(userId: string, captureId: string) {
    const saved = await this.sessionCapture.save(userId, captureId);
    this.logger.info("daraz browser session saved", { userId, captureId, status: saved.session.status });
    return saved;
  }

  async resetDarazSession(userId: string) {
    await this.sessionCapture.reset(userId);
    clearDarazProfileSession(this.sessionsDirForUser(userId));
    this.logger.info("daraz browser session reset", { userId });
    return this.darazSessionStatus(userId);
  }

  async stopDarazBrowser(userId: string) {
    await this.sessionCapture.reset(userId);
    this.logger.info("daraz browser stopped", { userId });
    return this.darazSessionStatus(userId);
  }

  darazSessionStatus(userId: string): DarazSessionMetadata & { live: boolean; captureId?: string } {
    const active = this.sessionCapture.activeCapture(userId);
    return {
      ...readDarazProfileSessionMetadata(this.sessionsDirForUser(userId)),
      live: Boolean(active),
      ...(active ? { captureId: active.captureId } : {})
    };
  }

  hasDarazSession(userId: string): boolean {
    return hasDarazProfileSession(this.sessionsDirForUser(userId));
  }

  proxyStatus(): ProxySummary {
    return proxySummary(this.proxyProfile);
  }

  async testProxy(url?: string, timeoutMs?: number) {
    if (!this.proxyProfile) {
      return {
        ok: false,
        status: 0,
        bodyPreview: "No proxy configured.",
        elapsedMs: 0,
        proxy: "none"
      };
    }
    return testProxyConnectivity(this.proxyProfile, url, timeoutMs);
  }

  async close() {
    await this.sessionCapture.close();
    this.store.close();
    this.logger.info("runtime closed");
  }

  sessionsDirForUser(userId: string): string {
    return join(this.sessionsDir, "users", userId);
  }

  runBelongsToUser(runId: string, user: AppUser): boolean {
    const owner = this.store.runOwner(runId);
    return user.role === "admin" || owner === user.id;
  }

  vncSessionForToken(token: string): VncBrowserSession | undefined {
    return vncSessionForToken(this.sessionCapture, token);
  }

  private darazServiceForUser(userId: string): DarazChecker {
    if (this.options.darazService) {
      return this.options.darazService;
    }
    return new DarazService({
      evidenceStore: this.evidenceStore,
      sessionsDir: this.sessionsDirForUser(userId),
      ...(this.proxyProfile ? { proxyProfile: this.proxyProfile } : {}),
      liveContext: () => this.sessionCapture.activeContext(userId)
    });
  }
}

export interface DarazSessionCaptureManager {
  start(userId: string, profilePath: string, credentials?: DarazLoginCredentials): Promise<{ captureId: string; loginUrl: string; profilePath: string; storagePath: string; browserUrl?: string }>;
  save(userId: string, captureId: string): Promise<{ captureId: string; profilePath: string; storagePath: string; exists: boolean; session: DarazSessionMetadata & { live: boolean; captureId?: string } }>;
  activeCapture(userId: string): { captureId: string; profilePath: string } | undefined;
  activeContext(userId: string): Promise<BrowserContext | undefined> | BrowserContext | undefined;
  reset(userId: string): Promise<void>;
  close(): Promise<void>;
}

export interface VncBrowserSession {
  token: string;
  userId: string;
  captureId: string;
  webPort: number;
  expiresAt: number;
}

export interface DarazLoginCredentials {
  username: string;
  password: string;
}

class PlaywrightDarazSessionCaptureManager implements DarazSessionCaptureManager {
  private readonly captures = new Map<string, { userId: string; context: BrowserContext; profilePath: string }>();

  constructor(protected readonly proxyProfile?: ProxyProfile, protected readonly logger: Logger = createLogger()) {}

  async start(userId: string, profilePath: string, credentials?: DarazLoginCredentials) {
    const existing = this.activeCapture(userId);
    if (existing) {
      this.logger.debug("reusing active headed daraz browser", { userId, captureId: existing.captureId });
      return {
        captureId: existing.captureId,
        loginUrl: "https://member.daraz.lk/user/login",
        profilePath: existing.profilePath,
        storagePath: existing.profilePath
      };
    }

    await mkdir(dirname(profilePath), { recursive: true });
    const captureId = `daraz-${Date.now()}`;
    const loginUrl = "https://member.daraz.lk/user/login";
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      viewport: { width: 1365, height: 900 },
      ...(this.proxyProfile ? { proxy: proxyToPlaywright(this.proxyProfile) } : {})
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    if (credentials) {
      await tryDarazAutoLogin(page, credentials).catch(() => undefined);
    }
    this.captures.set(captureId, { userId, context, profilePath });
    this.logger.info("headed daraz browser opened", { userId, captureId, profilePath });
    return { captureId, loginUrl, profilePath, storagePath: profilePath };
  }

  async save(userId: string, captureId: string) {
    const capture = this.captures.get(captureId);
    if (!capture || capture.userId !== userId) {
      throw new Error(`Unknown Daraz login session: ${captureId}`);
    }
    const page = capture.context.pages()[0] ?? await capture.context.newPage();
    let session: DarazSessionMetadata;
    try {
      session = await validateDarazSessionPage(page);
    } catch (error) {
      throw new Error(error instanceof Error ? `Could not validate Daraz login: ${error.message}` : "Could not validate Daraz login.");
    }

    if (session.status === "needs_login") {
      invalidateDarazProfileSession(dirname(dirname(capture.profilePath)), session.message, proxySummary(this.proxyProfile));
      throw new Error(session.message ?? "Daraz still shows the login page. Finish login in the inbuilt browser, then save again.");
    }
    if (session.status === "needs_verification") {
      markDarazProfileSessionNeedsVerification(dirname(dirname(capture.profilePath)), session.validationUrl, proxySummary(this.proxyProfile));
      throw new Error(session.message ?? "Manual verification needed. Complete Daraz verification in the inbuilt browser, then save login again.");
    }
    if (session.status !== "saved") {
      throw new Error(session.message ?? "Could not validate Daraz login. Check the inbuilt browser, then save again.");
    }

    const sessionsDir = dirname(dirname(capture.profilePath));
    markDarazProfileSessionSaved(sessionsDir, session.validationUrl, proxySummary(this.proxyProfile));
    session = readDarazProfileSessionMetadata(sessionsDir);
    return {
      captureId,
      profilePath: capture.profilePath,
      storagePath: capture.profilePath,
      exists: hasDarazProfileSession(sessionsDir),
      session: { ...session, live: true, captureId }
    };
  }

  activeCapture(userId: string) {
    for (const [captureId, capture] of this.captures) {
      if (capture.userId === userId) {
        return { captureId, profilePath: capture.profilePath };
      }
    }
    return undefined;
  }

  activeContext(userId: string): BrowserContext | undefined {
    for (const capture of this.captures.values()) {
      if (capture.userId === userId) {
        return capture.context;
      }
    }
    return undefined;
  }

  async reset(userId: string): Promise<void> {
    await Promise.all([...this.captures.entries()].map(async ([captureId, capture]) => {
      if (capture.userId === userId) {
        await capture.context.close().catch(() => undefined);
        this.captures.delete(captureId);
        this.logger.info("headed daraz browser closed", { userId, captureId });
      }
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.captures.values()].map(async (capture) => {
      await capture.context.close().catch(() => undefined);
    }));
    this.logger.info("all headed daraz browsers closed", { count: this.captures.size });
    this.captures.clear();
  }
}

class VncDarazSessionCaptureManager extends PlaywrightDarazSessionCaptureManager {
  private readonly vncCaptures = new Map<string, {
    userId: string;
    captureId: string;
    context: BrowserContext;
    profilePath: string;
    token: string;
    display: string;
    tempDir: string;
    webPort: number;
    processes: ChildProcess[];
    expiresAt: number;
  }>();
  private readonly idleTimeoutMs = Number(process.env.CARTTRUTH_BROWSER_IDLE_TIMEOUT_MS ?? 15 * 60 * 1000);
  private readonly publicUrl = process.env.CARTTRUTH_PUBLIC_URL?.replace(/\/$/, "") ?? "";

  async start(userId: string, profilePath: string, credentials?: DarazLoginCredentials) {
    const existing = this.activeCapture(userId);
    if (existing) {
      const capture = this.vncCaptures.get(existing.captureId);
      if (capture) {
        capture.expiresAt = Date.now() + this.idleTimeoutMs;
        return {
          captureId: capture.captureId,
          loginUrl: "https://member.daraz.lk/user/login",
          profilePath: capture.profilePath,
          storagePath: capture.profilePath,
          browserUrl: this.browserUrl(capture.token)
        };
      }
    }

    await mkdir(dirname(profilePath), { recursive: true });
    const captureId = `daraz-${Date.now()}`;
    const token = randomUUID();
    const displayNumber = 90 + this.vncCaptures.size;
    const display = `:${displayNumber}`;
    const tempDir = await mkdir(join(tmpdir(), `carttruth-vnc-${captureId}`), { recursive: true }).then(() => join(tmpdir(), `carttruth-vnc-${captureId}`));
    const vncPort = await findFreePort();
    const webPort = await findFreePort();
    const processes: ChildProcess[] = [];

    try {
      processes.push(this.spawnLogged("Xvfb", [display, "-screen", "0", "1365x900x24", "-nolisten", "tcp"]));
      await delay(500);
      processes.push(this.spawnLogged("x11vnc", ["-display", display, "-localhost", "-rfbport", String(vncPort), "-forever", "-shared", "-nopw", "-quiet"]));
      processes.push(this.spawnLogged("websockify", ["--web", process.env.CARTTRUTH_NOVNC_WEB_DIR ?? "/usr/share/novnc", `127.0.0.1:${webPort}`, `127.0.0.1:${vncPort}`]));

      const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        viewport: { width: 1365, height: 900 },
        env: { ...process.env, DISPLAY: display },
        ...(this.proxyProfile ? { proxy: proxyToPlaywright(this.proxyProfile) } : {})
      });
      const page = context.pages()[0] ?? await context.newPage();
      const loginUrl = "https://member.daraz.lk/user/login";
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
      if (credentials) {
        await tryDarazAutoLogin(page, credentials).catch(() => undefined);
      }

      const capture = {
        userId,
        captureId,
        context,
        profilePath,
        token,
        display,
        tempDir,
        webPort,
        processes,
        expiresAt: Date.now() + this.idleTimeoutMs
      };
      this.vncCaptures.set(captureId, capture);
      this.logger.info("vnc daraz browser opened", { userId, captureId, display, webPort, vncPort });
      return { captureId, loginUrl, profilePath, storagePath: profilePath, browserUrl: this.browserUrl(token) };
    } catch (error) {
      await this.closeProcesses(processes);
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      this.logger.error("failed to open vnc daraz browser", { userId, captureId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async save(userId: string, captureId: string) {
    const capture = this.vncCaptures.get(captureId);
    if (!capture || capture.userId !== userId) {
      throw new Error(`Unknown Daraz login session: ${captureId}`);
    }
    const page = capture.context.pages()[0] ?? await capture.context.newPage();
    const session = await validateDarazSessionPage(page);
    const sessionsDir = dirname(dirname(capture.profilePath));
    if (session.status === "needs_login") {
      invalidateDarazProfileSession(sessionsDir, session.message, proxySummary(this.proxyProfile));
      throw new Error(session.message ?? "Daraz still shows the login page. Finish login, then save again.");
    }
    if (session.status === "needs_verification") {
      markDarazProfileSessionNeedsVerification(sessionsDir, session.validationUrl, proxySummary(this.proxyProfile));
      throw new Error(session.message ?? "Manual verification needed. Complete Daraz verification, then save again.");
    }
    if (session.status !== "saved") {
      throw new Error(session.message ?? "Could not validate Daraz login. Check the browser, then save again.");
    }
    markDarazProfileSessionSaved(sessionsDir, session.validationUrl, proxySummary(this.proxyProfile));
    const metadata = readDarazProfileSessionMetadata(sessionsDir);
    return {
      captureId,
      profilePath: capture.profilePath,
      storagePath: capture.profilePath,
      exists: hasDarazProfileSession(sessionsDir),
      session: { ...metadata, live: true, captureId }
    };
  }

  activeCapture(userId: string) {
    this.cleanupExpired().catch(() => undefined);
    for (const capture of this.vncCaptures.values()) {
      if (capture.userId === userId) {
        return { captureId: capture.captureId, profilePath: capture.profilePath };
      }
    }
    return undefined;
  }

  activeContext(userId: string): BrowserContext | undefined {
    for (const capture of this.vncCaptures.values()) {
      if (capture.userId === userId) {
        return capture.context;
      }
    }
    return undefined;
  }

  sessionForToken(token: string): VncBrowserSession | undefined {
    this.cleanupExpired().catch(() => undefined);
    for (const capture of this.vncCaptures.values()) {
      if (capture.token === token) {
        capture.expiresAt = Date.now() + this.idleTimeoutMs;
        return {
          token,
          userId: capture.userId,
          captureId: capture.captureId,
          webPort: capture.webPort,
          expiresAt: capture.expiresAt
        };
      }
    }
    return undefined;
  }

  async reset(userId: string): Promise<void> {
    await Promise.all([...this.vncCaptures.values()].map(async (capture) => {
      if (capture.userId === userId) {
        await this.closeCapture(capture.captureId);
      }
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.vncCaptures.keys()].map((captureId) => this.closeCapture(captureId)));
  }

  private browserUrl(token: string): string {
    const path = `/vnc/${encodeURIComponent(token)}/vnc.html?autoconnect=true&resize=scale&path=vnc/${encodeURIComponent(token)}/websockify`;
    return this.publicUrl ? `${this.publicUrl}${path}` : path;
  }

  private spawnLogged(command: string, args: string[]): ChildProcess {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => this.logger.debug("browser process stdout", { command, output: String(chunk).trim() }));
    child.stderr?.on("data", (chunk) => this.logger.debug("browser process stderr", { command, output: String(chunk).trim() }));
    child.on("exit", (code, signal) => this.logger.debug("browser process exited", { command, code, signal }));
    child.on("error", (error) => this.logger.error("browser process error", { command, error: error.message }));
    return child;
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    await Promise.all([...this.vncCaptures.values()]
      .filter((capture) => capture.expiresAt <= now)
      .map((capture) => this.closeCapture(capture.captureId)));
  }

  private async closeCapture(captureId: string): Promise<void> {
    const capture = this.vncCaptures.get(captureId);
    if (!capture) {
      return;
    }
    await capture.context.close().catch(() => undefined);
    await this.closeProcesses(capture.processes);
    await rm(capture.tempDir, { recursive: true, force: true }).catch(() => undefined);
    this.vncCaptures.delete(captureId);
    this.logger.info("vnc daraz browser closed", { userId: capture.userId, captureId });
  }

  private async closeProcesses(processes: ChildProcess[]): Promise<void> {
    for (const child of processes.reverse()) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    await delay(200);
    for (const child of processes) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }
}

export function vncSessionForToken(manager: DarazSessionCaptureManager, token: string): VncBrowserSession | undefined {
  return manager instanceof VncDarazSessionCaptureManager ? manager.sessionForToken(token) : undefined;
}

function createDarazSessionCaptureManager(proxyProfile: ProxyProfile | undefined, logger: Logger): DarazSessionCaptureManager {
  if (browserMode() === "vnc") {
    return new VncDarazSessionCaptureManager(proxyProfile, logger);
  }
  return new PlaywrightDarazSessionCaptureManager(proxyProfile, logger);
}

function browserMode(): "headed" | "vnc" {
  return process.env.CARTTRUTH_BROWSER_MODE === "vnc" ? "vnc" : "headed";
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
      .once("error", reject)
      .once("listening", () => {
        const address = server.address();
        server.close(() => {
          if (!address || typeof address === "string") {
            reject(new Error("Could not allocate a local port."));
            return;
          }
          resolvePort(address.port);
        });
      });
    server.listen(0, "127.0.0.1");
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function tryDarazAutoLogin(page: Page, credentials: DarazLoginCredentials): Promise<void> {
  const userInput = page.locator("input[type='text'], input[type='email'], input[name*='phone' i], input[name*='email' i]").first();
  const passwordInput = page.locator("input[type='password']").first();
  await userInput.fill(credentials.username, { timeout: 5000 });
  await passwordInput.fill(credentials.password, { timeout: 5000 });
  const loginButton = page.getByRole("button", { name: /login|sign in/i }).first();
  await loginButton.click({ timeout: 5000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
}

function loadRuntimeEnv(): Record<string, string | undefined> {
  return {
    ...readDotEnvFile(resolve(".env.local")),
    ...process.env
  };
}

function readDotEnvFile(path: string): Record<string, string> {
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

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
