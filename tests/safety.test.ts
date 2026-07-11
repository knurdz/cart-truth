import { describe, expect, it } from "vitest";
import { assertSafeActionLabel, classifyPageText, classifyPageUrl, isFinalizationRequestLike, parseMoneyText } from "@carttruth/core";
import { extractMoneyByLabels } from "@carttruth/adapters";

describe("money and safety helpers", () => {
  it("parses ordinary money text", () => {
    expect(parseMoneyText("$1,234.56")).toEqual({ currency: "USD", minorUnits: 123456 });
    expect(parseMoneyText("Estimated total $27.40")).toEqual({ currency: "USD", minorUnits: 2740 });
  });

  it("extracts totals by label", () => {
    const text = "Subtotal\n$19.99\nEstimated taxes\n$1.21\nEstimated total\n$21.20";
    expect(extractMoneyByLabels(text, ["Estimated total"])).toEqual({ currency: "USD", minorUnits: 2120 });
  });

  it("refuses purchase-intent actions", () => {
    expect(() => assertSafeActionLabel("Place order")).toThrow(/Refusing unsafe/);
    expect(() => assertSafeActionLabel("Checkout")).not.toThrow();
  });

  it("detects finalization requests", () => {
    expect(isFinalizationRequestLike("https://www.walmart.com/checkout/place-order", "{}")).toBe(true);
    expect(isFinalizationRequestLike("https://www.walmart.com/cart", "{}")).toBe(false);
  });

  it("classifies blockers and login requirements", () => {
    expect(classifyPageText("Please solve this captcha")).toBe("captcha");
    expect(classifyPageText("Access denied due to unusual traffic")).toBe("blocked");
    expect(classifyPageText("Sign in to continue")).toBe("login_required");
    expect(classifyPageText("Welcome to Daraz! Please login.")).toBe("login_required");
    expect(classifyPageText("Login with Password")).toBe("login_required");
    expect(classifyPageText("LOGIN")).toBeUndefined();
    expect(classifyPageText("Phone Number or Email Password")).toBe("login_required");
    expect(classifyPageUrl("https://member.daraz.lk/user/login")).toBe("login_required");
  });
});
