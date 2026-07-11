import { describe, expect, it } from "vitest";
import { redactForLog } from "../apps/web/src/logger.js";

describe("logger redaction", () => {
  it("redacts secrets but keeps masked proxy diagnostics", () => {
    const redacted = redactForLog({
      password: "secret",
      authToken: "token",
      proxy: {
        enabled: true,
        masked: "http://user:***@proxy.example:61234",
        fingerprint: "abc123"
      },
      url: "http://user:secret@proxy.example:61234"
    });

    expect(redacted).toEqual({
      password: "[redacted]",
      authToken: "[redacted]",
      proxy: {
        enabled: true,
        masked: "http://user:***@proxy.example:61234",
        fingerprint: "abc123"
      },
      url: "http://user:***@proxy.example:61234"
    });
    expect(JSON.stringify(redacted)).not.toContain("secret");
  });
});
