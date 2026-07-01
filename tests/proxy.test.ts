import { describe, expect, it } from "vitest";
import { maskProxy, parseProxyString, proxyToPlaywright, proxyToUrl } from "@carttruth/core";

describe("proxy helpers", () => {
  it("parses Torch host:port:user:pass strings", () => {
    const profile = parseProxyString("77.223.199.208:61234:user_abc:secret", {
      id: "torch-isp-trial",
      poolType: "isp"
    });

    expect(profile).toMatchObject({
      id: "torch-isp-trial",
      protocol: "http",
      host: "77.223.199.208",
      port: 61234,
      username: "user_abc",
      password: "secret",
      poolType: "isp"
    });
    expect(maskProxy(profile)).toBe("http://user_abc:***@77.223.199.208:61234");
  });

  it("formats proxy URLs and Playwright config", () => {
    const profile = parseProxyString("http://user_abc:secret@proxy.example:61234", { id: "proxy" });
    expect(proxyToUrl(profile)).toBe("http://user_abc:secret@proxy.example:61234");
    expect(proxyToPlaywright(profile)).toEqual({
      server: "http://proxy.example:61234",
      username: "user_abc",
      password: "secret"
    });
  });
});
