import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  classifyPageState,
  installNeverPurchaseGuards,
  moneyToMinorUnits,
  parseMoneyText,
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
  type Money
} from "@carttruth/schemas";

const DARAZ_HOME_URL = "https://www.daraz.lk/";
const DARAZ_CART_URL = "https://cart.daraz.lk/cart";
const DARAZ_CHECKOUT_URL = "https://checkout.daraz.lk/shipping";

export interface DarazServiceOptions {
  evidenceStore: EvidenceStore;
  sessionsDir?: string;
  headless?: boolean;
}

export class DarazService {
  private readonly sessionsDir: string;

  constructor(private readonly options: DarazServiceOptions) {
    this.sessionsDir = resolve(options.sessionsDir ?? ".carttruth/sessions");
  }

  async search(query: string, limit = 12): Promise<DarazSearchResult[]> {
    const browser = await chromium.launch({ headless: true });
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
    const browser = await chromium.launch({ headless: true });
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

    if (!hasSavedSession) {
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

    let context: BrowserContext | undefined;

    try {
      context = await chromium.launchPersistentContext(profilePath, {
        headless: this.options.headless ?? true,
        viewport: { width: 1365, height: 900 }
      });
      const page = context.pages()[0] ?? await context.newPage();
      await installNeverPurchaseGuards(page);

      evidence.push(await this.options.evidenceStore.writeJson(runId, "selected-products.json", request.products));
      const prices: DarazProductPrice[] = [];

      for (const product of request.products) {
        const observedPrice = await readProductPagePrice(page, product).catch(() => product.observedPrice);
        const addStatus = await addProductToCart(page, product);
        if (addStatus !== "checked") {
          evidence.push(await screenshot(this.options.evidenceStore, runId, page, `daraz-${safeFile(product.id)}-add-failed.png`));
          prices.push(productToPrice({ ...product, observedPrice }, addStatus, statusMessage(addStatus)));
        } else {
          prices.push(productToPrice({ ...product, observedPrice }, "needs_attention", "Added to cart; waiting for checkout price."));
        }
      }

      await page.goto(DARAZ_CART_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      evidence.push(await screenshot(this.options.evidenceStore, runId, page, "daraz-cart.png"));

      const cartState = await classifyPageState(page);
      if (cartState) {
        const status = cartStateToStatus(cartState);
        return await finishDarazResult(this.options.evidenceStore, runId, startedAt, evidence, prices.map((price) => ({
          ...price,
          status,
          note: statusMessage(status)
        })), resultStatusFromProductStatus(status), statusMessage(status));
      }

      await clickCheckoutIfAvailable(page);
      await page.goto(DARAZ_CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      evidence.push(await screenshot(this.options.evidenceStore, runId, page, "daraz-checkout.png"));

      const checkoutState = await classifyPageState(page);
      if (checkoutState) {
        const status = cartStateToStatus(checkoutState);
        return await finishDarazResult(this.options.evidenceStore, runId, startedAt, evidence, prices.map((price) => ({
          ...price,
          status,
          note: statusMessage(status)
        })), resultStatusFromProductStatus(status), statusMessage(status));
      }

      const checkoutText = await page.locator("body").innerText({ timeout: 10000 });
      const checkoutPrices = extractDarazCheckoutPricesFromText(checkoutText, request.products);
      const mergedPrices = prices.map((price, index) => ({
        ...price,
        ...checkoutPrices.products[index],
        status: checkoutPrices.products[index]?.status ?? "needs_attention",
        note: checkoutPrices.products[index]?.note
      }));

      return await finishDarazResult(
        this.options.evidenceStore,
        runId,
        startedAt,
        evidence,
        mergedPrices,
        mergedPrices.every((price) => price.status === "checked") ? "checked" : "needs_attention",
        mergedPrices.every((price) => price.status === "checked") ? undefined : "Some checkout prices need manual review.",
        checkoutPrices.checkoutTotal,
        checkoutPrices.priceBreakdown,
        checkoutPrices.globalAdjustments
      );
    } catch (error) {
      return await finishDarazResult(
        this.options.evidenceStore,
        runId,
        startedAt,
        evidence,
        request.products.map((product) => productToPrice(product, "needs_attention", error instanceof Error ? error.message : "Unable to check Daraz price.")),
        "error",
        error instanceof Error ? error.message : "Unable to check Daraz price."
      );
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
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

export function hasDarazProfileSession(sessionsDir = ".carttruth/sessions"): boolean {
  return existsSync(darazProfileReadyPath(sessionsDir));
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

export function extractDarazCheckoutPricesFromText(text: string, products: DarazSelectedProduct[]): {
  products: DarazProductPrice[];
  checkoutTotal?: Money;
  priceBreakdown: DarazPriceBreakdownItem[];
  globalAdjustments: Adjustment[];
} {
  const extractedBreakdown = extractDarazPriceBreakdownFromText(text);
  const productSubtotal = extractedBreakdown.find((item) => item.kind === "product_subtotal")?.amount;
  const checkoutTotal = extractedBreakdown.find((item) => item.kind === "total")?.amount
    ?? extractLabeledDarazPrice(text, ["Order Total", "Grand Total"]);

  const productPrices = products.map((product) => {
    const linePrice = findPriceNearTitle(text, product.title)
      ?? (products.length === 1 ? productSubtotal : undefined);
    const unitPrice = linePrice && product.quantity > 1 && linePrice.minorUnits !== undefined
      ? { currency: "LKR", minorUnits: Math.round(linePrice.minorUnits / product.quantity) }
      : linePrice;

    return {
      title: product.title,
      url: product.url,
      quantity: product.quantity,
      observedPrice: product.observedPrice,
      checkoutUnitPrice: unitPrice,
      checkoutLinePrice: linePrice,
      breakdown: productBreakdown(product, unitPrice, linePrice),
      status: linePrice ? "checked" : "needs_attention",
      note: linePrice ? undefined : "Could not find this item price on the checkout page. Product-page price was not reused as checkout price."
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

async function readProductPagePrice(page: Page, product: DarazSelectedProduct): Promise<Money | undefined> {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const text = await page.locator("body").innerText({ timeout: 10000 });
  return parseDarazPrice(text) ?? product.observedPrice;
}

async function addProductToCart(page: Page, product: DarazSelectedProduct): Promise<DarazProductStatus> {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const state = await classifyPageState(page);
  if (state) {
    return cartStateToStatus(state);
  }

  for (let count = 0; count < product.quantity; count += 1) {
    const clicked = await clickButtonByText(page, ["Add to Cart", "ADD TO CART", "Add to cart"]);
    if (!clicked) {
      return "unavailable";
    }
    await page.waitForTimeout(1200);
  }

  return "checked";
}

async function clickCheckoutIfAvailable(page: Page): Promise<void> {
  await clickButtonByText(page, ["Proceed to Checkout", "CHECK OUT", "Checkout", "PROCEED TO CHECKOUT"]).catch(() => false);
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
    quantity: product.quantity,
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
  if (/\b(service|handling|processing|admin|convenience)\b/.test(lower)) {
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

function statusMessage(status: DarazProductStatus): string {
  switch (status) {
    case "login_required":
      return "Daraz session expired. Login again with the inbuilt browser.";
    case "blocked":
      return "Daraz asked for verification. Try again later or complete the check manually.";
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
