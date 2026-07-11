import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { type BrowserContext, type Page } from "playwright";
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
  launchDarazPersistentContext,
  repairDarazProfileLock,
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
import { createGoogleOAuthClientFromEnv, decryptSecret, googleAdminEmails, roleForGoogleEmail, type GoogleOAuthClient } from "./auth.js";
import {
  AppStore,
  savedLinkToProduct,
  type AppUser,
  type PriceCheckJob,
  type PriceCheckJobSource,
  type UserSettings,
  type SavedLink
} from "./store.js";
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
  googleOAuth?: GoogleOAuthClient;
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
  private readonly darazCheckHeadless: boolean;
  private readonly darazUserLocks = new Map<string, Promise<void>>();
  private readonly priceCheckConcurrency: number;
  private readonly schedulerPollMs: number;
  private activePriceCheckJobs = 0;
  private drainScheduled = false;
  private schedulerTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(private readonly options: RuntimeOptions = {}) {
    const mode = browserMode();
    this.runsDir = resolve(options.runsDir ?? process.env.CARTTRUTH_RUNS_DIR ?? "runs");
    this.sessionsDir = resolve(options.sessionsDir ?? process.env.CARTTRUTH_SESSIONS_DIR ?? ".carttruth/sessions");
    this.evidenceStore = new LocalEvidenceStore(this.runsDir);
    this.store = options.store ?? new AppStore(options.sqlitePath);
    this.logger = options.logger ?? createLogger({ base: { service: "carttruth-web" } });
    this.proxyProfile = options.proxyProfile ?? loadProxyProfileFromEnv(loadRuntimeEnv());
    this.sessionCapture = options.sessionCapture ?? createDarazSessionCaptureManager(this.proxyProfile, this.logger);
    this.darazCheckHeadless = resolveDarazCheckHeadless(process.env, mode);
    this.priceCheckConcurrency = clampInteger(Number(process.env.CARTTRUTH_PRICE_CHECK_CONCURRENCY ?? 1), 1, 4, 1);
    this.schedulerPollMs = clampInteger(Number(process.env.CARTTRUTH_SCHEDULER_POLL_MS ?? 60_000), 1_000, 3_600_000, 60_000);
    this.logger.info("runtime initialized", {
      runsDir: this.runsDir,
      sessionsDir: this.sessionsDir,
      proxy: proxySummary(this.proxyProfile),
      browserMode: mode,
      darazCheckHeadless: this.darazCheckHeadless,
      priceCheckConcurrency: this.priceCheckConcurrency,
      displayPresent: Boolean(process.env.DISPLAY)
    });
  }

  async bootstrap(): Promise<void> {
    this.store.deleteExpiredSessions();
    this.store.deleteLegacySessions();
    this.store.syncGoogleAdminRoles(googleAdminEmails());
    this.store.requeueRunningPriceCheckJobs();
    this.startPriceCheckScheduler();
    this.schedulePriceCheckDrain();
    this.logger.debug("google auth bootstrap complete", { adminEmailCount: googleAdminEmails().size });
  }

  googleOAuthClient(): GoogleOAuthClient {
    return this.options.googleOAuth ?? createGoogleOAuthClientFromEnv();
  }

  roleForGoogleEmail(email: string): "admin" | "user" {
    return roleForGoogleEmail(email);
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
    return this.withDarazUserLock(userId, "check", async () => {
      const request = DarazCheckRequestSchema.parse(rawRequest);
      this.logger.info("daraz check started", { userId, productCount: request.products.length });
      const result = await this.darazServiceForUser(userId).check(request);
      this.store.recordRun(userId, result);
      this.updateSavedLinksFromResult(userId, result);
      this.logger.info("daraz check finished", { userId, runId: result.runId, status: result.status });
      return result;
    });
  }

  async checkSavedLinks(userId: string, linkIds?: string[]): Promise<DarazCheckResult> {
    const links = this.store.listSavedLinks(userId).filter((link) => !linkIds || linkIds.includes(link.id));
    if (links.length === 0) {
      throw new Error("Add at least one saved Daraz link first.");
    }
    await this.ensureDarazSessionForUser(userId);
    return this.checkDaraz(userId, {
      products: links.map((link) => ({ ...savedLinkToProduct(link), quantity: 1 }))
    });
  }

  async checkSavedLink(userId: string, linkId: string): Promise<DarazCheckResult> {
    const link = this.store.getSavedLink(userId, linkId);
    if (!link) {
      throw new Error("Saved Daraz link not found.");
    }
    await this.ensureDarazSessionForUser(userId);
    return this.checkDaraz(userId, {
      products: [{ ...savedLinkToProduct(link), quantity: 1 }]
    });
  }

  async addSavedLink(userId: string, url: string): Promise<SavedLink> {
    const product = await this.findDarazProduct(userId, url);
    const link = this.store.upsertSavedLink(userId, product);
    this.logger.info("saved daraz link", { userId, linkId: link.id, url: link.url });
    return link;
  }

  settingsForUser(userId: string): UserSettings {
    return this.store.getUserSettings(userId);
  }

  updateSettingsForUser(userId: string, input: { autoPriceCheckEnabled?: boolean; autoPriceCheckIntervalHours?: number }): UserSettings {
    const current = this.store.getUserSettings(userId);
    const enabled = input.autoPriceCheckEnabled ?? current.autoPriceCheckEnabled;
    const intervalHours = input.autoPriceCheckIntervalHours ?? current.autoPriceCheckIntervalHours;
    const nextRunAt = enabled ? nextScheduledPriceCheckAt(new Date(), intervalHours).toISOString() : null;
    return this.store.updateUserSettings(userId, {
      autoPriceCheckEnabled: enabled,
      autoPriceCheckIntervalHours: intervalHours,
      autoPriceCheckNextRunAt: nextRunAt
    });
  }

  enqueueSavedLinkCheck(userId: string, source: PriceCheckJobSource, linkIds?: string[]): PriceCheckJob {
    const job = this.store.createPriceCheckJob({
      userId,
      source,
      ...(linkIds ? { linkIds } : {})
    });
    this.logger.info("price check job queued", { userId, jobId: job.id, source, linkIds });
    this.schedulePriceCheckDrain();
    return job;
  }

  listPriceCheckJobs(userId: string): PriceCheckJob[] {
    return this.store.listPriceCheckJobs(userId);
  }

  getPriceCheckJob(userId: string, jobId: string): PriceCheckJob | undefined {
    return this.store.getPriceCheckJob(userId, jobId);
  }

  hasDarazCredentials(userId: string): boolean {
    return Boolean(this.store.getDarazCredentials(userId));
  }

  async ensureDarazSessionForUser(userId: string): Promise<DarazSessionMetadata & { live: boolean; captureId?: string; browserUrl?: string }> {
    return this.withDarazUserLock(userId, "ensure_session", () => this.ensureDarazSessionForUserUnlocked(userId));
  }

  private async ensureDarazSessionForUserUnlocked(userId: string): Promise<DarazSessionMetadata & { live: boolean; captureId?: string; browserUrl?: string }> {
    const existing = this.darazSessionStatus(userId);
    if (existing.status === "saved") {
      this.logger.debug("daraz session already saved", { userId });
      return existing;
    }

    const credentials = this.store.getDarazCredentials(userId);
    if (!credentials) {
      this.logger.warn("daraz credentials required", { userId });
      throw new Error("Save your Daraz email/phone and password, or open the remote Daraz browser and save a session before checking final prices.");
    }

    this.logger.info("auto_login_started", { userId, username: credentials.username });
    const started = await this.startDarazSessionUnlocked(userId);
    try {
      const saved = await this.saveDarazSessionUnlocked(userId, started.captureId);
      this.logger.info("auto_login_succeeded", { userId, captureId: started.captureId, status: saved.session.status });
      return {
        ...saved.session,
        ...(started.browserUrl ? { browserUrl: started.browserUrl } : {})
      };
    } catch (error) {
      const session = this.darazSessionStatus(userId);
      const message = error instanceof Error ? error.message : String(error);
      const needsAction = session.status === "needs_verification" || /captcha|verification|otp|code/i.test(message);
      if (needsAction) {
        this.logger.warn("auto_login_needs_user_action", { userId, captureId: started.captureId, status: session.status, validationUrl: session.validationUrl });
        const actionMessage = "Daraz needs OTP, captcha, or verification. Open the remote browser, finish verification, then save session.";
        throw new DarazSessionActionRequiredError(actionMessage, {
          ...session,
          live: true,
          captureId: started.captureId,
          message: actionMessage,
          ...(started.browserUrl ? { browserUrl: started.browserUrl } : {})
        });
      }
      this.logger.warn("auto_login_failed", { userId, captureId: started.captureId, error: message });
      throw new Error("Could not log in to Daraz automatically. Check your saved Daraz email/phone and password, or open the remote browser to login manually.");
    }
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
    return this.withDarazUserLock(userId, "start_session", () => this.startDarazSessionUnlocked(userId));
  }

  private async startDarazSessionUnlocked(userId: string) {
    const credentials = this.store.getDarazCredentials(userId);
    this.logger.info("daraz browser session requested", { userId, hasStoredCredentials: Boolean(credentials) });
    await this.sessionCapture.reset(userId);
    await repairDarazProfileLock(darazProfilePath(this.sessionsDirForUser(userId)), {
      logger: this.logger,
      operation: "start_session_preflight",
      userId,
      allowOrphanProcessCleanup: true
    });
    return this.sessionCapture.start(userId, darazProfilePath(this.sessionsDirForUser(userId)), credentials ? {
      username: credentials.username,
      password: decryptSecret(credentials.encryptedPassword)
    } : undefined);
  }

  async saveDarazSession(userId: string, captureId: string) {
    return this.withDarazUserLock(userId, "save_session", () => this.saveDarazSessionUnlocked(userId, captureId));
  }

  private async saveDarazSessionUnlocked(userId: string, captureId: string) {
    const saved = await this.sessionCapture.save(userId, captureId);
    this.logger.info("daraz browser session saved", { userId, captureId, status: saved.session.status });
    return saved;
  }

  async resetDarazSession(userId: string) {
    return this.withDarazUserLock(userId, "reset_session", async () => {
      await this.sessionCapture.reset(userId);
      clearDarazProfileSession(this.sessionsDirForUser(userId));
      await repairDarazProfileLock(darazProfilePath(this.sessionsDirForUser(userId)), {
        logger: this.logger,
        operation: "reset_session",
        userId,
        allowOrphanProcessCleanup: true
      });
      this.logger.info("daraz browser session reset", { userId });
      return this.darazSessionStatus(userId);
    });
  }

  async stopDarazBrowser(userId: string) {
    return this.withDarazUserLock(userId, "stop_browser", async () => {
      await this.sessionCapture.reset(userId);
      await repairDarazProfileLock(darazProfilePath(this.sessionsDirForUser(userId)), {
        logger: this.logger,
        operation: "stop_browser",
        userId,
        allowOrphanProcessCleanup: true
      });
      this.logger.info("daraz browser stopped", { userId });
      return this.darazSessionStatus(userId);
    });
  }

  async repairDarazBrowserProfile(userId: string) {
    return this.withDarazUserLock(userId, "repair_profile", async () => {
      await this.sessionCapture.reset(userId);
      const repair = await repairDarazProfileLock(darazProfilePath(this.sessionsDirForUser(userId)), {
        logger: this.logger,
        operation: "repair_profile",
        userId,
        allowOrphanProcessCleanup: true
      });
      this.logger.info("daraz browser profile repair requested", { userId, repair });
      return {
        session: this.darazSessionStatus(userId),
        repair
      };
    });
  }

  darazSessionStatus(userId: string): DarazSessionMetadata & { live: boolean; captureId?: string; browserUrl?: string } {
    const active = this.sessionCapture.activeCapture(userId);
    return {
      ...readDarazProfileSessionMetadata(this.sessionsDirForUser(userId)),
      live: Boolean(active),
      ...(active ? { captureId: active.captureId } : {}),
      ...(active?.browserUrl ? { browserUrl: active.browserUrl } : {})
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
    this.closed = true;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
    await this.waitForActivePriceCheckJobs();
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
      headless: this.darazCheckHeadless,
      logger: this.logger,
      liveContext: () => this.sessionCapture.activeContext(userId)
    });
  }

  private startPriceCheckScheduler(): void {
    if (this.schedulerTimer) {
      return;
    }
    this.schedulerTimer = setInterval(() => {
      this.enqueueDueAutoPriceChecks();
      this.schedulePriceCheckDrain();
    }, this.schedulerPollMs);
    this.schedulerTimer.unref?.();
    this.enqueueDueAutoPriceChecks();
  }

  private enqueueDueAutoPriceChecks(now = new Date()): void {
    for (const settings of this.store.listDueAutoPriceCheckSettings(now.toISOString())) {
      const links = this.store.listSavedLinks(settings.userId);
      const nextRunAt = nextScheduledPriceCheckAt(now, settings.autoPriceCheckIntervalHours).toISOString();
      if (links.length === 0) {
        this.store.updateUserSettings(settings.userId, {
          autoPriceCheckEnabled: settings.autoPriceCheckEnabled,
          autoPriceCheckIntervalHours: settings.autoPriceCheckIntervalHours,
          autoPriceCheckNextRunAt: nextRunAt
        });
        continue;
      }
      const job = this.store.createPriceCheckJob({ userId: settings.userId, source: "scheduled" });
      this.store.markAutoPriceCheckScheduled(settings.userId, job.id, nextRunAt, "Scheduled price check queued.");
      this.logger.info("scheduled auto price check queued", { userId: settings.userId, jobId: job.id, nextRunAt });
    }
  }

  private schedulePriceCheckDrain(): void {
    if (this.closed || this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      if (this.closed) {
        return;
      }
      this.drainPriceCheckQueue();
    }, 0).unref?.();
  }

  private drainPriceCheckQueue(): void {
    if (this.closed) {
      return;
    }
    while (this.activePriceCheckJobs < this.priceCheckConcurrency) {
      const job = this.store.claimNextPriceCheckJob();
      if (!job) {
        return;
      }
      this.activePriceCheckJobs += 1;
      void this.runPriceCheckJob(job)
        .catch((error) => {
          this.logger.error("price check job failed outside handler", {
            jobId: job.id,
            userId: job.userId,
            error: error instanceof Error ? error.message : String(error)
          });
        })
        .finally(() => {
          this.activePriceCheckJobs -= 1;
          this.schedulePriceCheckDrain();
        });
    }
  }

  private async waitForActivePriceCheckJobs(): Promise<void> {
    const deadline = Date.now() + 5000;
    while (this.activePriceCheckJobs > 0 && Date.now() < deadline) {
      await delay(25);
    }
    if (this.activePriceCheckJobs > 0) {
      this.logger.warn("runtime closing with active price check jobs", { activePriceCheckJobs: this.activePriceCheckJobs });
    }
  }

  private async runPriceCheckJob(job: PriceCheckJob): Promise<void> {
    this.logger.info("price check job started", { userId: job.userId, jobId: job.id, source: job.source });
    try {
      const links = this.store.listSavedLinks(job.userId)
        .filter((link) => !job.linkIds || job.linkIds.includes(link.id));
      if (links.length === 0) {
        const finished = this.store.finishPriceCheckJob(job.id, {
          status: "skipped",
          message: "No saved Daraz links found for this job."
        });
        if (job.source === "scheduled" && finished) {
          this.store.markAutoPriceCheckJobFinished(job.userId, finished);
        }
        return;
      }

      await this.ensureDarazSessionForUser(job.userId);
      const result = await this.checkDaraz(job.userId, {
        products: links.map((link) => ({ ...savedLinkToProduct(link), quantity: 1 }))
      });
      const finished = this.store.finishPriceCheckJob(job.id, {
        status: "completed",
        runId: result.runId,
        message: result.message ?? "Price check finished."
      });
      if (job.source === "scheduled" && finished) {
        this.store.markAutoPriceCheckJobFinished(job.userId, finished);
      }
      this.logger.info("price check job completed", { userId: job.userId, jobId: job.id, runId: result.runId, status: result.status });
    } catch (error) {
      if (error instanceof DarazSessionActionRequiredError) {
        const finished = this.store.finishPriceCheckJob(job.id, {
          status: "needs_user_action",
          message: error.message,
          session: error.session
        });
        if (job.source === "scheduled" && finished) {
          this.store.markAutoPriceCheckJobFinished(job.userId, finished);
        }
        this.logger.warn("price check job needs user action", { userId: job.userId, jobId: job.id, status: error.session.status });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/^Save your Daraz email\/phone and password/i.test(message)) {
        const finished = this.store.finishPriceCheckJob(job.id, {
          status: "needs_user_action",
          message
        });
        if (job.source === "scheduled" && finished) {
          this.store.markAutoPriceCheckJobFinished(job.userId, finished);
        }
        this.logger.warn("price check job needs credentials", { userId: job.userId, jobId: job.id });
        return;
      }
      const finished = this.store.finishPriceCheckJob(job.id, {
        status: "failed",
        message
      });
      if (job.source === "scheduled" && finished) {
        this.store.markAutoPriceCheckJobFinished(job.userId, finished);
      }
      this.logger.error("price check job failed", { userId: job.userId, jobId: job.id, error: message });
    }
  }

  private updateSavedLinksFromResult(userId: string, result: DarazCheckResult): void {
    for (const product of result.products) {
      this.store.updateSavedLinkProduct(userId, {
        id: product.url,
        title: product.title,
        url: product.url,
        ...(product.observedPrice ? { observedPrice: product.observedPrice } : {}),
        availability: product.status
      });
    }
  }

  private async withDarazUserLock<T>(userId: string, operation: string, action: () => Promise<T>): Promise<T> {
    const previous = this.darazUserLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.darazUserLocks.set(userId, tail);
    await previous.catch(() => undefined);

    const startedAt = Date.now();
    this.logger.debug("daraz_user_lock_acquired", { userId, operation });
    try {
      return await action();
    } finally {
      release();
      if (this.darazUserLocks.get(userId) === tail) {
        this.darazUserLocks.delete(userId);
      }
      this.logger.debug("daraz_user_lock_released", { userId, operation, elapsedMs: Date.now() - startedAt });
    }
  }
}

