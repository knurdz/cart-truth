import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalEvidenceStore, parseProxyString, proxySummary, proxyToPlaywright } from "@carttruth/core";
import type { DarazSelectedProduct } from "@carttruth/schemas";

const playwrightMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  launchPersistentContext: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: playwrightMocks
}));

const {
  DarazService,
  darazProfilePath,
  darazProfileReadyPath,
  markDarazProfileSessionSaved,
  readDarazProfileSessionMetadata,
  repairDarazProfileLock
} = await import("@carttruth/adapters");
const { LocalRuntime, resolveDarazCheckHeadless, tryDarazAutoLogin } = await import("../apps/web/src/runtime.js");

const tempDirs: string[] = [];
const childProcesses: ChildProcess[] = [];
const execFileAsync = promisify(execFile);
const originalEnv = {
  CARTTRUTH_BROWSER_MODE: process.env.CARTTRUTH_BROWSER_MODE,
  CARTTRUTH_DARAZ_CHECK_HEADLESS: process.env.CARTTRUTH_DARAZ_CHECK_HEADLESS,
  DISPLAY: process.env.DISPLAY,
  CARTTRUTH_ADMIN_USERNAME: process.env.CARTTRUTH_ADMIN_USERNAME,
  CARTTRUTH_ADMIN_PASSWORD: process.env.CARTTRUTH_ADMIN_PASSWORD
};

const product: DarazSelectedProduct = {
  id: "item-1",
  title: "Sample Daraz Product",
  url: "https://www.daraz.lk/products/sample-i1-s1.html",
  observedPrice: { currency: "LKR", minorUnits: 100000 },
  availability: "available",
  quantity: 1
};

const secondProduct: DarazSelectedProduct = {
  id: "item-2",
  title: "Second Daraz Product",
  url: "https://www.daraz.lk/products/second-i2-s2.html",
  observedPrice: { currency: "LKR", minorUnits: 200000 },
  availability: "available",
  quantity: 1
};

