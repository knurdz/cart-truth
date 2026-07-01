import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { LocalEvidenceStore } from "@carttruth/core";
import {
  DarazCheckRequestSchema,
  type DarazCheckRequest,
  type DarazCheckRequestInput,
  type DarazCheckResult,
  type DarazSearchResult
} from "@carttruth/schemas";
import {
  DarazService,
  darazProfilePath,
  darazProfileReadyPath,
  hasDarazProfileSession
} from "@carttruth/adapters";

interface DarazChecker {
  search(query: string): Promise<DarazSearchResult[]>;
  productFromUrl(url: string): Promise<DarazSearchResult>;
  check(request: DarazCheckRequest): Promise<DarazCheckResult>;
}

export interface RuntimeOptions {
  runsDir?: string;
  sessionsDir?: string;
  darazService?: DarazChecker;
  sessionCapture?: DarazSessionCaptureManager;
}

export class LocalRuntime {
  readonly runsDir: string;
  readonly sessionsDir: string;
  readonly evidenceStore: LocalEvidenceStore;
  private readonly darazService: DarazChecker;
  private readonly sessionCapture: DarazSessionCaptureManager;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.runsDir = resolve(options.runsDir ?? "runs");
    this.sessionsDir = resolve(options.sessionsDir ?? ".carttruth/sessions");
    this.evidenceStore = new LocalEvidenceStore(this.runsDir);
    this.darazService = options.darazService ?? new DarazService({
      evidenceStore: this.evidenceStore,
      sessionsDir: this.sessionsDir
    });
    this.sessionCapture = options.sessionCapture ?? new PlaywrightDarazSessionCaptureManager(this.sessionsDir);
  }

  async searchDaraz(query: string): Promise<DarazSearchResult[]> {
    return this.darazService.search(query);
  }

  async findDarazProduct(url: string): Promise<DarazSearchResult> {
    return this.darazService.productFromUrl(url);
  }

  async checkDaraz(rawRequest: DarazCheckRequestInput): Promise<DarazCheckResult> {
    const request = DarazCheckRequestSchema.parse(rawRequest);
    return this.darazService.check(request);
  }

  async listDarazRuns(): Promise<DarazCheckResult[]> {
    await mkdir(this.runsDir, { recursive: true });
    const entries = await readdir(this.runsDir);
    const results: DarazCheckResult[] = [];

    for (const entry of entries) {
      if (!entry.startsWith("daraz-")) {
        continue;
      }
      const resultPath = join(this.runsDir, entry, "result.json");
      try {
        const info = await stat(resultPath);
        if (!info.isFile()) {
          continue;
        }
        results.push(JSON.parse(await readFile(resultPath, "utf8")) as DarazCheckResult);
      } catch {
        // Ignore incomplete runs.
      }
    }

    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async readDarazRun(runId: string): Promise<DarazCheckResult> {
    return JSON.parse(await readFile(join(this.runsDir, runId, "result.json"), "utf8")) as DarazCheckResult;
  }

  async startDarazSession() {
    return this.sessionCapture.start(darazProfilePath(this.sessionsDir));
  }

  async saveDarazSession(captureId: string) {
    return this.sessionCapture.save(captureId);
  }

  hasDarazSession(): boolean {
    return hasDarazProfileSession(this.sessionsDir);
  }

  async close() {
    await this.sessionCapture.close();
  }
}

export interface DarazSessionCaptureManager {
  start(profilePath: string): Promise<{ captureId: string; loginUrl: string; profilePath: string; storagePath: string }>;
  save(captureId: string): Promise<{ captureId: string; profilePath: string; storagePath: string; exists: boolean }>;
  close(): Promise<void>;
}

class PlaywrightDarazSessionCaptureManager implements DarazSessionCaptureManager {
  private readonly captures = new Map<string, { context: BrowserContext; profilePath: string }>();

  constructor(private readonly sessionsDir: string) {}

  async start(profilePath: string) {
    await mkdir(dirname(profilePath), { recursive: true });
    const captureId = `daraz-${Date.now()}`;
    const loginUrl = "https://member.daraz.lk/user/login";
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      viewport: { width: 1365, height: 900 }
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    this.captures.set(captureId, { context, profilePath });
    return { captureId, loginUrl, profilePath, storagePath: profilePath };
  }

  async save(captureId: string) {
    const capture = this.captures.get(captureId);
    if (!capture) {
      throw new Error(`Unknown Daraz login session: ${captureId}`);
    }
    await capture.context.close();
    await writeFile(darazProfileReadyPath(this.sessionsDir), new Date().toISOString(), "utf8");
    this.captures.delete(captureId);
    return {
      captureId,
      profilePath: capture.profilePath,
      storagePath: capture.profilePath,
      exists: existsSync(darazProfileReadyPath(this.sessionsDir))
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.captures.values()].map(async (capture) => {
      await capture.context.close().catch(() => undefined);
    }));
    this.captures.clear();
  }
}
