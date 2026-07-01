import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEvidenceStore } from "@carttruth/core";
import {
  DarazService,
  darazProfilePath,
  darazProfileReadyPath,
  extractDarazProductFromHtml,
  extractDarazCheckoutPricesFromText,
  extractDarazSearchResultsFromHtml,
  normalizeDarazProductUrl,
  parseDarazPrice
} from "@carttruth/adapters";

const tempDirs: string[] = [];

describe("Daraz helpers", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("parses Sri Lankan rupee prices", () => {
    expect(parseDarazPrice("Rs. 1,234")).toEqual({ currency: "LKR", minorUnits: 123400 });
  });

  it("extracts search cards from fixture HTML", () => {
    const results = extractDarazSearchResultsFromHtml(`
      <a href="/products/sample-i123-s456.html">
        <img src="https://example.com/image.jpg" />
        Sample Daraz Product
        <span>Rs. 2,500</span>
      </a>
    `);

    expect(results[0]).toMatchObject({
      title: expect.stringContaining("Sample Daraz Product"),
      url: "https://www.daraz.lk/products/sample-i123-s456.html",
      observedPrice: { currency: "LKR", minorUnits: 250000 }
    });
  });

  it("extracts a pasted product link from fixture HTML", () => {
    const product = extractDarazProductFromHtml(`
      <html>
        <head>
          <meta property="og:title" content="Singer CRT TV Remote Controller | Daraz.lk" />
          <meta property="og:image" content="https://static-01.daraz.lk/sample.jpg" />
        </head>
        <body>
          <span class="pdp-price">Rs. 890</span>
        </body>
      </html>
    `, "https://www.daraz.lk/products/singer-crt-tv-remote-controller-i106694729-s1014616565.html?pvid=test");

    expect(product).toMatchObject({
      id: "106694729-1014616565",
      title: "Singer CRT TV Remote Controller",
      url: "https://www.daraz.lk/products/singer-crt-tv-remote-controller-i106694729-s1014616565.html",
      observedPrice: { currency: "LKR", minorUnits: 89000 },
      imageUrl: "https://static-01.daraz.lk/sample.jpg"
    });
  });

  it("normalizes Daraz links and removes tracking parameters", () => {
    expect(normalizeDarazProductUrl("https://www.daraz.lk/products/sample-i1-s2.html?pvid=abc&spm=xyz"))
      .toBe("https://www.daraz.lk/products/sample-i1-s2.html");
  });

  it("uses a persistent Daraz profile path", () => {
    expect(darazProfilePath("/tmp/carttruth-sessions")).toBe("/tmp/carttruth-sessions/daraz/default-profile");
    expect(darazProfileReadyPath("/tmp/carttruth-sessions")).toBe("/tmp/carttruth-sessions/daraz/default-profile/.carttruth-session-ready");
  });

  it("extracts checkout prices from fixture text", () => {
    const result = extractDarazCheckoutPricesFromText(
      [
        "Sample Daraz Product",
        "Qty 2",
        "Rs. 5,000",
        "Items Total",
        "Rs. 5,000",
        "Delivery Fee",
        "Rs. 250",
        "Platform Fee",
        "Rs. 99",
        "Voucher Discount",
        "-Rs. 100",
        "Order Total",
        "Rs. 5,249"
      ].join("\n"),
      [{
        id: "item-1",
        title: "Sample Daraz Product",
        url: "https://www.daraz.lk/products/sample-i1-s1.html",
        observedPrice: { currency: "LKR", minorUnits: 250000 },
        quantity: 2
      }]
    );

    expect(result.products[0]?.status).toBe("checked");
    expect(result.products[0]?.checkoutLinePrice).toEqual({ currency: "LKR", minorUnits: 500000 });
    expect(result.checkoutTotal).toEqual({ currency: "LKR", minorUnits: 524900 });
    expect(result.priceBreakdown).toEqual(expect.arrayContaining([
      { label: "Items Total", kind: "product_subtotal", amount: { currency: "LKR", minorUnits: 500000 } },
      { label: "Delivery Fee", kind: "delivery", amount: { currency: "LKR", minorUnits: 25000 } },
      { label: "Platform Fee", kind: "platform_fee", amount: { currency: "LKR", minorUnits: 9900 } },
      { label: "Voucher Discount", kind: "voucher", amount: { currency: "LKR", minorUnits: -10000 } },
      { label: "Order Total", kind: "total", amount: { currency: "LKR", minorUnits: 524900 } }
    ]));
    expect(result.globalAdjustments).toEqual(expect.arrayContaining([
      { label: "Delivery Fee", kind: "shipping", amount: { currency: "LKR", minorUnits: 25000 } },
      { label: "Platform Fee", kind: "fee", amount: { currency: "LKR", minorUnits: 9900 } },
      { label: "Voucher Discount", kind: "coupon", amount: { currency: "LKR", minorUnits: -10000 } }
    ]));
  });

  it("extracts the Daraz order-summary breakdown shown at checkout", () => {
    const result = extractDarazCheckoutPricesFromText(
      [
        "Delivery or Pickup",
        "Rs. 345",
        "Standard",
        "Singer CRT Tv Remote Controller",
        "Rs. 700",
        "Qty: 1",
        "Order Summary",
        "Items Total (1 Items)",
        "Rs. 700",
        "Delivery Fee",
        "Rs. 345",
        "Platform Fee",
        "Rs. 15",
        "Total:",
        "Rs. 1,060",
        "Proceed to Pay"
      ].join("\n"),
      [{
        id: "106694729-1014616565",
        title: "Singer CRT Tv Remote Controller",
        url: "https://www.daraz.lk/products/singer-crt-tv-remote-controller-i106694729-s1014616565.html",
        observedPrice: { currency: "LKR", minorUnits: 70000 },
        quantity: 1
      }]
    );

    expect(result.products[0]?.checkoutLinePrice).toEqual({ currency: "LKR", minorUnits: 70000 });
    expect(result.checkoutTotal).toEqual({ currency: "LKR", minorUnits: 106000 });
    expect(result.priceBreakdown).toEqual(expect.arrayContaining([
      { label: "Items Total (1 Items)", kind: "product_subtotal", amount: { currency: "LKR", minorUnits: 70000 } },
      { label: "Delivery Fee", kind: "delivery", amount: { currency: "LKR", minorUnits: 34500 } },
      { label: "Platform Fee", kind: "platform_fee", amount: { currency: "LKR", minorUnits: 1500 } },
      { label: "Total", kind: "total", amount: { currency: "LKR", minorUnits: 106000 } }
    ]));
  });

  it("does not reuse observed price as checkout price when checkout extraction fails", () => {
    const result = extractDarazCheckoutPricesFromText(
      "Checkout page loaded but item price is hidden",
      [{
        id: "item-1",
        title: "Sample Daraz Product",
        url: "https://www.daraz.lk/products/sample-i1-s1.html",
        observedPrice: { currency: "LKR", minorUnits: 70000 },
        quantity: 1
      }]
    );

    expect(result.products[0]?.status).toBe("needs_attention");
    expect(result.products[0]?.checkoutLinePrice).toBeUndefined();
    expect(result.products[0]?.note).toContain("Product-page price was not reused");
  });

  it("returns login_required when no Daraz session exists", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir
    });

    const result = await service.check({
      products: [{
        id: "item-1",
        title: "Sample Daraz Product",
        url: "https://www.daraz.lk/products/sample-i1-s1.html",
        observedPrice: { currency: "LKR", minorUnits: 10000 },
        quantity: 1
      }]
    });

    expect(result.status).toBe("login_required");
    expect(result.products[0]?.status).toBe("login_required");
  });

  it("does not allow guest checkout when no persistent Daraz profile exists", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir
    });

    const result = await service.check({
      allowGuestCheckout: true,
      products: [{
        id: "item-1",
        title: "Sample Daraz Product",
        url: "https://www.daraz.lk/products/sample-i1-s1.html",
        observedPrice: { currency: "LKR", minorUnits: 10000 },
        quantity: 1
      }]
    });

    expect(result.status).toBe("login_required");
    expect(result.message).toContain("inbuilt browser");
  });
});