afterEach(async () => {
  vi.clearAllMocks();
  restoreEnv();
  for (const child of childProcesses.splice(0)) {
    child.kill("SIGKILL");
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Daraz check Buy Now flow", () => {
  it("resolves Daraz checkout headless mode from VPS and override environment", () => {
    expect(resolveDarazCheckHeadless({ CARTTRUTH_BROWSER_MODE: "vnc" })).toBe(true);
    expect(resolveDarazCheckHeadless({})).toBe(true);
    expect(resolveDarazCheckHeadless({ CARTTRUTH_BROWSER_MODE: "headed", DISPLAY: ":0" })).toBe(false);
    expect(resolveDarazCheckHeadless({ CARTTRUTH_BROWSER_MODE: "vnc", CARTTRUTH_DARAZ_CHECK_HEADLESS: "false" })).toBe(false);
    expect(resolveDarazCheckHeadless({ CARTTRUTH_BROWSER_MODE: "headed", DISPLAY: ":0", CARTTRUTH_DARAZ_CHECK_HEADLESS: "true" })).toBe(true);
  });

  it("returns auto-login diagnostics when Daraz login controls are missing", async () => {
    const missingControl = {
      waitFor: vi.fn(async () => {
        throw new Error("control missing");
      }),
      fill: vi.fn(),
      click: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({ first: () => missingControl })),
      getByRole: vi.fn(() => ({ first: () => missingControl })),
      waitForLoadState: vi.fn()
    };

    const result = await tryDarazAutoLogin(page as never, {
      username: "buyer@example.com",
      password: "password"
    });

    expect(result).toEqual({
      usernameFound: false,
      passwordFound: false,
      loginButtonFound: false,
      submitted: false
    });
    expect(missingControl.fill).not.toHaveBeenCalled();
    expect(missingControl.click).not.toHaveBeenCalled();
  });

  it("passes TorchProxies to Daraz search and product lookup browsers", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const proxy = testProxyProfile();
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      proxyProfile: proxy
    });
    playwrightMocks.launch
      .mockResolvedValueOnce(fakeBrowser(new FakeDarazPage({ functionEvaluate: [] })))
      .mockResolvedValueOnce(fakeBrowser(new FakeDarazPage({
        functionEvaluate: {
          title: "Sample Daraz Product",
          priceText: "Rs. 1,000",
          imageUrl: "https://img.daraz.lk/sample.jpg",
          text: "Sample Daraz Product Rs. 1,000"
        }
      })));

    await service.search("sample");
    await service.productFromUrl(product.url);

    expect(playwrightMocks.launch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      headless: true,
      proxy: proxyToPlaywright(proxy)
    }));
    expect(playwrightMocks.launch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      headless: true,
      proxy: proxyToPlaywright(proxy)
    }));
  });

  it("returns login_required when a saved profile marker opens to Daraz login", async () => {
    const { service, sessionsDir } = await serviceWithReadyProfile();
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = "https://member.daraz.lk/user/login";
          state.bodyText = "Welcome to Daraz! Please login.";
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("login_required");
    expect(result.message).toBe("Daraz still shows the login page. Finish login in the inbuilt browser, then save again.");
    expect(result.products[0]?.status).toBe("login_required");
    expect(result.evidence.some((item) => item.uri.endsWith("daraz-session-check.png"))).toBe(true);
    expect(existsSync(darazProfileReadyPath(sessionsDir))).toBe(false);
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledWith(
      dirname(darazProfileReadyPath(sessionsDir)),
      expect.objectContaining({ headless: false })
    );
    expect(readDarazProfileSessionMetadata(sessionsDir).status).toBe("needs_login");
  });

  it("reports product-page login redirects as login_required", async () => {
    const { service, sessionsDir } = await serviceWithReadyProfile();
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = "https://member.daraz.lk/user/login";
          state.bodyText = "Welcome to Daraz! Please login.";
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("login_required");
    expect(result.products[0]?.status).toBe("login_required");
    expect(existsSync(darazProfileReadyPath(sessionsDir))).toBe(false);
    expect(result.evidence.some((item) => item.uri.includes("daraz-buy-now-01-item-1-failed.png"))).toBe(true);
  });

  it("keeps a saved profile repairable when Daraz asks for verification", async () => {
    const { service, sessionsDir } = await serviceWithReadyProfile();
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Please solve this captcha before continuing";
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("blocked");
    expect(result.products[0]?.status).toBe("blocked");
    expect(existsSync(darazProfileReadyPath(sessionsDir))).toBe(true);
    expect(readDarazProfileSessionMetadata(sessionsDir).status).toBe("needs_verification");
  });

  it("passes TorchProxies to Daraz persistent checkout browsers and evidence", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const proxy = testProxyProfile();
    markDarazProfileSessionSaved(sessionsDir, undefined, proxySummary(proxy));
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      proxyProfile: proxy
    });

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("checked");
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledWith(
      dirname(darazProfileReadyPath(sessionsDir)),
      expect.objectContaining({ proxy: proxyToPlaywright(proxy) })
    );
    const config = JSON.parse(await readFile(join(runsDir, result.runId, "daraz-run-config.json"), "utf8")) as {
      proxy: { masked: string; fingerprint: string };
    };
    expect(config.proxy.masked).toBe("http://user_abc:***@proxy.example:61234");
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  it("removes stale Chromium profile locks before opening a saved Daraz profile", async () => {
    const { service, sessionsDir } = await serviceWithReadyProfile();
    const profilePath = darazProfilePath(sessionsDir);
    await writeFile(join(profilePath, "SingletonLock"), "stale", "utf8");
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("checked");
    expect(existsSync(join(profilePath, "SingletonLock"))).toBe(false);
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  it("repairs a profile lock created by a failed Chromium launch and retries once", async () => {
    const { service, sessionsDir } = await serviceWithReadyProfile();
    const profilePath = darazProfilePath(sessionsDir);
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      }
    });
    playwrightMocks.launchPersistentContext
      .mockImplementationOnce(async () => {
        await writeFile(join(profilePath, "SingletonLock"), "stale after failed launch", "utf8");
        throw new Error("browserType.launchPersistentContext: profile appears to be in use by another Chromium process (exit code 21)");
      })
      .mockResolvedValueOnce(fakeContext(page));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("checked");
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(existsSync(join(profilePath, "SingletonLock"))).toBe(false);
  });

  it("does not remove Chromium profile locks while a matching process is still alive", async () => {
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(sessionsDir);
    const profilePath = darazProfilePath(sessionsDir);
    await mkdir(profilePath, { recursive: true });
    await writeFile(join(profilePath, "SingletonLock"), "active", "utf8");
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", profilePath], {
      stdio: "ignore"
    });
    childProcesses.push(child);
    await waitForProcessTable(profilePath);

    const repair = await repairDarazProfileLock(profilePath);

    expect(repair.reason).toBe("active_process");
    expect(repair.repaired).toBe(false);
    expect(repair.activeProcesses.length).toBeGreaterThan(0);
    expect(existsSync(join(profilePath, "SingletonLock"))).toBe(true);
  });

  it("requires a fresh Daraz login when saved session proxy differs from current proxy", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    await mkdir(dirname(darazProfileReadyPath(sessionsDir)), { recursive: true });
    await writeFile(darazProfileReadyPath(sessionsDir), new Date().toISOString(), "utf8");
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      proxyProfile: testProxyProfile()
    });

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("login_required");
    expect(result.message).toContain("proxy configuration changed");
    expect(playwrightMocks.launchPersistentContext).not.toHaveBeenCalled();
    expect(readDarazProfileSessionMetadata(sessionsDir).status).toBe("needs_login");
  });

  it("passes TorchProxies to the inbuilt Daraz login browser", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const proxy = testProxyProfile();
    const page = new FakeDarazPage();
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));
    const runtime = new LocalRuntime({
      runsDir,
      sessionsDir,
      proxyProfile: proxy,
      darazService: fakeDarazChecker()
    });

    await runtime.startDarazSession("user-1");
    await runtime.close();

    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledWith(
      dirname(darazProfileReadyPath(join(sessionsDir, "users", "user-1"))),
      expect.objectContaining({ proxy: proxyToPlaywright(proxy) })
    );
  });

  it("runs runtime-created Daraz checkout browsers headless in VNC without DISPLAY", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    const dbDir = await mkdtemp(join(tmpdir(), "daraz-flow-db-"));
    tempDirs.push(runsDir, sessionsDir, dbDir);
    process.env.CARTTRUTH_BROWSER_MODE = "vnc";
    delete process.env.CARTTRUTH_DARAZ_CHECK_HEADLESS;
    delete process.env.DISPLAY;
    process.env.CARTTRUTH_ADMIN_USERNAME = "admin";
    process.env.CARTTRUTH_ADMIN_PASSWORD = "password123";
    const proxy = testProxyProfile();

    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      }
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue(fakeContext(page));
    const runtime = new LocalRuntime({
      runsDir,
      sessionsDir,
      sqlitePath: join(dbDir, "carttruth.db"),
      proxyProfile: proxy
    });
    await runtime.bootstrap();
    const user = runtime.store.findUserByUsername("admin");
    if (!user) {
      throw new Error("Expected bootstrap admin user.");
    }
    markDarazProfileSessionSaved(join(sessionsDir, "users", user.id), undefined, proxySummary(proxy));

    const result = await runtime.checkDaraz(user.id, { products: [product] });
    await runtime.close();

    expect(result.status).toBe("checked");
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledWith(
      dirname(darazProfileReadyPath(join(sessionsDir, "users", user.id))),
      expect.objectContaining({ headless: true })
    );
  });

  it("checks one product through Buy Now without touching cart checkout controls", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    let cartVisits = 0;
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          cartVisits += 1;
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
          return;
        }
        if (url.includes("checkout.daraz.lk/shipping")) {
          state.url = url;
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(product.title, "Rs. 1,000", "Rs. 1,345");
        }
      },
      checkoutExtraction: {
        rows: [{
          text: "Sample Daraz Product Rs. 1,000 Qty: 1",
          matchedTitles: ["Sample Daraz Product"],
          quantity: 1,
          priceTexts: ["Rs. 1,000"]
        }]
      }
    });
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      liveContext: () => fakeContext(page) as never
    });

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("checked");
    expect(cartVisits).toBe(1);
    expect(page.clickedLabels).toEqual(["Buy Now"]);
    expect(page.clickedLabels.some((label) => /add to cart|proceed to checkout/i.test(label))).toBe(false);
    expect(result.checkoutTotal).toEqual({ currency: "LKR", minorUnits: 134500 });
    expect(result.products[0]?.checkoutLinePrice).toEqual({ currency: "LKR", minorUnits: 100000 });
    expect(result.products[0]?.breakdown).toEqual(expect.arrayContaining([
      { label: "Delivery Fee", kind: "delivery", amount: { currency: "LKR", minorUnits: 25000 } },
      { label: "Platform Fee", kind: "platform_fee", amount: { currency: "LKR", minorUnits: 9500 } },
      { label: "Order Total", kind: "total", amount: { currency: "LKR", minorUnits: 134500 } }
    ]));
    expect(result.evidence.some((item) => item.uri.endsWith("daraz-cart-isolation.json"))).toBe(false);
    expect(result.evidence.some((item) => item.uri.includes("daraz-checkout-extraction-01-item-1.json"))).toBe(true);
    expect(page.closed).toBe(true);
  });

  it("checks multiple products sequentially without a fake combined checkout total", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    let activeProduct = product;
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url || url === secondProduct.url) {
          activeProduct = url === product.url ? product : secondProduct;
          state.url = url;
          state.bodyText = `${activeProduct.title} ${formatRs(activeProduct.observedPrice?.minorUnits ?? 0)} Buy Now`;
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          const linePrice = activeProduct === product ? "Rs. 1,000" : "Rs. 2,000";
          const total = activeProduct === product ? "Rs. 1,345" : "Rs. 2,445";
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = checkoutText(activeProduct.title, linePrice, total);
        }
      }
    });
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      liveContext: () => fakeContext(page) as never
    });

    const result = await service.check({ products: [product, secondProduct] });

    expect(result.status).toBe("checked");
    expect(result.checkoutTotal).toBeUndefined();
    expect(result.priceBreakdown).toEqual([]);
    expect(result.globalAdjustments).toEqual([]);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]?.breakdown.some((item) => item.kind === "total" && item.amount.minorUnits === 134500)).toBe(true);
    expect(result.products[1]?.breakdown.some((item) => item.kind === "total" && item.amount.minorUnits === 244500)).toBe(true);
    expect(page.clickedLabels).toEqual(["Buy Now", "Buy Now"]);
  });

  it("marks a product unavailable when Buy Now is missing", async () => {
    const result = await checkWithLivePage(new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000";
        }
      }
    }));

    expect(result.status).toBe("needs_attention");
    expect(result.products[0]?.status).toBe("unavailable");
    expect(result.products[0]?.note).toContain("Buy Now");
  });

  it("marks a product needs_attention when Daraz requires a variant before Buy Now", async () => {
    const result = await checkWithLivePage(new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Please select Color Buy Now";
        }
      }
    }));

    expect(result.status).toBe("needs_attention");
    expect(result.products[0]?.status).toBe("needs_attention");
    expect(result.products[0]?.note).toContain("product option");
  });

  it("marks a product needs_attention when Buy Now checkout does not show totals", async () => {
    const result = await checkWithLivePage(new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = "Checkout is loading Sample Daraz Product";
        }
      }
    }));

    expect(result.status).toBe("needs_attention");
    expect(result.products[0]?.status).toBe("needs_attention");
    expect(result.products[0]?.note).toContain("final prices");
  });

  it("reports a logged-out Buy Now checkout shell as login_required", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
    const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
    tempDirs.push(runsDir, sessionsDir);
    const readyPath = darazProfileReadyPath(sessionsDir);
    await mkdir(dirname(readyPath), { recursive: true });
    await writeFile(readyPath, new Date().toISOString(), "utf8");
    const page = new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = "Daraz Categories LOGIN SIGN UP SAVE MORE ON APP";
        }
      }
    });
    const service = new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir,
      liveContext: () => fakeContext(page) as never
    });

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("login_required");
    expect(result.products[0]?.status).toBe("login_required");
    expect(existsSync(readyPath)).toBe(false);
    expect(readDarazProfileSessionMetadata(sessionsDir).status).toBe("needs_login");
  });

  it("returns a concise needs_attention message when headed checkout cannot start without XServer", async () => {
    const { service } = await serviceWithReadyProfile();
    playwrightMocks.launchPersistentContext.mockRejectedValue(new Error([
      "browserType.launchPersistentContext: Target page, context or browser has been closed",
      "Looks like you launched a headed browser without having a XServer running.",
      "Missing X server or $DISPLAY",
      "Browser logs: very long chromium dump"
    ].join("\n")));

    const result = await service.check({ products: [product] });

    expect(result.status).toBe("needs_attention");
    expect(result.message).toBe("Daraz checkout browser could not start on the server. Automated checks must run headless or under Xvfb.");
    expect(result.products[0]?.note).toBe(result.message);
    expect(result.products[0]?.note).not.toContain("Browser logs");
  });

  it("reports captcha after Buy Now as blocked", async () => {
    const { result, sessionsDir } = await checkWithLivePageAndSessions(new FakeDarazPage({
      onGoto(url, state) {
        if (url.includes("cart.daraz.lk/cart")) {
          state.url = url;
          state.bodyText = "Shopping Cart";
          return;
        }
        if (url === product.url) {
          state.url = url;
          state.bodyText = "Sample Daraz Product Rs. 1,000 Buy Now";
        }
      },
      onClick(label, state) {
        if (/buy now/i.test(label)) {
          state.url = "https://checkout.daraz.lk/shipping?buyNow=1";
          state.bodyText = "Please solve this captcha before continuing";
        }
      }
    }));

    expect(result.status).toBe("blocked");
    expect(result.products[0]?.status).toBe("blocked");
    expect(readDarazProfileSessionMetadata(sessionsDir).status).toBe("needs_verification");
  });
});

