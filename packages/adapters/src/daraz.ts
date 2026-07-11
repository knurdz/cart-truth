import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  DarazProfileInUseError,
  launchDarazPersistentContext,
  type DarazProfileLaunchDiagnostics,
  type DarazProfileLockEvent,
  type DarazProfileLockLogger
} from "./darazProfileLock.js";
import {
  classifyPageState,
  installNeverPurchaseGuards,
  moneyToMinorUnits,
  parseMoneyText,
  proxySummary,
  proxyToPlaywright,
  type ProxySummary,
  type EvidenceStore
} from "@carttruth/core";
import {
  DarazCheckRequestSchema,
  DarazCheckResultSchema,
  DarazSearchResultSchema,
  type DarazCheckRequestInput,
  type DarazCheckResult,
  type DarazPriceBreakdownItem,
  type DarazProductPrice,
  type DarazProductStatus,
  type DarazSearchResult,
  type DarazSelectedProduct,
  type Evidence,
  type Adjustment,
  type Money,
  type ProxyProfile
} from "@carttruth/schemas";

const DARAZ_HOME_URL = "https://www.daraz.lk/";
const DARAZ_CART_URL = "https://cart.daraz.lk/cart";
const DARAZ_CHECKOUT_URL = "https://checkout.daraz.lk/shipping";
export const DARAZ_SESSION_VALIDATION_URL = DARAZ_CART_URL;

type DarazPageState = NonNullable<Awaited<ReturnType<typeof classifyPageState>>>;
type DarazProductPageRead = { observedPrice: Money | undefined; state?: DarazPageState };
type DarazCartProductKey = { title: string; key: string; shortKey: string; idKey: string; urlKey: string; quantity: number };
type DarazCartIsolationDebug = {
  productRows?: DarazCartDebugRow[];
  selectedRows?: DarazCartDebugRow[];
  ignoredControls?: Array<{ text: string; checked: boolean; reason: string; controlLabel: string }>;
  unmatchedSelectedRows?: DarazCartDebugRow[];
  missingTitles?: string[];
  quantityAdjustments?: Array<{ title: string; requestedQuantity: number; observedQuantity?: number; adjusted: boolean; reason?: string }>;
  quantityMismatches?: DarazCartDebugRow[];
  isolationAttempts?: DarazCartIsolationAttemptDebug[];
  finalVerificationReason?: string;
};
type DarazCartDebugRow = {
  text: string;
  matchedTitles: string[];
  checked: boolean;
  priceCount: number;
  controlLabel: string;
  requestedQuantity?: number;
  quantity?: number;
};
type DarazCartClickTarget = { x: number; y: number; width: number; height: number };
type DarazCartClickAction = {
  action: "select_expected" | "deselect_unexpected";
  title?: string;
  row: DarazCartDebugRow;
  target?: DarazCartClickTarget;
};
type DarazCartClickMethod = "mouse" | "dom" | "failed" | "none";
type DarazCartIsolationAttemptDebug = {
  attempt: number;
  action: "select_expected" | "deselect_unexpected" | "verify" | "scan_failed";
  clickMethod?: DarazCartClickMethod;
  title?: string;
  row?: DarazCartDebugRow;
  verificationReason?: string;
  message?: string;
};
type DarazCartIsolationResult =
  | { status: "checked"; selectedTitles: string[]; debug?: DarazCartIsolationDebug }
  | { status: "needs_attention" | "login_required" | "blocked" | "unavailable"; message: string; debug?: DarazCartIsolationDebug };
type DarazCartIsolationScriptResult =
  | { ok: true; selectedTitles: string[]; action?: DarazCartClickAction; debug?: DarazCartIsolationDebug }
  | { ok: false; message?: string; debug?: DarazCartIsolationDebug };
type DarazCartVerificationScriptResult = { ok: boolean; unmatchedCount: number; message?: string; debug?: DarazCartIsolationDebug };
type DarazCartDomClickResult = { clicked: boolean; row?: DarazCartDebugRow };
type DarazCheckoutReadyResult = {
  ready: boolean;
  text: string;
  state?: DarazPageState;
  message?: string;
  attempts: Array<{ url: string; ready: boolean; source: "buy_now" | "cart_button" | "direct_checkout"; state?: DarazPageState; reason?: string; textExcerpt: string }>;
};
type DarazCheckoutProductRow = {
  text: string;
  matchedTitles: string[];
  quantity?: number;
  priceTexts: string[];
};
type DarazCheckoutExtractionScriptResult = {
  rows: DarazCheckoutProductRow[];
};
type DarazBuyNowProductResult = {
  price: DarazProductPrice;
  status: DarazProductStatus;
  message?: string;
  checkoutTotal?: Money;
  priceBreakdown: DarazPriceBreakdownItem[];
  globalAdjustments: Adjustment[];
};
export type DarazSessionStatus = "missing" | "saved" | "needs_login" | "needs_verification" | "unknown";

export type DarazSessionMetadata = {
  status: DarazSessionStatus;
  savedAt?: string;
  lastValidatedAt?: string;
  validationUrl?: string;
  message?: string;
  proxy?: ProxySummary;
};

export interface DarazServiceOptions {
  evidenceStore: EvidenceStore;
  sessionsDir?: string;
  headless?: boolean;
  proxyProfile?: ProxyProfile;
  liveContext?: () => Promise<BrowserContext | undefined> | BrowserContext | undefined;
  logger?: DarazProfileLockLogger;
}

export class DarazService {
  private readonly sessionsDir: string;

  constructor(private readonly options: DarazServiceOptions) {
    this.sessionsDir = resolve(options.sessionsDir ?? ".carttruth/sessions");
  }

