import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Daraz dashboard source", () => {
  it("contains the simplified Daraz flow", async () => {
    const source = await readFile("apps/web/src/main.tsx", "utf8");
    expect(source).toContain("CartTruth");
    expect(source).toContain("Admin dashboard");
    expect(source).toContain("Your Daraz dashboard");
    expect(source).toContain("Saved Daraz links");
    expect(source).toContain("Paste Daraz product URL");
    expect(source).toContain("Save link");
    expect(source).toContain("Qty 1");
    expect(source).toContain("Check saved links");
    expect(source).toContain("Order breakdown");
    expect(source).toContain("Open Daraz browser");
    expect(source).toContain("Daraz login saved");
    expect(source).toContain("Login required");
    expect(source).not.toContain("allowGuestCheckout: true");
    expect(source).not.toContain("type=\"number\"");
    expect(source).not.toContain("quantity: item.quantity + 1");
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