async function serviceWithReadyProfile() {
  const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
  const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
  tempDirs.push(runsDir, sessionsDir);
  const readyPath = darazProfileReadyPath(sessionsDir);
  await mkdir(dirname(readyPath), { recursive: true });
  await writeFile(readyPath, new Date().toISOString(), "utf8");
  return {
    service: new DarazService({
      evidenceStore: new LocalEvidenceStore(runsDir),
      sessionsDir
    }),
    sessionsDir
  };
}

async function checkWithLivePage(page: FakeDarazPage) {
  return (await checkWithLivePageAndSessions(page)).result;
}

async function checkWithLivePageAndSessions(page: FakeDarazPage) {
  const runsDir = await mkdtemp(join(tmpdir(), "daraz-flow-runs-"));
  const sessionsDir = await mkdtemp(join(tmpdir(), "daraz-flow-sessions-"));
  tempDirs.push(runsDir, sessionsDir);
  const service = new DarazService({
    evidenceStore: new LocalEvidenceStore(runsDir),
    sessionsDir,
    liveContext: () => fakeContext(page) as never
  });
  return {
    result: await service.check({ products: [product] }),
    runsDir,
    sessionsDir
  };
}

function fakeContext(page: FakeDarazPage) {
  return {
    pages: () => [page],
    newPage: async () => page,
    close: vi.fn(async () => undefined)
  };
}