export class DarazSessionActionRequiredError extends Error {
  constructor(message: string, readonly session: DarazSessionMetadata & { live: boolean; captureId?: string; browserUrl?: string }) {
    super(message);
    this.name = "DarazSessionActionRequiredError";
  }
}

export interface DarazSessionCaptureManager {
  start(userId: string, profilePath: string, credentials?: DarazLoginCredentials): Promise<{ captureId: string; loginUrl: string; profilePath: string; storagePath: string; browserUrl?: string }>;
  save(userId: string, captureId: string): Promise<{ captureId: string; profilePath: string; storagePath: string; exists: boolean; session: DarazSessionMetadata & { live: boolean; captureId?: string; browserUrl?: string } }>;
  activeCapture(userId: string): { captureId: string; profilePath: string; browserUrl?: string } | undefined;
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
      const capture = this.captures.get(existing.captureId);
      if (capture && credentials) {
        await this.tryStoredCredentialLogin(userId, capture.context, credentials, existing.captureId);
      }
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
    const context = await launchDarazPersistentContext(profilePath, {
      headless: false,
      viewport: { width: 1365, height: 900 },
      ...(this.proxyProfile ? { proxy: proxyToPlaywright(this.proxyProfile) } : {})
    }, {
      logger: this.logger,
      operation: "headed_session_start",
      userId,
      allowOrphanProcessCleanup: true
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    if (credentials) {
      await this.tryStoredCredentialLogin(userId, context, credentials, captureId);
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
        await repairDarazProfileLock(capture.profilePath, {
          logger: this.logger,
          operation: "headed_session_reset",
          userId
        });
        this.captures.delete(captureId);
        this.logger.info("headed daraz browser closed", { userId, captureId });
      }
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.captures.values()].map(async (capture) => {
      await capture.context.close().catch(() => undefined);
      await repairDarazProfileLock(capture.profilePath, {
        logger: this.logger,
        operation: "headed_session_close",
        userId: capture.userId
      });
    }));
    this.logger.info("all headed daraz browsers closed", { count: this.captures.size });
    this.captures.clear();
  }

  protected async tryStoredCredentialLogin(userId: string, context: BrowserContext, credentials: DarazLoginCredentials, captureId: string): Promise<void> {
    const page = context.pages()[0] ?? await context.newPage();
    const result = await tryDarazAutoLogin(page, credentials);
    const meta = { userId, captureId, ...result };
    if (result.submitted) {
      this.logger.info("daraz_auto_login_submitted", meta);
      return;
    }
    this.logger.warn("daraz_auto_login_not_submitted", meta);
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
        if (credentials) {
          await this.tryStoredCredentialLogin(userId, capture.context, credentials, capture.captureId);
        }
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

      const context = await launchDarazPersistentContext(profilePath, {
        headless: false,
        viewport: { width: 1365, height: 900 },
        env: { ...process.env, DISPLAY: display },
        ...(this.proxyProfile ? { proxy: proxyToPlaywright(this.proxyProfile) } : {})
      }, {
        logger: this.logger,
        operation: "vnc_session_start",
        userId,
        allowOrphanProcessCleanup: true
      });
      const page = context.pages()[0] ?? await context.newPage();
      const loginUrl = "https://member.daraz.lk/user/login";
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
      if (credentials) {
        await this.tryStoredCredentialLogin(userId, context, credentials, captureId);
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
      session: { ...metadata, live: true, captureId, browserUrl: this.browserUrl(capture.token) }
    };
  }

  activeCapture(userId: string) {
    this.cleanupExpired().catch(() => undefined);
    for (const capture of this.vncCaptures.values()) {
      if (capture.userId === userId) {
        return { captureId: capture.captureId, profilePath: capture.profilePath, browserUrl: this.browserUrl(capture.token) };
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
    await repairDarazProfileLock(capture.profilePath, {
      logger: this.logger,
      operation: "vnc_session_close",
      userId: capture.userId
    });
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

export function resolveDarazCheckHeadless(
  env: Record<string, string | undefined> = process.env,
  mode: "headed" | "vnc" = env.CARTTRUTH_BROWSER_MODE === "vnc" ? "vnc" : "headed"
): boolean {
  const configured = parseBooleanEnv(env.CARTTRUTH_DARAZ_CHECK_HEADLESS);
  if (configured !== undefined) {
    return configured;
  }
  return mode === "vnc" || !env.DISPLAY;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

export function nextScheduledPriceCheckAt(from: Date, intervalHours: number): Date {
  const interval = clampInteger(intervalHours, 1, 24, 24);
  const midnight = new Date(from);
  midnight.setHours(0, 0, 0, 0);
  let next = new Date(midnight);
  while (next <= from) {
    next = new Date(next.getTime() + interval * 60 * 60 * 1000);
  }
  return next;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
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

export type DarazAutoLoginAttempt = {
  usernameFound: boolean;
  passwordFound: boolean;
  loginButtonFound: boolean;
  submitted: boolean;
  error?: string;
};

export async function tryDarazAutoLogin(page: Page, credentials: DarazLoginCredentials): Promise<DarazAutoLoginAttempt> {
  const result: DarazAutoLoginAttempt = {
    usernameFound: false,
    passwordFound: false,
    loginButtonFound: false,
    submitted: false
  };
  try {
    const userInput = page.locator("input[type='text'], input[type='email'], input[name*='phone' i], input[name*='email' i]");
    const passwordInput = page.locator("input[type='password']");
    result.usernameFound = await locatorExists(userInput);
    result.passwordFound = await locatorExists(passwordInput);
    if (!result.usernameFound || !result.passwordFound) {
      return result;
    }
    await userInput.first().fill(credentials.username, { timeout: 5000 });
    await passwordInput.first().fill(credentials.password, { timeout: 5000 });

    const loginButton = page.getByRole("button", { name: /login|sign in/i });
    result.loginButtonFound = await locatorExists(loginButton);
    if (!result.loginButtonFound) {
      return result;
    }
    await loginButton.first().click({ timeout: 5000 });
    result.submitted = true;
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function locatorExists(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  return await locator.first().waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
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