  async search(query: string, limit = 12): Promise<DarazSearchResult[]> {
    const browser = await chromium.launch({
      headless: true,
      ...(this.options.proxyProfile ? { proxy: proxyToPlaywright(this.options.proxyProfile) } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });

    try {
      await page.goto(`${DARAZ_HOME_URL}catalog/?q=${encodeURIComponent(query)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const results = await extractSearchResultsFromPage(page, limit);
      return results.length > 0 ? results : extractDarazSearchResultsFromHtml(await page.content(), limit);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async productFromUrl(rawUrl: string): Promise<DarazSearchResult> {
    const url = normalizeDarazProductUrl(rawUrl);
    const browser = await chromium.launch({
      headless: true,
      ...(this.options.proxyProfile ? { proxy: proxyToPlaywright(this.options.proxyProfile) } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
      const result = await extractProductFromPage(page, url);
      if (result) {
        return result;
      }

      return extractDarazProductFromHtml(await page.content(), url);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async check(rawRequest: DarazCheckRequestInput): Promise<DarazCheckResult> {
    const request = DarazCheckRequestSchema.parse(rawRequest);
    const startedAt = new Date().toISOString();
    const runId = `daraz-${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const profilePath = darazProfilePath(this.sessionsDir);
    const hasSavedSession = hasDarazProfileSession(this.sessionsDir);
    const evidence: Evidence[] = [];
    const liveContext = await resolveLiveContext(this.options.liveContext);
    const currentProxy = proxySummary(this.options.proxyProfile);
    const profileLockEvents: DarazProfileLockEvent[] = [];
    const profileLaunchDiagnostics: DarazProfileLaunchDiagnostics = {
      operation: "daraz_check",
      ...(this.options.logger ? { logger: this.options.logger } : {}),
      onEvent: (event) => {
        profileLockEvents.push(event);
      }
    };

    if (!hasSavedSession && !liveContext) {
      const result = DarazCheckResultSchema.parse({
        runId,
        status: "login_required",
        startedAt,
        finishedAt: new Date().toISOString(),
        products: request.products.map((product) => productToPrice(product, "login_required", "Login with Daraz using the inbuilt browser first.")),
        message: "Login with Daraz using the inbuilt browser before checking final prices.",
        evidence
      });
      result.evidence.push(await this.options.evidenceStore.writeJson(runId, "result.json", result));
      return result;
    }

    if (hasSavedSession && !liveContext && !darazSessionProxyMatches(readDarazProfileSessionMetadata(this.sessionsDir), currentProxy)) {
      const message = "Daraz proxy configuration changed. Open the inbuilt browser and save login again so Daraz uses the same proxy for login and checkout.";
      invalidateDarazProfileSession(this.sessionsDir, message, currentProxy);
      const result = DarazCheckResultSchema.parse({
        runId,
        status: "login_required",
        startedAt,
        finishedAt: new Date().toISOString(),
        products: request.products.map((product) => productToPrice(product, "login_required", message)),
        message,
        evidence
      });
      result.evidence.push(await this.options.evidenceStore.writeJson(runId, "result.json", result));
      return result;
    }

    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let ownsContext = false;

    try {
      context = liveContext;
      if (!context) {
        ownsContext = true;
        context = await launchDarazPersistentContext(profilePath, {
          headless: this.options.headless ?? false,
          viewport: { width: 1365, height: 900 },
          ...(this.options.proxyProfile ? { proxy: proxyToPlaywright(this.options.proxyProfile) } : {})
        }, profileLaunchDiagnostics);
      }
      page = liveContext ? await context.newPage() : context.pages()[0] ?? await context.newPage();
      await installNeverPurchaseGuards(page);

      evidence.push(await this.options.evidenceStore.writeJson(runId, "daraz-run-config.json", {
        proxy: currentProxy,
        profileLockEvents
      }));
      evidence.push(await this.options.evidenceStore.writeJson(runId, "selected-products.json", request.products));
      const prices: DarazProductPrice[] = [];

      const session = await validateDarazSessionPage(page).catch((): DarazSessionMetadata => ({
        status: "unknown",
        message: "Could not validate the saved Daraz login session."
      }));
      if (session.status !== "saved") {
        evidence.push(await screenshot(this.options.evidenceStore, runId, page, "daraz-session-check.png"));
        const status = productStatusFromSessionStatus(session.status);
        updateDarazProfileSessionAfterStatus(this.sessionsDir, status, page.url(), currentProxy);
        return await finishDarazResult(
          this.options.evidenceStore,
          runId,
          startedAt,
          evidence,
          productsWithStatus(request.products, prices, status),
          resultStatusFromProductStatus(status),
          session.message ?? statusMessage(status)
        );
      }
      markDarazProfileSessionSaved(this.sessionsDir, session.validationUrl, currentProxy);

      const buyNowResults: DarazBuyNowProductResult[] = [];
      for (let index = 0; index < request.products.length; index += 1) {
        const product = request.products[index]!;
        const productResult = await checkDarazProductViaBuyNow(
          page,
          product,
          index,
          runId,
          this.options.evidenceStore,
          evidence
        );
        buyNowResults.push(productResult);
        prices.push(productResult.price);
        if (productResult.status === "login_required" || productResult.status === "blocked") {
          updateDarazProfileSessionAfterStatus(this.sessionsDir, productResult.status, page.url(), currentProxy);
          return await finishDarazResult(
            this.options.evidenceStore,
            runId,
            startedAt,
            evidence,
            productsWithStatus(request.products, prices, productResult.status),
            resultStatusFromProductStatus(productResult.status),
            productResult.message ?? statusMessage(productResult.status)
          );
        }
      }

      markDarazProfileSessionSaved(this.sessionsDir, page.url(), currentProxy);
      const allChecked = prices.every((price) => price.status === "checked");
      const singleCheckout = buyNowResults.length === 1 ? buyNowResults[0] : undefined;

      return await finishDarazResult(
        this.options.evidenceStore,
        runId,
        startedAt,
        evidence,
        prices,
        allChecked ? "checked" : "needs_attention",
        allChecked ? undefined : "Some checkout prices need manual review.",
        singleCheckout?.checkoutTotal,
        singleCheckout?.priceBreakdown ?? [],
        singleCheckout?.globalAdjustments ?? []
      );
    } catch (error) {
      if (profileLockEvents.length > 0) {
        evidence.push(await this.options.evidenceStore.writeJson(runId, "daraz-profile-lock.json", {
          events: profileLockEvents
        }));
      }
      const isProfileLock = error instanceof DarazProfileInUseError;
      const rawMessage = error instanceof Error ? error.message : "Unable to check Daraz price.";
      const isDisplayLaunchError = isMissingXServerError(error);
      if (isDisplayLaunchError) {
        this.options.logger?.error("daraz_checkout_browser_start_failed", {
          reason: "missing_x_server",
          error: rawMessage
        });
      }
      const message = isDisplayLaunchError
        ? "Daraz checkout browser could not start on the server. Automated checks must run headless or under Xvfb."
        : rawMessage;
      return await finishDarazResult(
        this.options.evidenceStore,
        runId,
        startedAt,
        evidence,
        request.products.map((product) => productToPrice(product, "needs_attention", message)),
        isProfileLock || isDisplayLaunchError ? "needs_attention" : "error",
        message
      );
    } finally {
      if (ownsContext) {
        await context?.close().catch(() => undefined);
      } else {
        await page?.close().catch(() => undefined);
      }
    }
  }
}

function isMissingXServerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /headed browser without having a XServer|Missing X server|\$DISPLAY|platform failed to initialize/i.test(message);
}

async function resolveLiveContext(
  provider: DarazServiceOptions["liveContext"]
): Promise<BrowserContext | undefined> {
  if (!provider) {
    return undefined;
  }
  return typeof provider === "function" ? await provider() : provider;
}

function darazSessionProxyMatches(session: DarazSessionMetadata, currentProxy: ProxySummary): boolean {
  if (!session.proxy) {
    return !currentProxy.enabled;
  }
  return session.proxy.fingerprint === currentProxy.fingerprint;
}

export function darazSessionPath(sessionsDir = ".carttruth/sessions"): string {
  return resolve(sessionsDir, "daraz", "default.json");
}

export function darazProfilePath(sessionsDir = ".carttruth/sessions"): string {
  return resolve(sessionsDir, "daraz", "default-profile");
}

export function darazProfileReadyPath(sessionsDir = ".carttruth/sessions"): string {
  return resolve(darazProfilePath(sessionsDir), ".carttruth-session-ready");
}

export function darazProfileMetadataPath(sessionsDir = ".carttruth/sessions"): string {
  return resolve(darazProfilePath(sessionsDir), ".carttruth-session.json");
}

export function hasDarazProfileSession(sessionsDir = ".carttruth/sessions"): boolean {
  return existsSync(darazProfileReadyPath(sessionsDir));
}

export function readDarazProfileSessionMetadata(sessionsDir = ".carttruth/sessions"): DarazSessionMetadata {
  try {
    const metadata = JSON.parse(readFileSync(darazProfileMetadataPath(sessionsDir), "utf8")) as Partial<DarazSessionMetadata>;
    if (!hasDarazProfileSession(sessionsDir) && metadata.status !== "needs_login") {
      return { status: "missing" };
    }
    return {
      status: metadata.status ?? "saved",
      ...(metadata.savedAt ? { savedAt: metadata.savedAt } : {}),
      ...(metadata.lastValidatedAt ? { lastValidatedAt: metadata.lastValidatedAt } : {}),
      ...(metadata.validationUrl ? { validationUrl: metadata.validationUrl } : {}),
      ...(metadata.message ? { message: metadata.message } : {}),
      ...(metadata.proxy ? { proxy: metadata.proxy } : {})
    };
  } catch {
    return hasDarazProfileSession(sessionsDir) ? { status: "saved" } : { status: "missing" };
  }
}

export function markDarazProfileSessionSaved(sessionsDir = ".carttruth/sessions", validationUrl?: string, proxy?: ProxySummary): void {
  const now = new Date().toISOString();
  const previous = readDarazProfileSessionMetadata(sessionsDir);
  const savedAt = previous.savedAt ?? now;
  const sessionProxy = proxy ?? previous.proxy;
  ensureDarazProfileDir(sessionsDir);
  writeFileSync(darazProfileReadyPath(sessionsDir), savedAt, "utf8");
  writeFileSync(darazProfileMetadataPath(sessionsDir), `${JSON.stringify({
    status: "saved",
    savedAt,
    lastValidatedAt: now,
    validationUrl: validationUrl ?? DARAZ_SESSION_VALIDATION_URL,
    ...(sessionProxy ? { proxy: sessionProxy } : {})
  } satisfies DarazSessionMetadata, null, 2)}\n`, "utf8");
}

export function invalidateDarazProfileSession(sessionsDir = ".carttruth/sessions", message = statusMessage("login_required"), proxy?: ProxySummary): void {
  rmSync(darazProfileReadyPath(sessionsDir), { force: true });
  writeDarazProfileSessionMetadata(sessionsDir, {
    status: "needs_login",
    lastValidatedAt: new Date().toISOString(),
    validationUrl: DARAZ_SESSION_VALIDATION_URL,
    message,
    ...(proxy ? { proxy } : {})
  });
}

export function clearDarazProfileSession(sessionsDir = ".carttruth/sessions"): void {
  rmSync(darazProfileReadyPath(sessionsDir), { force: true });
  rmSync(darazProfileMetadataPath(sessionsDir), { force: true });
}

export function markDarazProfileSessionNeedsVerification(sessionsDir = ".carttruth/sessions", validationUrl?: string, proxy?: ProxySummary): void {
  const previous = readDarazProfileSessionMetadata(sessionsDir);
  writeDarazProfileSessionMetadata(sessionsDir, {
    ...previous,
    status: "needs_verification",
    lastValidatedAt: new Date().toISOString(),
    validationUrl: validationUrl ?? DARAZ_SESSION_VALIDATION_URL,
    message: statusMessage("blocked"),
    ...(proxy ?? previous.proxy ? { proxy: proxy ?? previous.proxy } : {})
  });
}

export async function validateDarazSessionPage(page: Page): Promise<DarazSessionMetadata> {
  await page.goto(DARAZ_SESSION_VALIDATION_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  const state = await classifyPageState(page);
  if (state === "login_required") {
    return {
      status: "needs_login",
      lastValidatedAt: new Date().toISOString(),
      validationUrl: page.url(),
      message: "Daraz still shows the login page. Finish login in the inbuilt browser, then save again."
    };
  }
  if (state === "captcha" || state === "blocked") {
    return {
      status: "needs_verification",
      lastValidatedAt: new Date().toISOString(),
      validationUrl: page.url(),
      message: "Manual verification needed. Complete Daraz verification in the inbuilt browser, then save login again."
    };
  }

  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!text.replace(/\s+/g, " ").trim()) {
    return {
      status: "unknown",
      lastValidatedAt: new Date().toISOString(),
      validationUrl: page.url(),
      message: "Could not validate the saved Daraz login session."
    };
  }

  return {
    status: "saved",
    lastValidatedAt: new Date().toISOString(),
    validationUrl: page.url()
  };
}

export function normalizeDarazProductUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Paste a valid Daraz product link.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "daraz.lk" || !/\.html$/i.test(parsed.pathname)) {
    throw new Error("Paste a valid Daraz.lk product link.");
  }

  return `https://www.daraz.lk${parsed.pathname}`;
}

export function extractDarazProductFromHtml(html: string, rawUrl: string): DarazSearchResult {
  const url = normalizeDarazProductUrl(rawUrl);
  const title = extractHtmlMeta(html, "og:title")
    ?? extractHtmlMeta(html, "twitter:title")
    ?? extractTitleTag(html)
    ?? "";
  const imageUrl = cleanImageUrl(extractHtmlMeta(html, "og:image") ?? extractHtmlMeta(html, "twitter:image"));
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  const observedPrice = parseDarazPrice(text);
  const cleanedTitle = cleanProductTitle(title || text.replace(/Rs\.?\s*[\d,]+(?:\.\d{1,2})?.*$/i, ""));

  if (!cleanedTitle) {
    throw new Error("Could not read the product title from this Daraz link.");
  }
  if (!observedPrice) {
    throw new Error("Could not read the product price from this Daraz link.");
  }

  return DarazSearchResultSchema.parse({
    id: makeDarazId(url, 0),
    title: cleanedTitle,
    url,
    observedPrice,
    availability: /out of stock|sold out/i.test(text) ? "unavailable" : "available",
    ...(imageUrl ? { imageUrl } : {})
  });
}

export function extractDarazSearchResultsFromHtml(html: string, limit = 12): DarazSearchResult[] {
  const results: DarazSearchResult[] = [];
  const cardPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(html)) && results.length < limit) {
    const rawUrl = match[1] ?? "";
    const body = match[2] ?? "";
    if (!/daraz\.lk|\/products?\//i.test(rawUrl) && !/Rs\./i.test(body)) {
      continue;
    }
    const title = stripHtml(body).replace(/\s+/g, " ").trim();
    const price = parseDarazPrice(body);
    if (!title || !price) {
      continue;
    }
    const url = absoluteDarazUrl(rawUrl);
    results.push(DarazSearchResultSchema.parse({
      id: makeDarazId(url, results.length),
      title: title.slice(0, 180),
      url,
      observedPrice: price,
      availability: "available"
    }));
  }

  return results;
}