function fakeBrowser(page: FakeDarazPage) {
  return {
    newPage: async () => page,
    close: vi.fn(async () => undefined)
  };
}

function testProxyProfile() {
  return parseProxyString("http://user_abc:secret@proxy.example:61234", {
    id: "torch-isp-trial",
    poolType: "isp",
    country: "US",
    source: "torchproxies"
  });
}

function fakeDarazChecker() {
  return {
    async search() {
      return [];
    },
    async productFromUrl() {
      return product;
    },
    async check() {
      return {
        runId: "fake",
        status: "checked" as const,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        products: [],
        priceBreakdown: [],
        globalAdjustments: [],
        evidence: []
      };
    }
  };
}

function checkoutText(title: string, linePrice: string, total: string) {
  return [
    title,
    "Qty: 1",
    linePrice,
    "Order Summary",
    "Items Total (1 Items)",
    linePrice,
    "Delivery Fee",
    "Rs. 250",
    "Platform Fee",
    "Rs. 95",
    "Order Total",
    total
  ].join("\n");
}

function formatRs(minorUnits: number) {
  return `Rs. ${(minorUnits / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function waitForProcessTable(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { stdout } = await execFileAsync("ps", ["-eo", "args="]);
    if (stdout.includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Process table did not include ${text}`);
}

