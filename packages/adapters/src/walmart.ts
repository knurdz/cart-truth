import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  classifyPageState,
  guardedClickByRole,
  installNeverPurchaseGuards,
  minorUnitsToMoney,
  moneyToMinorUnits,
  parseMoneyText,
  proxyToPlaywright,
  type AdapterContext,
  type AdapterRunResult,
  type RetailerAdapter
} from "@carttruth/core";
import type { Adjustment, CartItemRequest, FailureReason, LineItem, Money, ObservedCartTotal, RetailerId } from "@carttruth/schemas";

const WALMART_CART_URL = "https://www.walmart.com/cart";
const WALMART_CHECKOUT_URL = "https://www.walmart.com/checkout";

export class WalmartAdapter implements RetailerAdapter {
  readonly id = "walmart";

  supports(retailer: RetailerId): boolean {
    return retailer === "walmart";
  }

  async run(context: AdapterContext): Promise<AdapterRunResult> {
    const sessionPath = walmartSessionPath(context.request.accountRef);
    if (!existsSync(sessionPath)) {
      return {
        failure: {
          code: "login_required",
          message: `Missing Walmart session state for ${context.request.accountRef}. Run account login capture first.`,
          retryable: false,
          details: { sessionPath }
        },
        metadata: { adapter: this.id, sessionPath }
      };
    }

    const browser = await chromium.launch({ headless: context.request.metadata.headed === true ? false : true });
    let browserContext: BrowserContext | undefined;

    try {
      browserContext = await browser.newContext({
        storageState: sessionPath,
        viewport: { width: 1440, height: 1100 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(context.proxyLease ? { proxy: proxyToPlaywright(context.proxyLease.profile) } : {})
      });
      const page = await browserContext.newPage();
      await installNeverPurchaseGuards(page);

      const evidence = [
        await context.evidenceStore.writeJson(context.runId, "adapter-manifest.json", {
          adapter: this.id,
          accountRef: context.request.accountRef,
          itemCount: context.request.items.length,
          sessionPath,
          proxy: context.proxyLease?.profile.id ?? "none",
          strategy: "checkout-estimate-with-cart-fallback"
        })
      ];

      for (const item of context.request.items) {
        const failure = await addItemToCart(page, item);
        if (failure) {
          evidence.push(await screenshot(context, page, "walmart-add-item-failure.png"));
          return { failure, evidence, metadata: { adapter: this.id, phase: "add-item" } };
        }
      }

      await page.goto(WALMART_CART_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      const cartState = await classifyPageState(page);
      if (cartState) {
        evidence.push(await screenshot(context, page, "walmart-cart-blocked.png"));
        return {
          failure: stateToFailure(cartState, "Walmart cart page requires operator attention."),
          evidence,
          metadata: { adapter: this.id, phase: "cart" }
        };
      }

      evidence.push(await screenshot(context, page, "walmart-cart.png"));
      const cartObserved = await extractObservedTotal(page, context.request.items, "cart");

      const checkoutObserved = await tryCheckoutEstimate(page, context, evidence);
      const observed = checkoutObserved ?? cartObserved;
      evidence.push(await context.evidenceStore.writeJson(context.runId, "observed-total.json", observed));

      return {
        observed,
        evidence,
        metadata: {
          adapter: this.id,
          phase: checkoutObserved ? "checkout-estimate" : "cart-fallback",
          checkoutFallbackUsed: !checkoutObserved
        }
      };
    } catch (error) {
      return {
        failure: {
          code: "adapter_failure",
          message: error instanceof Error ? error.message : "Unknown Walmart adapter error",
          retryable: true,
          details: {}
        },
        metadata: { adapter: this.id }
      };
    } finally {
      await browserContext?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

export function walmartSessionPath(accountRef: string, sessionsDir = process.env.CARTTRUTH_SESSIONS_DIR ?? ".carttruth/sessions"): string {
  return resolve(sessionsDir, "walmart", `${accountRef}.json`);
}

export function extractMoneyByLabels(text: string, labels: string[]): Money | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*[:\\n\\t ]+(-?\\$?\\s*\\d[\\d,.]*(?:\\.\\d{1,2})?)`, "i"));
    if (match?.[1]) {
      return parseMoneyText(match[1]);
    }
  }
  return undefined;
}

async function addItemToCart(page: Page, item: CartItemRequest): Promise<FailureReason | undefined> {
  await page.goto(item.productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  const state = await classifyPageState(page);
  if (state) {
    return stateToFailure(state, `Walmart product page is not usable: ${item.productUrl}`);
  }

  for (let index = 0; index < item.quantity; index += 1) {
    const clicked = await clickFirstAvailable(page, [
      /^add to cart$/i,
      /add to cart/i,
      /add item to cart/i
    ]);
    if (!clicked) {
      return {
        code: "product_unavailable",
        message: `Could not find a safe add-to-cart button for ${item.productUrl}`,
        retryable: false,
        details: { productUrl: item.productUrl }
      };
    }
    await page.waitForTimeout(1500);
  }
}

async function clickFirstAvailable(page: Page, names: RegExp[]): Promise<boolean> {
  for (const name of names) {
    try {
      await guardedClickByRole(page, name);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Refusing unsafe purchase action")) {
        throw error;
      }
    }
  }
  return false;
}

async function tryCheckoutEstimate(
  page: Page,
  context: AdapterContext,
  evidence: Awaited<ReturnType<typeof context.evidenceStore.writeJson>>[]
): Promise<ObservedCartTotal | undefined> {
  const clickedCheckout = await clickFirstAvailable(page, [/checkout/i, /continue to checkout/i]).catch(() => false);
  if (!clickedCheckout) {
    await page.goto(WALMART_CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const state = await classifyPageState(page);
  if (state) {
    evidence.push(await screenshot(context, page, `walmart-checkout-${state}.png`));
    return undefined;
  }

  const url = page.url();
  if (/\/checkout|\/order|\/cart/i.test(url)) {
    evidence.push(await screenshot(context, page, "walmart-checkout-estimate.png"));
    return extractObservedTotal(page, context.request.items, "checkout-estimate");
  }

  return undefined;
}

async function extractObservedTotal(page: Page, requestedItems: CartItemRequest[], source: string): Promise<ObservedCartTotal> {
  const text = await page.locator("body").innerText({ timeout: 10000 });
  const subtotal = extractMoneyByLabels(text, ["Subtotal", "Items subtotal", "Item subtotal", "Merchandise subtotal"]);
  const shipping = extractMoneyByLabels(text, ["Shipping", "Delivery", "Shipping fee", "Delivery fee"]);
  const tax = extractMoneyByLabels(text, ["Estimated taxes", "Taxes", "Tax"]);
  const discounts = extractMoneyByLabels(text, ["Savings", "Discounts", "Promo", "Promotions"]);
  const fees = extractMoneyByLabels(text, ["Fees", "Bag fee", "Service fee"]);
  const total =
    extractMoneyByLabels(text, ["Estimated total", "Total", "Order total", "Cart total"]) ??
    subtotal ??
    minorUnitsToMoney(0);

  const lineItems: LineItem[] = requestedItems.map((item, index) => ({
    name: item.sku ? `Walmart item ${item.sku}` : `Walmart item ${index + 1}`,
    sku: item.sku,
    productUrl: item.productUrl,
    quantity: item.quantity,
    unitPrice: item.expectedUnitPrice ?? minorUnitsToMoney(0),
    lineTotal: item.expectedUnitPrice
      ? minorUnitsToMoney(item.quantity * moneyToMinorUnits(item.expectedUnitPrice))
      : minorUnitsToMoney(0)
  }));

  const adjustments: Adjustment[] = [
    ...(shipping ? [{ label: "Shipping", kind: "shipping" as const, amount: shipping }] : []),
    ...(tax ? [{ label: "Tax", kind: "tax" as const, amount: tax }] : []),
    ...(fees ? [{ label: "Fees", kind: "fee" as const, amount: fees }] : []),
    ...(discounts ? [{ label: "Discounts", kind: "promotion" as const, amount: discounts }] : [])
  ];

  return {
    currency: "USD",
    subtotal,
    shipping,
    tax,
    discounts,
    fees,
    total,
    lineItems,
    adjustments,
    capturedAt: new Date().toISOString(),
    source
  } as ObservedCartTotal & { source: string };
}

async function screenshot(context: AdapterContext, page: Page, name: string) {
  const image = await page.screenshot({ fullPage: true });
  return context.evidenceStore.writeBinary(context.runId, name, image, "screenshot");
}

function stateToFailure(state: "captcha" | "blocked" | "login_required", message: string): FailureReason {
  return {
    code: state,
    message,
    retryable: state !== "login_required",
    details: {}
  };
}