export function parseDarazPrice(input: string): Money | undefined {
  return parseMoneyText(input.replace(/Rs\.?/gi, "").replace(/LKR/gi, ""), "LKR");
}

export function buildDarazCartIsolationScript(productKeys: DarazCartProductKey[]): string {
  return `(() => {
    ${buildDarazCartRowsBrowserScript(productKeys)}
    const scan = scanProductRows();
    const debug = scan.debug;
    if (scan.productRows.length === 0) {
      return { ok: false, message: "Could not read Daraz cart item selection controls." };
    }
    const selectedRows = selectMostSpecificProductRows(scan.productRows);
    debug.selectedRows = selectedRows.map(toDebugRow);
    const matchedTitles = Array.from(new Set(selectedRows.flatMap((row) => row.matchedTitles)));
    const missing = expectedProducts.filter((product) => !matchedTitles.includes(product.title)).map((product) => product.title);
    debug.missingTitles = missing;
    if (missing.length > 0) {
      return { ok: false, message: "Could not find selected product in Daraz cart: " + missing[0], debug };
    }
    const selectedElements = selectedRows.map((row) => row.element);
    const unexpectedSelectedRow = scan.productRows.find((row) => row.checked && !selectedElements.includes(row.element));
    if (unexpectedSelectedRow) {
      return {
        ok: true,
        selectedTitles: matchedTitles,
        action: {
          action: "deselect_unexpected",
          row: toDebugRow(unexpectedSelectedRow),
          target: clickTargetFor(unexpectedSelectedRow.control)
        },
        debug
      };
    }
    const uncheckedExpectedRow = selectedRows.find((row) => !row.checked);
    if (uncheckedExpectedRow) {
      const matchedProduct = expectedProducts.find((product) => uncheckedExpectedRow.matchedTitles.includes(product.title));
      return {
        ok: true,
        selectedTitles: matchedTitles,
        action: {
          action: "select_expected",
          title: matchedProduct?.title,
          row: toDebugRow(uncheckedExpectedRow),
          target: clickTargetFor(uncheckedExpectedRow.control)
        },
        debug
      };
    }
    debug.quantityAdjustments = [];
    for (const row of selectedRows) {
      const matchedProduct = expectedProducts.find((product) => row.matchedTitles.includes(product.title));
      if (!matchedProduct) continue;
      const observedQuantity = readQuantity(row.element, row.rawText);
      const adjusted = setRowQuantity(row.element, matchedProduct.quantity, observedQuantity);
      const acceptedWithoutReadableQuantity = !adjusted && matchedProduct.quantity === 1 && typeof observedQuantity !== "number";
      debug.quantityAdjustments.push({
        title: matchedProduct.title,
        requestedQuantity: matchedProduct.quantity,
        observedQuantity,
        adjusted: adjusted || acceptedWithoutReadableQuantity,
        reason: adjusted ? undefined : acceptedWithoutReadableQuantity ? "assumed_single_quantity_until_checkout" : "quantity_control_unavailable"
      });
      if (!adjusted && !acceptedWithoutReadableQuantity) {
        return {
          ok: false,
          message: "Could not set Daraz cart quantity for selected product: " + matchedProduct.title,
          debug
        };
      }
    }
    return { ok: true, selectedTitles: matchedTitles, debug };
  })()`;
}

function buildDarazCartDomClickScript(productKeys: DarazCartProductKey[], action: DarazCartClickAction["action"], title?: string): string {
  return `(() => {
    ${buildDarazCartRowsBrowserScript(productKeys)}
    const targetAction = ${JSON.stringify(action)};
    const targetTitle = ${JSON.stringify(title ?? "")};
    const scan = scanProductRows();
    const selectedRows = selectMostSpecificProductRows(scan.productRows);
    const selectedElements = selectedRows.map((row) => row.element);
    const row = targetAction === "deselect_unexpected"
      ? scan.productRows.find((candidate) => candidate.checked && !selectedElements.includes(candidate.element))
      : selectedRows.find((candidate) => !candidate.checked && (!targetTitle || candidate.matchedTitles.includes(targetTitle)));
    if (!row) return { clicked: false };
    row.control.scrollIntoView({ block: "center", inline: "center" });
    row.control.click();
    return { clicked: true, row: toDebugRow(row) };
  })()`;
}

export function buildDarazCartVerificationScript(productKeys: DarazCartProductKey[]): string {
  return `(() => {
    ${buildDarazCartRowsBrowserScript(productKeys)}
    const scan = scanProductRows();
    const selectedProductRows = scan.productRows.filter((row) => row.checked);
    const unmatchedSelectedRows = selectedProductRows.filter((row) => row.matchedTitles.length === 0);
    const selectedTitles = Array.from(new Set(selectedProductRows.flatMap((row) => row.matchedTitles)));
    const missingTitles = expectedProducts.filter((product) => !selectedTitles.includes(product.title)).map((product) => product.title);
    const quantityMismatches = selectedProductRows.filter((row) => {
      const matchedProduct = expectedProducts.find((product) => row.matchedTitles.includes(product.title));
      if (!matchedProduct) return false;
      const quantity = readQuantity(row.element, row.rawText);
      return typeof quantity === "number" && quantity !== matchedProduct.quantity;
    });
    const debug = scan.debug;
    debug.selectedRows = selectedProductRows.map(toDebugRow);
    debug.unmatchedSelectedRows = unmatchedSelectedRows.map(toDebugRow);
    debug.missingTitles = missingTitles;
    debug.quantityMismatches = quantityMismatches.map(toDebugRow);
    debug.finalVerificationReason = quantityMismatches.length > 0
      ? "quantity_mismatch"
      : unmatchedSelectedRows.length > 0
        ? "unrelated_selected_rows"
        : missingTitles.length > 0
          ? "missing_selected_titles"
          : "checked";
    const ok = unmatchedSelectedRows.length === 0 && missingTitles.length === 0 && quantityMismatches.length === 0;
    return {
      ok,
      unmatchedCount: unmatchedSelectedRows.length,
      message: ok ? undefined : quantityMismatches.length > 0
        ? "Daraz cart quantity did not match the app-selected quantity. Adjust that product quantity manually, then run final price check again."
        : unmatchedSelectedRows.length > 0
          ? "Daraz cart still has unrelated selected product rows. Deselect other cart products manually, then run final price check again."
          : "Daraz did not keep the selected cart item checked. Keep the inbuilt browser open and try final price check again.",
      debug
    };
  })()`;
}