function restoreEnv(): void {
  restoreEnvValue("CARTTRUTH_BROWSER_MODE", originalEnv.CARTTRUTH_BROWSER_MODE);
  restoreEnvValue("CARTTRUTH_DARAZ_CHECK_HEADLESS", originalEnv.CARTTRUTH_DARAZ_CHECK_HEADLESS);
  restoreEnvValue("DISPLAY", originalEnv.DISPLAY);
  restoreEnvValue("CARTTRUTH_ADMIN_USERNAME", originalEnv.CARTTRUTH_ADMIN_USERNAME);
  restoreEnvValue("CARTTRUTH_ADMIN_PASSWORD", originalEnv.CARTTRUTH_ADMIN_PASSWORD);
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

type PageState = { url: string; bodyText: string };
type CheckoutExtractionMock = { rows: Array<{ text: string; matchedTitles: string[]; quantity?: number; priceTexts: string[] }> };

class FakeDarazPage {
  private readonly state: PageState = { url: "about:blank", bodyText: "" };
  closed = false;
  clickedLabels: string[] = [];
  readonly mouse = {
    click: vi.fn(async () => undefined)
  };

  constructor(private readonly options: {
    onGoto?: (url: string, state: PageState) => void;
    onClick?: (label: string, state: PageState) => void;
    checkoutExtraction?: CheckoutExtractionMock | (() => CheckoutExtractionMock);
    functionEvaluate?: unknown | (() => unknown);
  } = {}) {}

  url() {
    return this.state.url;
  }

  async goto(url: string) {
    this.state.url = url;
    this.state.bodyText = "";
    this.options.onGoto?.(url, this.state);
  }

  async waitForLoadState() {}

  async waitForFunction() {}

  async waitForTimeout() {}

  async route() {}

  async screenshot() {
    return Buffer.from("png");
  }

  async close() {
    this.closed = true;
  }

  locator() {
    return {
      innerText: async () => this.state.bodyText
    };
  }

  async content() {
    return this.state.bodyText;
  }

  async evaluate(script: unknown) {
    if (typeof script === "string" && script.includes("__name")) {
      throw new Error("__name leaked into browser script");
    }
    if (typeof script === "function") {
      return this.nextMock(this.options.functionEvaluate);
    }
    if (this.state.url.includes("checkout.daraz.lk/shipping") && typeof script === "string" && script.includes("priceTexts")) {
      return this.nextMock(this.options.checkoutExtraction ?? { rows: [] });
    }
    return undefined;
  }

  private nextMock<T>(mock: T | (() => T) | undefined): T | undefined {
    if (mock === undefined) {
      return undefined;
    }
    return typeof mock === "function" ? (mock as () => T)() : mock;
  }

  getByRole(_role: string, options: { name?: string | RegExp }) {
    return this.buttonLocator(options.name);
  }

  getByText(label: string | RegExp) {
    return this.buttonLocator(label);
  }

  private buttonLocator(label: string | RegExp | undefined) {
    const text = typeof label === "string" ? label : label?.source ?? "";
    const matches = (/buy now/i.test(text) && /buy now/i.test(this.state.bodyText))
      || (/add to cart/i.test(text) && /add to cart/i.test(this.state.bodyText))
      || (/checkout|proceed to checkout/i.test(text) && /checkout|proceed to checkout/i.test(this.state.bodyText));
    return {
      count: async () => matches ? 1 : 0,
      first: () => ({
        click: async () => {
          this.clickedLabels.push(text.replace(/\\/g, ""));
          this.options.onClick?.(text, this.state);
        }
      })
    };
  }
}
