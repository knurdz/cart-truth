import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/web/src/api.js";
import { LocalRuntime, type DarazSessionCaptureManager } from "../apps/web/src/runtime.js";
import type { DarazCheckRequest, DarazCheckResult, DarazSearchResult } from "@carttruth/schemas";

let server: Server;
let baseUrl: string;
let runsDir: string;

const fakeSearchResult: DarazSearchResult = {
  id: "item-1",
  title: "Sample Daraz Product",
  url: "https://www.daraz.lk/products/sample-i1-s1.html",
  observedPrice: { currency: "LKR", minorUnits: 123400 },
  availability: "available"
};

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "daraz-api-"));
  const runtime = new LocalRuntime({
    runsDir,
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
  server = createServer(createApiApp(runtime));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(runsDir, { recursive: true, force: true });
});

describe("Daraz API", () => {
  it("searches products", async () => {
    const response = await post("/api/daraz/search", { query: "phone" });
    expect(response.results[0].title).toBe("Sample Daraz Product");
  });

  it("adds a product from a pasted link", async () => {
    const response = await post("/api/daraz/product", { url: "https://www.daraz.lk/products/sample-i1-s1.html?pvid=test" });
    expect(response.product.title).toBe("Sample Daraz Product");
  });

  it("checks selected products", async () => {
    const response = await post("/api/daraz/check", { products: [{ ...fakeSearchResult, quantity: 1 }] });
    expect(response.status).toBe("checked");
    expect(response.products[0].checkoutLinePrice.minorUnits).toBe(123400);
  });

  it("supports session start/save", async () => {
    const started = await post("/api/daraz/session/start", {});
    expect(started.captureId).toBe("fake-daraz-capture");
    expect(started.profilePath).toContain("default-profile");
    const saved = await post("/api/daraz/session/save", { captureId: started.captureId });
    expect(saved.exists).toBe(true);
  });

  it("lists and reads Daraz runs", async () => {
    const runDir = join(runsDir, "daraz-existing-run");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "result.json"), JSON.stringify({
      runId: "daraz-existing-run",
      status: "checked",
      startedAt: "2026-06-22T00:00:00.000Z",
      finishedAt: "2026-06-22T00:00:01.000Z",
      products: [],
      evidence: []
    }));

    const runs = await get("/api/daraz/runs");
    expect(runs.some((run: { runId: string }) => run.runId === "daraz-existing-run")).toBe(true);
    const detail = await get("/api/daraz/runs/daraz-existing-run");
    expect(detail.runId).toBe("daraz-existing-run");
  });
});

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  return response.json();
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

class FakeDarazSessionCapture implements DarazSessionCaptureManager {
  async start(profilePath: string) {
    return {
      captureId: "fake-daraz-capture",
      loginUrl: "https://member.daraz.lk/user/login",
      profilePath,
      storagePath: profilePath
    };
  }

  async save(captureId: string) {
    return {
      captureId,
      profilePath: "/tmp/daraz-profile",
      storagePath: "/tmp/daraz-profile",
      exists: true
    };
  }

  async close() {}
}