function buildDarazCartRowsBrowserScript(productKeys: DarazCartProductKey[]): string {
  return `
    const expectedProducts = ${JSON.stringify(productKeys)};
    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, 240);
    const productMatches = (text, product) => [product.key, product.shortKey, product.idKey, product.urlKey].some((key) => key && text.includes(key));
    const priceMatches = (value) => String(value || "").match(/rs\\.?\\s*[\\d,]+/gi) || [];
    const controls = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    const isChecked = (element) => {
      if (element instanceof HTMLInputElement) return element.checked;
      const className = String(element.className || "").toLowerCase();
      return element.getAttribute("aria-checked") === "true" || (/\\bchecked\\b/.test(className) && !/\\bunchecked\\b/.test(className));
    };
    const controlLabel = (element) => compact([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.getAttribute("data-spm"),
      element.textContent
    ].filter(Boolean).join(" "));
    const visibleRectFor = (element) => {
      if (!element || typeof element.getBoundingClientRect !== "function") return undefined;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle ? window.getComputedStyle(element) : undefined;
      if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
      if (style && (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none")) return undefined;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return undefined;
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const clickTargetFor = (control) => {
      control.scrollIntoView({ block: "center", inline: "center" });
      const checkboxWrapper = ancestorsFor(control).find((candidate) => {
        const className = String(candidate.className || "").toLowerCase();
        return candidate !== control && /checkbox|check-box|next-checkbox/.test(className);
      });
      const candidates = [
        control.closest?.("label"),
        checkboxWrapper,
        control,
        control.parentElement
      ].filter(Boolean);
      const targets = candidates.map(visibleRectFor).filter(Boolean);
      return targets.find((target) => target.width <= 96 && target.height <= 96) ?? targets[0];
    };
    const hasQuantityControls = (element, text) => {
      return /\\b(qty|quantity)\\b/i.test(text)
        || Boolean(quantityInputFor(element))
        || Boolean(element.querySelector('[role="spinbutton"], [aria-valuenow], [aria-label*="quantity" i], [aria-label*="qty" i], [class*="quantity" i], [class*="qty" i]'))
        || Array.from(element.querySelectorAll("button, [role='button']")).some((button) => /^[+-]$/.test((button.textContent || "").trim()) || buttonMatches(button, /\\+|plus|increase|increment|add|-|−|minus|decrease|decrement|reduce|subtract/i));
    };
    const quantityInputFor = (element) => {
      return element.querySelector([
        'input[type="number"]',
        'input[type="text"][value]',
        'input[role="spinbutton"]',
        'input[aria-label*="quantity" i]',
        'input[aria-label*="qty" i]',
        'input[class*="quantity" i]',
        'input[class*="qty" i]',
        '[role="spinbutton"]',
        '[aria-valuenow][aria-label*="quantity" i]',
        '[aria-valuenow][aria-label*="qty" i]',
        '[aria-valuenow][class*="quantity" i]',
        '[aria-valuenow][class*="qty" i]'
      ].join(", "));
    };
    const readQuantity = (element, rawText) => {
      const input = quantityInputFor(element);
      const value = input && "value" in input ? Number(input.value) : Number(input?.getAttribute?.("aria-valuenow"));
      if (Number.isFinite(value) && value > 0) return Math.round(value);
      const ariaValue = Number(input?.getAttribute?.("aria-valuetext")?.match(/\\d+/)?.[0]);
      if (Number.isFinite(ariaValue) && ariaValue > 0) return Math.round(ariaValue);
      const text = String(rawText || element.innerText || element.textContent || "");
      const match = text.match(/\\b(?:qty|quantity)\\s*:?\\s*(\\d+)\\b/i);
      return match ? Number(match[1]) : undefined;
    };
    const buttonMatches = (button, pattern) => pattern.test([
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.className,
      button.textContent
    ].filter(Boolean).join(" "));
    const setRowQuantity = (element, requestedQuantity, observedQuantity) => {
      if (observedQuantity === requestedQuantity) return true;
      const input = quantityInputFor(element);
      if (input && "value" in input) {
        input.focus?.();
        input.value = String(requestedQuantity);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur?.();
        return true;
      }
      if (typeof observedQuantity !== "number") return false;
      const delta = requestedQuantity - observedQuantity;
      if (Math.abs(delta) > 20) return false;
      const buttons = Array.from(element.querySelectorAll("button, [role='button']"));
      const button = delta > 0
        ? buttons.find((candidate) => buttonMatches(candidate, /\\+|plus|increase|increment|add/i))
        : buttons.find((candidate) => buttonMatches(candidate, /-|−|minus|decrease|decrement|reduce|subtract/i));
      if (!button) return false;
      for (let index = 0; index < Math.abs(delta); index += 1) {
        button.click();
      }
      return true;
    };
    const isIgnoredControl = (control) => {
      const label = normalize(controlLabel(control));
      return /wishlist|favorite|favourite|delete|remove|trash|messages|chat/.test(label);
    };
    const nonProductRowReason = (text, element) => {
      if (/\\b(select\\s+all|delete\\s+all|move\\s+all\\s+to\\s+wishlist)\\b/i.test(text)) return "bulk_cart_control";
      if (/\\b(spend\\s+rs\\.?\\s*[\\d,]+\\s+more|free\\s+standard\\s+delivery|free\\s+delivery|enjoy\\s+free|shipping\\s+fee\\s+discount)\\b/i.test(text)) return "non_product_promo_row";
      if (/\\b(get\\s+voucher|voucher|coupon|promotion|promo)\\b/i.test(text) && !element.querySelector("img")) return "non_product_promo_row";
      if (/^\\s*[a-z0-9 ._&'()-]{2,80}\\s*\\(\\s*\\d+\\s+items?\\s*\\)\\s*$/i.test(text)) return "store_header_row";
      return undefined;
    };
    const ancestorsFor = (element) => {
      const ancestors = [];
      let current = element;
      for (let depth = 0; current && depth < 9; depth += 1) {
        ancestors.push(current);
        current = current.parentElement;
      }
      return ancestors;
    };
    const rowInfoFor = (element) => {
      const rawText = element.innerText || element.textContent || "";
      const text = normalize(rawText);
      const matchedProducts = expectedProducts.filter((product) => productMatches(text, product));
      const priceCount = priceMatches(rawText).length;
      const requestedQuantity = matchedProducts.length === 1 ? matchedProducts[0].quantity : undefined;
      const quantity = readQuantity(element, rawText);
      const checkboxCount = element.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length;
      const hasProductLink = Boolean(element.querySelector('a[href*="/products/"], a[href*="-i"][href*="-s"]'));
      const hasProductImage = Boolean(element.querySelector("img"));
      const hasQty = hasQuantityControls(element, rawText);
      const nonProductReason = matchedProducts.length === 0 ? nonProductRowReason(rawText, element) : undefined;
      const looksProductLike = matchedProducts.length > 0 || hasProductLink || hasProductImage || hasQty;
      const hasProductAmountSignal = priceCount > 0 || hasQty;
      const tooBroad = text.length > 1100 || priceCount > 6 || checkboxCount > 4;
      return {
        element,
        rawText,
        text,
        matchedTitles: matchedProducts.map((product) => product.title),
        requestedQuantity,
        quantity,
        priceCount,
        checkboxCount,
        nonProductReason,
        isProductRow: !nonProductReason && looksProductLike && hasProductAmountSignal && !tooBroad
      };
    };
    const productContainerFor = (control) => {
      if (isIgnoredControl(control)) return undefined;
      for (const info of ancestorsFor(control).map(rowInfoFor)) {
        if (info.nonProductReason) {
          return { ignoredReason: info.nonProductReason, rowInfo: info };
        }
        if (info.isProductRow) {
          return { rowInfo: info };
        }
      }
      return undefined;
    };
    const toDebugRow = (row) => ({
      text: compact(row.rawText),
      matchedTitles: row.matchedTitles,
      checked: row.checked,
      priceCount: row.priceCount,
      controlLabel: row.controlLabel,
      requestedQuantity: row.requestedQuantity,
      quantity: row.quantity
    });
    const scanProductRows = () => {
      const seen = [];
      const productRows = [];
      const ignoredControls = [];
      for (const control of controls) {
        const checked = isChecked(control);
        const label = controlLabel(control);
        if (isIgnoredControl(control)) {
          ignoredControls.push({ text: label, checked, reason: "ignored_control_label", controlLabel: label });
          continue;
        }
        const container = productContainerFor(control);
        if (!container) {
          ignoredControls.push({ text: label, checked, reason: checked ? "checked_non_product_control" : "non_product_control", controlLabel: label });
          continue;
        }
        if (container.ignoredReason) {
          ignoredControls.push({
            text: compact(container.rowInfo.rawText || label),
            checked,
            reason: container.ignoredReason,
            controlLabel: label
          });
          continue;
        }
        const rowInfo = container.rowInfo;
        if (seen.includes(rowInfo.element)) {
          ignoredControls.push({ text: label, checked, reason: "duplicate_product_row_control", controlLabel: label });
          continue;
        }
        seen.push(rowInfo.element);
        productRows.push({
          ...rowInfo,
          control,
          checked,
          controlLabel: label
        });
      }
      return {
        productRows,
        debug: {
          productRows: productRows.map(toDebugRow),
          ignoredControls
        }
      };
    };
    const compareSpecificRows = (left, right) => {
      if (left.element !== right.element && left.element.contains(right.element)) return 1;
      if (left.element !== right.element && right.element.contains(left.element)) return -1;
      if (left.checkboxCount !== right.checkboxCount) return left.checkboxCount - right.checkboxCount;
      if (left.text.length !== right.text.length) return left.text.length - right.text.length;
      return 0;
    };
    const selectMostSpecificProductRows = (productRows) => {
      const selected = [];
      for (const product of expectedProducts) {
        const row = productRows
          .filter((candidate) => candidate.matchedTitles.includes(product.title))
          .sort(compareSpecificRows)[0];
        if (row && !selected.some((selectedRow) => selectedRow.element === row.element)) {
          selected.push(row);
        }
      }
      return selected;
    };
  `;
}

export function buildDarazCheckoutExtractionScript(productKeys: DarazCartProductKey[]): string {
  return `(() => {
    const expectedProducts = ${JSON.stringify(productKeys)};
    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, 500);
    const productMatches = (text, product) => [product.key, product.shortKey, product.idKey, product.urlKey].some((key) => key && text.includes(key));
    const priceMatches = (value) => String(value || "").match(/rs\\.?\\s*[\\d,]+(?:\\.\\d{1,2})?/gi) || [];
    const readQuantity = (rawText) => {
      const match = String(rawText || "").match(/\\b(?:qty|quantity)\\s*:?\\s*(\\d+)\\b/i);
      return match ? Number(match[1]) : undefined;
    };
    const candidates = Array.from(document.querySelectorAll("li, tr, article, section, [class*='item'], [class*='product'], [class*='package'], [class*='sku'], div"))
      .map((element) => {
        const rawText = element.innerText || element.textContent || "";
        const text = normalize(rawText);
        const matchedProducts = expectedProducts.filter((product) => productMatches(text, product));
        const prices = priceMatches(rawText);
        const hasImage = Boolean(element.querySelector("img"));
        const tooBroad = text.length > 900 || prices.length > 5;
        return {
          element,
          rawText,
          text,
          matchedTitles: matchedProducts.map((product) => product.title),
          priceTexts: prices,
          quantity: readQuantity(rawText),
          valid: matchedProducts.length > 0 && prices.length > 0 && (hasImage || /\\bqty|quantity\\b/i.test(rawText) || prices.length <= 3) && !tooBroad
        };
      })
      .filter((row) => row.valid)
      .sort((a, b) => a.text.length - b.text.length);
    const rows = [];
    for (const candidate of candidates) {
      if (rows.some((row) => row.element.contains(candidate.element) || candidate.element.contains(row.element))) {
        continue;
      }
      rows.push(candidate);
    }
    return {
      rows: rows.map((row) => ({
        text: compact(row.rawText),
        matchedTitles: row.matchedTitles,
        quantity: row.quantity,
        priceTexts: row.priceTexts.slice(0, 3)
      }))
    };
  })()`;
}

