import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Daraz dashboard source", () => {
  it("contains the simplified Daraz flow", async () => {
    const source = await readFile("apps/web/src/main.tsx", "utf8");
    expect(source).toContain("Daraz Price Checker");
    expect(source).toContain("Search Daraz products");
    expect(source).toContain("Paste Daraz product link");
    expect(source).toContain("Add link");
    expect(source).toContain("Selected Products");
    expect(source).toContain("Recalculate all");
    expect(source).toContain("Check final prices");
    expect(source).toContain("Order breakdown");
    expect(source).toContain("Open Inbuilt Daraz Login");
    expect(source).toContain("Daraz login saved");
    expect(source).toContain("Login required");
    expect(source).not.toContain("allowGuestCheckout: true");
    expect(source).not.toContain("window.open(DARAZ_LOGIN_URL");
  });

  it("does not expose old advanced terms in the normal UI", async () => {
    const source = await readFile("apps/web/src/main.tsx", "utf8");
    expect(source).not.toContain("Walmart");
    expect(source).not.toContain("proxy");
    expect(source).not.toContain("tolerance");
    expect(source).not.toContain("Mock");
  });
});
