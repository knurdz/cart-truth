import { describe, expect, it } from "vitest";
import { loadProxyProfileFromEnv, maskProxy, parseProxyString, proxySummary, proxyToPlaywright, proxyToUrl } from "@carttruth/core";

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

  it("loads TorchProxies from env without exposing secrets in summaries", () => {
    const profile = loadProxyProfileFromEnv({
      CARTTRUTH_TORCH_ISP_PROXY: "77.223.199.208:61234:user_abc:secret"
    });

    expect(profile).toMatchObject({
      id: "torch-isp-trial",
      source: "torchproxies",
      poolType: "isp",
      country: "US"
    });
    expect(proxySummary(profile)).toEqual(expect.objectContaining({
      enabled: true,
      id: "torch-isp-trial",
      masked: "http://user_abc:***@77.223.199.208:61234"
    }));
    expect(JSON.stringify(proxySummary(profile))).not.toContain("secret");
  });

  it("returns no proxy when proxy env vars are absent", () => {
    expect(loadProxyProfileFromEnv({})).toBeUndefined();
    expect(proxySummary(undefined)).toEqual({
      enabled: false,
      fingerprint: "none"
    });
  });
});