export function extractDarazCheckoutPricesFromText(text: string, products: DarazSelectedProduct[], checkoutRows: DarazCheckoutProductRow[] = []): {
  products: DarazProductPrice[];
  checkoutTotal?: Money;
  priceBreakdown: DarazPriceBreakdownItem[];
  globalAdjustments: Adjustment[];
} {
  const singleQuantityProducts = products.map((product) => ({ ...product, quantity: 1 }));
  const extractedBreakdown = extractDarazPriceBreakdownFromText(text);
  const productSubtotal = extractedBreakdown.find((item) => item.kind === "product_subtotal")?.amount;
  const checkoutTotal = extractedBreakdown.find((item) => item.kind === "total")?.amount
    ?? extractLabeledDarazPrice(text, ["Order Total", "Grand Total"]);
  const checkoutItemCount = extractDarazCheckoutItemCount(text);
  const singleProductItemCountMismatch = singleQuantityProducts.length === 1
    && typeof checkoutItemCount === "number"
    && checkoutItemCount !== 1;

  const productPrices = singleQuantityProducts.map((product) => {
    const row = checkoutRows.find((candidate) => candidate.matchedTitles.includes(product.title));
    const rowPrice = row ? priceFromCheckoutRow(row) : undefined;
    const textLinePrice = findPriceNearTitle(text, product.title);
    const linePrice = rowPrice?.linePrice ?? textLinePrice ?? (singleQuantityProducts.length === 1 ? productSubtotal : undefined);
    const unitPrice = rowPrice?.unitPrice ?? linePrice;
    const quantityMismatch = typeof row?.quantity === "number" && row.quantity !== 1;
    const itemCountMismatch = singleProductItemCountMismatch;

    return {
      title: product.title,
      url: product.url,
      quantity: product.quantity,
      observedPrice: product.observedPrice,
      checkoutUnitPrice: unitPrice,
      checkoutLinePrice: linePrice,
      breakdown: productBreakdown(product, unitPrice, linePrice),
      status: linePrice && !quantityMismatch && !itemCountMismatch ? "checked" : "needs_attention",
      note: itemCountMismatch
        ? "Daraz checkout item count did not match the app-selected quantity."
        : quantityMismatch
        ? "Daraz checkout quantity did not match the app-selected quantity."
        : linePrice ? undefined : "Could not find this item price on the checkout page. Product-page price was not reused as checkout price."
    } satisfies DarazProductPrice;
  });

  const priceBreakdown = completeCheckoutBreakdown(
    extractedBreakdown,
    productPrices,
    checkoutTotal
  );

  return {
    products: productPrices,
    priceBreakdown,
    globalAdjustments: breakdownToAdjustments(priceBreakdown),
    ...(checkoutTotal ? { checkoutTotal } : {})
  };
}

async function extractSearchResultsFromPage(page: Page, limit: number): Promise<DarazSearchResult[]> {
  const rawResults = await page.evaluate((maxResults) => {
    const cards = Array.from(document.querySelectorAll('[data-tracking="product-card"], [data-item-id], .Bm3ON, [class*="gridItem"]')).slice(0, maxResults * 2);
    return cards.map((card, index) => {
      const anchor = card.querySelector('a[href]') as HTMLAnchorElement | null;
      const image = card.querySelector('img') as HTMLImageElement | null;
      const text = card.textContent ?? "";
      const priceMatch = text.match(/Rs\.?\s*[\d,]+(?:\.\d{1,2})?/i);
      const title = (anchor?.getAttribute("title") || anchor?.textContent || text.replace(priceMatch?.[0] ?? "", "")).replace(/\s+/g, " ").trim();
      return {
        id: card.getAttribute("data-item-id") || card.getAttribute("data-sku-simple") || String(index),
        title,
        url: anchor?.href,
        imageUrl: image?.src,
        priceText: priceMatch?.[0],
        availability: /out of stock|sold out/i.test(text) ? "unavailable" : "available"
      };
    });
  }, limit);

  return rawResults.flatMap((item, index) => {
    const observedPrice = item.priceText ? parseDarazPrice(item.priceText) : undefined;
    if (!item.title || !item.url || !observedPrice) {
      return [];
    }

    return [DarazSearchResultSchema.parse({
      id: item.id || makeDarazId(item.url, index),
      title: item.title,
      url: item.url,
      observedPrice,
      availability: item.availability,
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {})
    })];
  }).slice(0, limit);
}

async function extractProductFromPage(page: Page, url: string): Promise<DarazSearchResult | undefined> {
  const raw = await page.evaluate(() => {
    const titleElement = document.querySelector(".pdp-mod-product-badge-title, h1, [data-spm='product_title']");
    const priceElement = document.querySelector(".pdp-price, .pdp-product-price, [class*='pdp-price'], [class*='price']");
    const imageElement = document.querySelector("meta[property='og:image'], meta[name='twitter:image'], img") as HTMLMetaElement | HTMLImageElement | null;
    const metaTitle = document.querySelector("meta[property='og:title'], meta[name='twitter:title']") as HTMLMetaElement | null;
    const text = document.body?.textContent ?? "";
    return {
      title: (titleElement?.textContent || metaTitle?.content || document.title || "").replace(/\s+/g, " ").trim(),
      priceText: (priceElement?.textContent || text.match(/Rs\.?\s*[\d,]+(?:\.\d{1,2})?/i)?.[0] || "").replace(/\s+/g, " ").trim(),
      imageUrl: imageElement instanceof HTMLMetaElement ? imageElement.content : imageElement?.src,
      text
    };
  });

  const observedPrice = parseDarazPrice(raw.priceText);
  const title = cleanProductTitle(raw.title);
  const imageUrl = cleanImageUrl(raw.imageUrl);
  if (!title || !observedPrice) {
    return undefined;
  }

  return DarazSearchResultSchema.parse({
    id: makeDarazId(url, 0),
    title,
    url,
    observedPrice,
    availability: /out of stock|sold out/i.test(raw.text) ? "unavailable" : "available",
    ...(imageUrl ? { imageUrl } : {})
  });
}

async function readProductPagePrice(page: Page, product: DarazSelectedProduct): Promise<DarazProductPageRead> {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const state = await classifyPageState(page);
  if (state) {
    return { observedPrice: product.observedPrice, state };
  }
  const text = await page.locator("body").innerText({ timeout: 10000 });
  return { observedPrice: parseDarazPrice(text) ?? product.observedPrice };
}

async function checkDarazProductViaBuyNow(
  page: Page,
  product: DarazSelectedProduct,
  index: number,
  runId: string,
  evidenceStore: EvidenceStore,
  evidence: Evidence[]
): Promise<DarazBuyNowProductResult> {
  const fileKey = `${String(index + 1).padStart(2, "0")}-${safeFile(product.id)}`;
  const priceResult = await readProductPagePrice(page, product).catch((): DarazProductPageRead => ({ observedPrice: product.observedPrice }));
  const productWithObservedPrice = { ...product, observedPrice: priceResult.observedPrice };
  if (priceResult.state) {
    const status = cartStateToStatus(priceResult.state);
    evidence.push(await screenshot(evidenceStore, runId, page, `daraz-buy-now-${fileKey}-failed.png`));
    return {
      price: productToPrice(productWithObservedPrice, status, statusMessage(status)),
      status,
      message: statusMessage(status),
      priceBreakdown: [],
      globalAdjustments: []
    };
  }

  const buyNow = await clickDarazBuyNow(page);
  if (buyNow.status !== "checked") {
    evidence.push(await screenshot(evidenceStore, runId, page, `daraz-buy-now-${fileKey}-failed.png`));
    return {
      price: productToPrice(productWithObservedPrice, buyNow.status, buyNow.message),
      status: buyNow.status,
      ...(buyNow.message ? { message: buyNow.message } : {}),
      priceBreakdown: [],
      globalAdjustments: []
    };
  }

  evidence.push(await screenshot(evidenceStore, runId, page, `daraz-buy-now-${fileKey}.png`));
  const checkoutReady = await waitForDarazBuyNowCheckoutReady(page, product);
  evidence.push(await screenshot(evidenceStore, runId, page, `daraz-checkout-${fileKey}.png`));
  const checkoutState = checkoutReady.state ?? await classifyPageState(page);
  if (checkoutState) {
    const status = cartStateToStatus(checkoutState);
    const message = checkoutReady.message ?? statusMessage(status);
    evidence.push(await evidenceStore.writeJson(runId, `daraz-checkout-extraction-${fileKey}.json`, {
      status,
      readiness: checkoutReady.attempts,
      message
    }));
    return {
      price: productToPrice(productWithObservedPrice, status, message),
      status,
      message,
      priceBreakdown: [],
      globalAdjustments: []
    };
  }

  if (!checkoutReady.ready) {
    const message = checkoutReady.message ?? "Daraz checkout did not show final prices for this product. Try final price check again.";
    evidence.push(await evidenceStore.writeJson(runId, `daraz-checkout-extraction-${fileKey}.json`, {
      status: "needs_attention",
      readiness: checkoutReady.attempts,
      message
    }));
    return {
      price: productToPrice(productWithObservedPrice, "needs_attention", message),
      status: "needs_attention",
      message,
      priceBreakdown: [],
      globalAdjustments: []
    };
  }

  const productKeys = darazProductKeys([productWithObservedPrice]);
  const checkoutRows = await page.evaluate(buildDarazCheckoutExtractionScript(productKeys))
    .then((result) => result as DarazCheckoutExtractionScriptResult)
    .catch((): DarazCheckoutExtractionScriptResult => ({ rows: [] }));
  const checkoutText = checkoutReady.text || await page.locator("body").innerText({ timeout: 10000 });
  const checkoutPrices = extractDarazCheckoutPricesFromText(checkoutText, [productWithObservedPrice], checkoutRows.rows);
  const checkoutProduct = checkoutPrices.products[0] ?? productToPrice(productWithObservedPrice, "needs_attention", "Could not find this item price on the checkout page.");
  const productPrice: DarazProductPrice = {
    ...productToPrice(productWithObservedPrice, checkoutProduct.status, checkoutProduct.note),
    ...checkoutProduct,
    breakdown: buyNowProductBreakdown(checkoutProduct, checkoutPrices.priceBreakdown)
  };
  evidence.push(await evidenceStore.writeJson(runId, `daraz-checkout-extraction-${fileKey}.json`, {
    status: productPrice.status,
    url: page.url(),
    readiness: checkoutReady.attempts,
    rows: checkoutRows.rows,
    textExcerpt: redactCheckoutText(checkoutText),
    checkoutTotal: checkoutPrices.checkoutTotal,
    priceBreakdown: checkoutPrices.priceBreakdown
  }));

  return {
    price: productPrice,
    status: productPrice.status,
    ...(productPrice.note ? { message: productPrice.note } : {}),
    ...(checkoutPrices.checkoutTotal ? { checkoutTotal: checkoutPrices.checkoutTotal } : {}),
    priceBreakdown: checkoutPrices.priceBreakdown,
    globalAdjustments: checkoutPrices.globalAdjustments
  };
}

