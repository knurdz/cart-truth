import { describe, expect, it } from "vitest";
import { CartCheckRequestSchema, DarazCheckRequestSchema } from "@carttruth/schemas";

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

describe("DarazCheckRequestSchema", () => {
  it("normalizes selected product quantities to one", () => {
    const withQuantity = DarazCheckRequestSchema.parse({
      products: [{
        id: "item-1",
        title: "Sample Daraz Product",
        url: "https://www.daraz.lk/products/sample-i1-s1.html",
        quantity: 5
      }]
    });
    const withoutQuantity = DarazCheckRequestSchema.parse({
      products: [{
        id: "item-2",
        title: "Another Daraz Product",
        url: "https://www.daraz.lk/products/sample-i2-s2.html"
      }]
    });

    expect(withQuantity.products[0]?.quantity).toBe(1);
    expect(withoutQuantity.products[0]?.quantity).toBe(1);
  });
});
