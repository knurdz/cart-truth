import { describe, expect, it } from "vitest";
import { CartCheckRequestSchema } from "@carttruth/schemas";

describe("CartCheckRequestSchema", () => {
  it("requires stopBeforePurchase to remain true", () => {
    expect(() =>
      CartCheckRequestSchema.parse({
        retailer: "bestbuy",
        accountRef: "test",
        items: [{ productUrl: "https://www.bestbuy.com/site/example/123.p", quantity: 1 }],
        stopBeforePurchase: false
      })
    ).toThrow();
  });

  it("applies safe defaults", () => {
    const request = CartCheckRequestSchema.parse({
      retailer: "bestbuy",
      accountRef: "test",
      items: [{ productUrl: "https://www.bestbuy.com/site/example/123.p" }]
    });

    expect(request.fulfillment).toEqual({ mode: "shipping", country: "US" });
    expect(request.stopBeforePurchase).toBe(true);
    expect(request.coupons).toEqual([]);
  });
});