async function clickDarazBuyNow(page: Page): Promise<{ status: DarazProductStatus; message?: string }> {
  if (!isDarazProductPageUrl(page.url())) {
    return {
      status: "needs_attention",
      message: "Daraz Buy Now can only be clicked from the product page."
    };
  }

  const state = await classifyPageState(page);
  if (state) {
    const status = cartStateToStatus(state);
    return { status, message: statusMessage(status) };
  }

  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (/out\s+of\s+stock|sold\s+out|currently\s+unavailable|not\s+available/i.test(text)) {
    return { status: "unavailable", message: "This product is unavailable on Daraz." };
  }

  const clicked = await clickButtonByText(page, ["Buy Now", "BUY NOW", "Buy now"]);
  if (!clicked) {
    return { status: "unavailable", message: "Could not find the Daraz Buy Now button for this product." };
  }

  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const afterClickState = await classifyPageState(page);
  if (afterClickState) {
    const status = cartStateToStatus(afterClickState);
    return { status, message: statusMessage(status) };
  }

  if (isDarazProductPageUrl(page.url())) {
    const postClickText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => text);
    return {
      status: "needs_attention",
      message: buyNowRequiresSelection(postClickText)
        ? "Daraz needs a product option selected before Buy Now can continue."
        : "Daraz did not open checkout after Buy Now. Try final price check again."
    };
  }

  return { status: "checked" };
}

async function waitForDarazBuyNowCheckoutReady(page: Page, product: DarazSelectedProduct): Promise<DarazCheckoutReadyResult> {
  const attempts: DarazCheckoutReadyResult["attempts"] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(attempt === 0 ? 1500 : 2500);

    const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const state = await classifyDarazProtectedPageState(page.url(), text);
    const ready = /checkout\.daraz\.lk/i.test(page.url()) && !state && isDarazCheckoutReadyText(text, [product]);
    attempts.push({
      url: page.url(),
      ready,
      source: "buy_now",
      ...(state ? { state } : {}),
      ...(ready ? {} : { reason: buyNowCheckoutNotReadyReason(page.url(), text, product, state) }),
      textExcerpt: redactCheckoutText(text)
    });

    if (state) {
      return { ready: false, text, state, attempts, message: statusMessage(cartStateToStatus(state)) };
    }
    if (ready) {
      return { ready: true, text, attempts };
    }
  }

  return {
    ready: false,
    text: attempts.at(-1)?.textExcerpt ?? "",
    attempts,
    message: attempts.some((attempt) => attempt.reason === "variant_selection_required")
      ? "Daraz needs a product option selected before Buy Now can continue."
      : "Daraz checkout did not show final prices for this product. Try final price check again."
  };
}

function buyNowCheckoutNotReadyReason(url: string, text: string, product: DarazSelectedProduct, state?: DarazPageState): string {
  if (state) {
    return state;
  }
  if (!text.replace(/\s+/g, " ").trim()) {
    return "empty_checkout_page";
  }
  if (isDarazProductPageUrl(url) && buyNowRequiresSelection(text)) {
    return "variant_selection_required";
  }
  if (isDarazLoggedOutShell(text)) {
    return "logged_out_shell";
  }
  if (!/checkout\.daraz\.lk/i.test(url)) {
    return "checkout_not_opened";
  }
  if (!/rs\.?\s*[\d,]+/i.test(text)) {
    return "missing_checkout_prices";
  }
  const normalized = normalizeCartMatchText(text);
  if (!productMatchesNormalizedText(normalized, product)) {
    return "missing_selected_product_text";
  }
  return "missing_checkout_summary";
}

function buyNowRequiresSelection(text: string): boolean {
  return /\b(select|choose)\b.{0,60}\b(color|colour|size|variation|option|model|type|sku)\b/i.test(text)
    || /\bplease\s+(select|choose)\b/i.test(text)
    || /\b(color|colour|size|variation|option|model|type)\s+is\s+required\b/i.test(text);
}

function isDarazProductPageUrl(url: string): boolean {
  return /daraz\.[^/]+\/products\//i.test(url) || /-i\d+-s\d+\.html/i.test(url);
}

function buyNowProductBreakdown(
  product: DarazProductPrice,
  checkoutBreakdown: DarazPriceBreakdownItem[]
): DarazPriceBreakdownItem[] {
  const extraBreakdown = checkoutBreakdown.filter((item) => item.kind !== "product_subtotal");
  return dedupeBreakdown([...(product.breakdown ?? []), ...extraBreakdown]);
}

async function addProductToCart(page: Page, product: DarazSelectedProduct): Promise<DarazProductStatus> {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const state = await classifyPageState(page);
  if (state) {
    return cartStateToStatus(state);
  }

  const clicked = await clickButtonByText(page, ["Add to Cart", "ADD TO CART", "Add to cart"]);
  if (!clicked) {
    return "unavailable";
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const postClickState = await classifyPageState(page);
  if (postClickState) {
    return cartStateToStatus(postClickState);
  }

  return "checked";
}

async function isolateDarazCartToSelectedProducts(page: Page, products: DarazSelectedProduct[]): Promise<DarazCartIsolationResult> {
  const state = await classifyPageState(page);
  if (state) {
    const status = cartStateToStatus(state) as "login_required" | "blocked";
    return { status, message: statusMessage(status) };
  }

  const productKeys = darazProductKeys(products);
  const attempts: DarazCartIsolationAttemptDebug[] = [];
  let lastDebug: DarazCartIsolationDebug | undefined;
  let lastVerification: DarazCartVerificationScriptResult | undefined;
  let selectedTitles: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await page.evaluate(buildDarazCartIsolationScript(productKeys)) as DarazCartIsolationScriptResult;
    if (!result.ok) {
      const failedAttempt: DarazCartIsolationAttemptDebug = {
        attempt,
        action: "scan_failed",
        clickMethod: "none"
      };
      if (result.message) {
        failedAttempt.message = result.message;
      }
      attempts.push(failedAttempt);
      return withCartDebug({
        status: "needs_attention",
        message: result.message ?? "Could not isolate selected Daraz cart items."
      }, withIsolationAttempts(result.debug, attempts));
    }

    selectedTitles = result.selectedTitles ?? selectedTitles;
    const clickMethod = result.action
      ? await clickDarazCartAction(page, productKeys, result.action)
      : "none";

    await waitForDarazCartToSettle(page);

    const verification = await page.evaluate(buildDarazCartVerificationScript(productKeys)) as DarazCartVerificationScriptResult;
    const debug = withIsolationAttempts(mergeCartIsolationDebug(result.debug, verification.debug), attempts);
    const verificationReason = cartVerificationFailureReason(verification.debug);
    const isolationAttempt: DarazCartIsolationAttemptDebug = {
      attempt,
      action: result.action?.action ?? "verify",
      clickMethod
    };
    if (result.action?.title) {
      isolationAttempt.title = result.action.title;
    }
    if (result.action?.row) {
      isolationAttempt.row = result.action.row;
    }
    if (verificationReason) {
      isolationAttempt.verificationReason = verificationReason;
    }
    if (verification.message) {
      isolationAttempt.message = verification.message;
    }
    attempts.push(isolationAttempt);
    debug.isolationAttempts = attempts.slice();
    lastDebug = debug;
    lastVerification = verification;

    if (verification.ok) {
      return { status: "checked", selectedTitles, debug };
    }
  }

  return withCartDebug({
    status: "needs_attention",
    message: cartVerificationFailureMessage(lastVerification)
  }, lastDebug);
}

function withCartDebug<T extends DarazCartIsolationResult>(result: T, debug?: DarazCartIsolationDebug): T {
  return debug ? { ...result, debug } : result;
}

function withIsolationAttempts(debug: DarazCartIsolationDebug | undefined, attempts: DarazCartIsolationAttemptDebug[]): DarazCartIsolationDebug {
  return {
    ...(debug ?? {}),
    isolationAttempts: attempts.slice()
  };
}

async function waitForDarazCartToSettle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  const maybeWaitForFunction = (page as unknown as {
    waitForFunction?: (pageFunction: () => boolean, arg?: unknown, options?: { timeout: number }) => Promise<unknown>;
  }).waitForFunction;
  if (typeof maybeWaitForFunction === "function") {
    await maybeWaitForFunction.call(page, () => {
      const loadingText = document.body?.innerText || "";
      const loadingElement = document.querySelector([
        "[class*='loading' i]",
        "[class*='spinner' i]",
        "[class*='next-loading' i]",
        "[aria-busy='true']"
      ].join(", "));
      return !loadingElement && !/loading|please wait/i.test(loadingText);
    }, undefined, { timeout: 5000 }).catch(() => undefined);
  }
  await page.waitForTimeout(800);
}

async function clickDarazCartAction(
  page: Page,
  productKeys: DarazCartProductKey[],
  action: DarazCartClickAction
): Promise<DarazCartClickMethod> {
  if (action.target && Number.isFinite(action.target.x) && Number.isFinite(action.target.y)) {
    try {
      await page.mouse.click(action.target.x, action.target.y);
      await page.waitForTimeout(250);
      return "mouse";
    } catch {
      // Fall through to a DOM click when the coordinate target is stale or obscured.
    }
  }

  const fallback = await page.evaluate(buildDarazCartDomClickScript(productKeys, action.action, action.title))
    .then((result) => result as DarazCartDomClickResult)
    .catch((): DarazCartDomClickResult => ({ clicked: false }));
  return fallback.clicked ? "dom" : "failed";
}

function cartVerificationFailureReason(debug?: DarazCartIsolationDebug): string | undefined {
  if (debug?.finalVerificationReason) return debug.finalVerificationReason;
  if ((debug?.quantityMismatches?.length ?? 0) > 0) return "quantity_mismatch";
  if ((debug?.unmatchedSelectedRows?.length ?? 0) > 0) return "unrelated_selected_rows";
  if ((debug?.missingTitles?.length ?? 0) > 0) return "missing_selected_titles";
  return undefined;
}

