import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEvidenceStore, CartTruthRunner } from "@carttruth/core";
import { createDefaultAdapterRegistry } from "@carttruth/adapters";
import type { CartCheckRequest } from "@carttruth/schemas";

const tempDirs: string[] = [];

describe("CartTruthRunner", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("runs a mock cart check and writes a report", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "carttruth-"));
    tempDirs.push(runsDir);
    const runner = new CartTruthRunner({
      registry: createDefaultAdapterRegistry({ mock: true }),
      evidenceStore: new LocalEvidenceStore(runsDir)
    });

    const request: CartCheckRequest = {
      scenarioId: "mock-pass",
      retailer: "walmart",
      accountRef: "test-account",
      items: [
        {
          productUrl: "https://www.walmart.com/ip/example/1",
          quantity: 1,
          expectedUnitPrice: { currency: "USD", minorUnits: 1000 }
        }
      ],
      fulfillment: { mode: "shipping", country: "US" },
      coupons: [],
      expected: {
        currency: "USD",
        total: { currency: "USD", minorUnits: 1000 },
        toleranceMinorUnits: 0
      },
      stopBeforePurchase: true,
      metadata: {}
    };

    const result = await runner.run(request);

    expect(result.status).toBe("passed");
    expect(result.comparison?.withinTolerance).toBe(true);
    expect(result.evidence.some((item) => item.uri.endsWith("result.json"))).toBe(true);
  });

  it("classifies price deltas", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "carttruth-"));
    tempDirs.push(runsDir);
    const runner = new CartTruthRunner({
      registry: createDefaultAdapterRegistry({ mock: true }),
      evidenceStore: new LocalEvidenceStore(runsDir)
    });

    const result = await runner.run({
      scenarioId: "mock-delta",
      retailer: "target",
      accountRef: "test-account",
      items: [{ productUrl: "https://www.target.com/p/example/-/A-123", quantity: 1 }],
      fulfillment: { mode: "shipping", country: "US" },
      coupons: [],
      expected: {
        currency: "USD",
        total: { currency: "USD", minorUnits: 1 },
        toleranceMinorUnits: 0
      },
      stopBeforePurchase: true,
      metadata: {}
    });

    expect(result.status).toBe("error");
    expect(result.failure?.code).toBe("price_delta");
  });
});