function cartVerificationFailureMessage(verification?: DarazCartVerificationScriptResult): string {
  const reason = cartVerificationFailureReason(verification?.debug);
  if (reason === "quantity_mismatch") {
    return "Daraz cart quantity did not match the app-selected quantity. Adjust that product quantity manually, then run final price check again.";
  }
  if (reason === "unrelated_selected_rows") {
    return "Daraz cart still has unrelated selected product rows. Deselect other cart products manually, then run final price check again.";
  }
  if (reason === "missing_selected_titles") {
    return "Daraz did not keep the selected cart item checked. Keep the inbuilt browser open and try final price check again.";
  }
  return verification?.message ?? "Could not isolate selected Daraz cart items.";
}

function mergeCartIsolationDebug(
  isolationDebug?: DarazCartIsolationDebug,
  verificationDebug?: DarazCartIsolationDebug
): DarazCartIsolationDebug {
  const debug: DarazCartIsolationDebug = {
    ...(isolationDebug ?? {}),
    ...(verificationDebug ?? {})
  };
  const selectedRows = verificationDebug?.selectedRows ?? isolationDebug?.selectedRows;
  if (selectedRows) {
    debug.selectedRows = selectedRows;
  }
  const ignoredControls = verificationDebug?.ignoredControls ?? isolationDebug?.ignoredControls;
  if (ignoredControls) {
    debug.ignoredControls = ignoredControls;
  }
  if (verificationDebug?.unmatchedSelectedRows) {
    debug.unmatchedSelectedRows = verificationDebug.unmatchedSelectedRows;
  }
  if (verificationDebug?.missingTitles) {
    debug.missingTitles = verificationDebug.missingTitles;
  }
  if (isolationDebug?.quantityAdjustments) {
    debug.quantityAdjustments = isolationDebug.quantityAdjustments;
  }
  if (verificationDebug?.quantityMismatches) {
    debug.quantityMismatches = verificationDebug.quantityMismatches;
  }
  if (verificationDebug?.finalVerificationReason) {
    debug.finalVerificationReason = verificationDebug.finalVerificationReason;
  }
  return debug;
}

async function clickCheckoutIfAvailable(page: Page): Promise<boolean> {
  return clickButtonByText(page, ["Proceed to Checkout", "CHECK OUT", "Checkout", "PROCEED TO CHECKOUT"]).catch(() => false);
}

async function clickButtonByText(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const locator = page.getByRole("button", { name: label });
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      await locator.first().click({ timeout: 5000 }).catch(() => undefined);
      return true;
    }
    const textLocator = page.getByText(label, { exact: false });
    const textCount = await textLocator.count().catch(() => 0);
    if (textCount > 0) {
      await textLocator.first().click({ timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function waitForDarazCheckoutReady(page: Page, products: DarazSelectedProduct[]): Promise<DarazCheckoutReadyResult> {
  const attempts: DarazCheckoutReadyResult["attempts"] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = attempt < 2 ? "cart_button" : "direct_checkout";
    if (source === "cart_button") {
      if (attempt > 0 || !/cart\.daraz\.lk\/cart/i.test(page.url())) {
        await page.goto(DARAZ_CART_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      }
      const clicked = await clickCheckoutIfAvailable(page);
      if (!clicked) {
        attempts.push({
          url: page.url(),
          ready: false,
          source,
          reason: "checkout_button_unavailable",
          textExcerpt: redactCheckoutText(await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""))
        });
        continue;
      }
    } else {
      await page.goto(DARAZ_CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(attempt === 0 ? 1500 : 2500);

    const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const state = await classifyDarazProtectedPageState(page.url(), text, { checkoutShellIsRetryable: true });
    const ready = /checkout\.daraz\.lk/i.test(page.url()) && !state && isDarazCheckoutReadyText(text, products);
    attempts.push({
      url: page.url(),
      ready,
      source,
      ...(state ? { state } : {}),
      ...(ready ? {} : { reason: checkoutNotReadyReason(text, products, state) }),
      textExcerpt: redactCheckoutText(text)
    });

    if (state) {
      return { ready: false, text, state, attempts, message: statusMessage(cartStateToStatus(state)) };
    }
    if (ready) {
      return { ready: true, text, attempts };
    }
  }

  return {
    ready: false,
    text: attempts.at(-1)?.textExcerpt ?? "",
    attempts,
    message: attempts.some((attempt) => attempt.reason === "logged_out_shell")
      ? "Daraz checkout did not accept the cart session. Keep the inbuilt browser open and try final price check again."
      : "Daraz checkout did not finish loading the selected product prices. Try final price check again."
  };
}

async function classifyDarazProtectedPageState(
  url: string,
  text: string,
  options: { checkoutShellIsRetryable?: boolean } = {}
): Promise<DarazPageState | undefined> {
  const directState = classifyPageTextLike(text);
  if (directState) {
    return directState;
  }
  if (options.checkoutShellIsRetryable && /checkout\.daraz\.lk/i.test(url) && isDarazLoggedOutShell(text)) {
    return undefined;
  }
  if (/checkout\.daraz\.lk|cart\.daraz\.lk/i.test(url) && isDarazLoggedOutShell(text)) {
    return "login_required";
  }
  return undefined;
}

function classifyPageTextLike(text: string): DarazPageState | undefined {
  if (/\bcaptcha\b/i.test(text)) {
    return "captcha";
  }
  if (/\b(verify\s+you\s+are\s+(a\s+)?human|robot|access\s+denied|temporarily\s+blocked|unusual\s+traffic|are\s+you\s+human)\b/i.test(text)) {
    return "blocked";
  }
  if (/\b(sign\s+in|log\s+in|please\s+login|login\s+with\s+password|enter\s+your\s+password|phone\s+number\s+or\s+email|forgot\s+password|verification\s+code|two[-\s]?step|multi[-\s]?factor|mfa)\b/i.test(text)) {
    return "login_required";
  }
  return undefined;
}

function isDarazLoggedOutShell(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return /\bLOGIN\b/.test(normalized)
    && /\bSIGN\s+UP\b/.test(normalized)
    && !/\b(order\s+summary|shipping\s*&\s*billing|delivery\s+or\s+pickup|items?\s+total|proceed\s+to\s+pay)\b/i.test(normalized);
}

function isDarazCheckoutReadyText(text: string, products: DarazSelectedProduct[]): boolean {
  const normalized = normalizeCartMatchText(text);
  const hasCheckoutSignal = /\b(order\s+summary|shipping\s*&\s*billing|delivery\s+or\s+pickup|items?\s+total|order\s+total|proceed\s+to\s+pay|total)\b/i.test(text);
  const hasMoney = /rs\.?\s*[\d,]+/i.test(text);
  const hasProduct = products.some((product) => productMatchesNormalizedText(normalized, product));
  return hasCheckoutSignal && hasMoney && (hasProduct || products.length === 1);
}

function checkoutNotReadyReason(text: string, products: DarazSelectedProduct[], state?: DarazPageState): string {
  if (state) {
    return state;
  }
  if (!text.replace(/\s+/g, " ").trim()) {
    return "empty_checkout_page";
  }
  if (isDarazLoggedOutShell(text)) {
    return "logged_out_shell";
  }
  if (!/rs\.?\s*[\d,]+/i.test(text)) {
    return "missing_checkout_prices";
  }
  const normalized = normalizeCartMatchText(text);
  if (!products.some((product) => productMatchesNormalizedText(normalized, product))) {
    return "missing_selected_product_text";
  }
  return "missing_checkout_summary";
}

async function finishDarazResult(
  evidenceStore: EvidenceStore,
  runId: string,
  startedAt: string,
  evidence: Evidence[],
  products: DarazProductPrice[],
  status: DarazCheckResult["status"],
  message?: string,
  checkoutTotal?: Money,
  priceBreakdown: DarazPriceBreakdownItem[] = [],
  globalAdjustments: Adjustment[] = []
): Promise<DarazCheckResult> {
  const result = DarazCheckResultSchema.parse({
    runId,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    products,
    checkoutTotal,
    priceBreakdown,
    globalAdjustments,
    evidence,
    message
  });
  result.evidence.push(await evidenceStore.writeJson(runId, "result.json", result));
  return result;
}

function productToPrice(product: DarazSelectedProduct, status: DarazProductStatus, note?: string): DarazProductPrice {
  return {
    title: product.title,
    url: product.url,
    quantity: 1,
    observedPrice: product.observedPrice,
    breakdown: product.observedPrice ? [{
      label: "Product page price",
      kind: "product_subtotal",
      amount: product.observedPrice
    }] : [],
    status,
    note
  };
}

function productsWithStatus(
  products: DarazSelectedProduct[],
  existingPrices: DarazProductPrice[],
  status: DarazProductStatus
): DarazProductPrice[] {
  return products.map((product, index) => {
    const existingPrice = existingPrices[index];
    if (existingPrice) {
      return {
        ...existingPrice,
        status,
        note: statusMessage(status)
      };
    }
    return productToPrice(product, status, statusMessage(status));
  });
}

async function screenshot(evidenceStore: EvidenceStore, runId: string, page: Page, name: string) {
  return evidenceStore.writeBinary(runId, name, await page.screenshot({ fullPage: true }), "screenshot");
}

function extractLabeledDarazPrice(text: string, labels: string[]): Money | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const match = text.match(new RegExp(`\\b${escaped}\\b[\\s\\S]{0,80}?(-?\\s*Rs\\.?\\s*[\\d,]+(?:\\.\\d{1,2})?)`, "i"));
    if (match?.[1]) {
      return parseDarazPrice(match[1]);
    }
  }
  return undefined;
}

function extractDarazCheckoutItemCount(text: string): number | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^items?\s+total\s*(?:\(\s*)?(\d+)\s*items?\)?\b/i)
      ?? line.match(/^(\d+)\s*items?\s+total\b/i);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function findPriceNearTitle(text: string, title: string): Money | undefined {
  const key = title.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${key}[\\s\\S]{0,400}?(Rs\\.?\\s*[\\d,]+(?:\\.\\d{1,2})?)`, "i"));
  return match?.[1] ? parseDarazPrice(match[1]) : undefined;
}

function productBreakdown(product: DarazSelectedProduct, unitPrice?: Money, linePrice?: Money): DarazPriceBreakdownItem[] {
  const breakdown: DarazPriceBreakdownItem[] = [];

  if (product.observedPrice) {
    breakdown.push({
      label: "Product page unit price",
      kind: "product_subtotal",
      amount: product.observedPrice
    });
  }
  if (unitPrice) {
    breakdown.push({
      label: "Checkout unit price",
      kind: "product_subtotal",
      amount: unitPrice
    });
  }
  if (linePrice) {
    breakdown.push({
      label: "Checkout line price",
      kind: "product_subtotal",
      amount: linePrice
    });
  }

  return breakdown;
}

function extractDarazPriceBreakdownFromText(text: string): DarazPriceBreakdownItem[] {
  const items: DarazPriceBreakdownItem[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sameLine = line.match(/^(.*?)(-?\s*Rs\.?\s*[\d,]+(?:\.\d{1,2})?|free)$/i);
    if (sameLine?.[1] && sameLine[2]) {
      addBreakdownItem(items, sameLine[1], sameLine[2]);
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (/^(-?\s*Rs\.?\s*[\d,]+(?:\.\d{1,2})?|free)$/i.test(nextLine)) {
      if (addBreakdownItem(items, line, nextLine)) {
        index += 1;
      }
    }
  }

  return dedupeBreakdown(items);
}

function addBreakdownItem(items: DarazPriceBreakdownItem[], rawLabel: string, rawAmount: string): boolean {
  const label = cleanBreakdownLabel(rawLabel);
  const kind = classifyBreakdownLabel(label);
  if (!kind) {
    return false;
  }

  const amount = parseBreakdownAmount(rawAmount, label);
  if (!amount) {
    return false;
  }

  items.push({ label, kind, amount });
  return true;
}

function completeCheckoutBreakdown(
  extracted: DarazPriceBreakdownItem[],
  products: DarazProductPrice[],
  checkoutTotal?: Money
): DarazPriceBreakdownItem[] {
  const items = [...extracted];
  const productSubtotal = sumProductCheckoutLines(products);

  if (productSubtotal && !items.some((item) => item.kind === "product_subtotal")) {
    items.unshift({
      label: "Product subtotal",
      kind: "product_subtotal",
      amount: productSubtotal
    });
  }

  if (checkoutTotal && !items.some((item) => item.kind === "total")) {
    items.push({
      label: "Checkout total",
      kind: "total",
      amount: checkoutTotal
    });
  }

  return dedupeBreakdown(items);
}

function sumProductCheckoutLines(products: DarazProductPrice[]): Money | undefined {
  const amounts = products
    .map((product) => product.checkoutLinePrice)
    .filter((price): price is Money => Boolean(price));

  if (amounts.length === 0) {
    return undefined;
  }

  return {
    currency: "LKR",
    minorUnits: amounts.reduce((total, amount) => total + moneyToMinorUnits(amount), 0)
  };
}

function parseBreakdownAmount(rawAmount: string, label: string): Money | undefined {
  if (/free/i.test(rawAmount)) {
    return { currency: "LKR", minorUnits: 0 };
  }

  const amount = parseDarazPrice(rawAmount);
  if (!amount) {
    return undefined;
  }

  const shouldBeNegative = /discount|voucher|coupon|saving|promotion|promo/i.test(label);
  if (shouldBeNegative && amount.minorUnits !== undefined && amount.minorUnits > 0) {
    return { ...amount, minorUnits: -amount.minorUnits };
  }
  return amount;
}

function priceFromCheckoutRow(
  row: DarazCheckoutProductRow
): { unitPrice: Money; linePrice: Money } | undefined {
  const displayedPrice = row.priceTexts.map((priceText) => parseDarazPrice(priceText)).find((price): price is Money => Boolean(price));
  if (!displayedPrice) {
    return undefined;
  }

  return { unitPrice: displayedPrice, linePrice: displayedPrice };
}

function cleanBreakdownLabel(label: string): string {
  return label
    .replace(/[:：-]+$/g, "")
    .replace(/\bRs\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function classifyBreakdownLabel(label: string): DarazPriceBreakdownItem["kind"] | undefined {
  const lower = label.toLowerCase();
  if (/\b(subtotal|items?\s+total|product\s+total|merchandise)\b/.test(lower)) {
    return "product_subtotal";
  }
  if (/\b(delivery|shipping|ship fee|delivery fee)\b/.test(lower)) {
    return "delivery";
  }
  if (/\bplatform\b/.test(lower)) {
    return "platform_fee";
  }
  if (/\b(service|handling|processing|admin|convenience|online)\b/.test(lower)) {
    return "service_fee";
  }
  if (/\b(tax|vat)\b/.test(lower)) {
    return "tax";
  }
  if (/\b(voucher|coupon)\b/.test(lower)) {
    return "voucher";
  }
  if (/\b(discount|saving|promotion|promo)\b/.test(lower)) {
    return "discount";
  }
  if (/\b(grand total|order total|total)\b/.test(lower)) {
    return "total";
  }
  if (/\b(fee|charge)\b/.test(lower)) {
    return "other";
  }
  return undefined;
}

function dedupeBreakdown(items: DarazPriceBreakdownItem[]): DarazPriceBreakdownItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.label.toLowerCase()}:${item.amount.minorUnits ?? item.amount.amount}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function breakdownToAdjustments(items: DarazPriceBreakdownItem[]): Adjustment[] {
  return items.flatMap((item) => {
    const kind = adjustmentKindForBreakdown(item.kind);
    return kind ? [{ label: item.label, kind, amount: item.amount }] : [];
  });
}

function adjustmentKindForBreakdown(kind: DarazPriceBreakdownItem["kind"]): Adjustment["kind"] | undefined {
  switch (kind) {
    case "delivery":
      return "shipping";
    case "platform_fee":
    case "service_fee":
    case "other":
      return "fee";
    case "tax":
      return "tax";
    case "discount":
      return "promotion";
    case "voucher":
      return "coupon";
    default:
      return undefined;
  }
}

function cartStateToStatus(state: "captcha" | "blocked" | "login_required"): DarazProductStatus {
  return state === "captcha" ? "blocked" : state;
}

function resultStatusFromProductStatus(status: DarazProductStatus): DarazCheckResult["status"] {
  if (status === "unavailable") {
    return "needs_attention";
  }
  return status;
}

function productStatusFromSessionStatus(status: DarazSessionStatus): DarazProductStatus {
  switch (status) {
    case "needs_login":
    case "missing":
      return "login_required";
    case "needs_verification":
      return "blocked";
    default:
      return "needs_attention";
  }
}

function updateDarazProfileSessionAfterStatus(sessionsDir: string, status: DarazProductStatus, validationUrl?: string, proxy?: ProxySummary): void {
  if (status === "login_required") {
    invalidateDarazProfileSession(sessionsDir, statusMessage(status), proxy);
    return;
  }
  if (status === "blocked") {
    markDarazProfileSessionNeedsVerification(sessionsDir, validationUrl, proxy);
    return;
  }
  if (status === "checked") {
    markDarazProfileSessionSaved(sessionsDir, validationUrl, proxy);
  }
}

function writeDarazProfileSessionMetadata(sessionsDir: string, metadata: DarazSessionMetadata): void {
  ensureDarazProfileDir(sessionsDir);
  writeFileSync(darazProfileMetadataPath(sessionsDir), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function ensureDarazProfileDir(sessionsDir: string): void {
  mkdirSync(darazProfilePath(sessionsDir), { recursive: true });
}

function statusMessage(status: DarazProductStatus): string {
  switch (status) {
    case "login_required":
      return "Daraz session expired. Login again with the inbuilt browser.";
    case "blocked":
      return "Manual verification needed. Complete Daraz verification in the inbuilt browser, then save login and run final price check again.";
    case "unavailable":
      return "This product could not be added to cart.";
    case "needs_attention":
      return "Daraz showed a page that needs manual review.";
    default:
      return "Checked.";
  }
}

function makeDarazId(url: string, index: number): string {
  const match = url.match(/i(\d+)-s(\d+)/i) ?? url.match(/\/([^/?#]+)\.html/i);
  return match?.slice(1).join("-") || `daraz-${index}`;
}

function darazProductKeys(products: DarazSelectedProduct[]): DarazCartProductKey[] {
  return products.map((product) => ({
    title: product.title,
    key: normalizeCartMatchText(product.title),
    shortKey: firstWordsKey(product.title, 8),
    idKey: normalizeCartMatchText(makeDarazId(product.url, 0)),
    urlKey: normalizeCartMatchText(product.url),
    quantity: 1
  }));
}

function firstWordsKey(value: string, count: number): string {
  return normalizeCartMatchText(value).split(/\s+/).filter(Boolean).slice(0, count).join(" ");
}

function productMatchesNormalizedText(normalizedText: string, product: DarazSelectedProduct): boolean {
  const key = normalizeCartMatchText(product.title);
  const shortKey = firstWordsKey(product.title, 8);
  const idKey = normalizeCartMatchText(makeDarazId(product.url, 0));
  const urlKey = normalizeCartMatchText(product.url);
  return [key, shortKey, idKey, urlKey].some((candidate) => candidate && normalizedText.includes(candidate));
}

function normalizeCartMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function redactCheckoutText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?\d[\s-]?){7,}\b/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

function absoluteDarazUrl(url: string): string {
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  if (url.startsWith("/")) {
    return `https://www.daraz.lk${url}`;
  }
  return url;
}

function extractHtmlMeta(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  return decodeHtml(pattern.exec(html)?.[1] ?? "").trim() || undefined;
}

function extractTitleTag(html: string): string | undefined {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || undefined;
}

function cleanProductTitle(title: string): string {
  return decodeHtml(title)
    .replace(/\s*\|\s*Daraz\.lk.*$/i, "")
    .replace(/\s*-\s*Daraz\.lk.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function cleanImageUrl(imageUrl?: string): string | undefined {
  const trimmed = imageUrl?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
}

function safeFile(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "product";
}
