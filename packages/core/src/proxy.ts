import { createHash } from "node:crypto";
import { fetch, ProxyAgent } from "undici";
import { ProxyProfileSchema, type ProxyProfile, type RetailerId } from "@carttruth/schemas";

export const DEFAULT_TORCH_PROXY_PROFILE_ID = "torch-isp-trial";

export interface ProxyLease {
  id: string;
  profile: ProxyProfile;
  leasedAt: string;
}

export interface ProxyLeaseRequest {
  profileId?: string;
  retailer: RetailerId;
  accountRef: string;
  scenarioId?: string;
  sticky: boolean;
}

export interface ProxyProvider {
  leaseProxy(request: ProxyLeaseRequest): Promise<ProxyLease | undefined>;
  releaseProxy(lease: ProxyLease, outcome: "success" | "failure" | "blocked"): Promise<void>;
  markHealthy(lease: ProxyLease): Promise<void>;
  markBlocked(lease: ProxyLease, reason: string): Promise<void>;
  markExhausted(lease: ProxyLease, reason: string): Promise<void>;
}

export type ProxyEnv = Record<string, string | undefined>;

export type ProxySummary = {
  enabled: boolean;
  fingerprint: string;
  id?: string;
  source?: string;
  poolType?: ProxyProfile["poolType"];
  country?: string;
  masked?: string;
};

export class StaticProxyProvider implements ProxyProvider {
  constructor(private readonly profiles: Map<string, ProxyProfile>) {}

  async leaseProxy(request: ProxyLeaseRequest): Promise<ProxyLease | undefined> {
    if (!request.profileId) {
      return undefined;
    }

    const profile = this.profiles.get(request.profileId);
    if (!profile) {
      throw new Error(`Proxy profile not found: ${request.profileId}`);
    }

    return {
      id: `${profile.id}:${request.retailer}:${request.accountRef}`,
      profile,
      leasedAt: new Date().toISOString()
    };
  }

  async releaseProxy(): Promise<void> {}
  async markHealthy(): Promise<void> {}
  async markBlocked(): Promise<void> {}
  async markExhausted(): Promise<void> {}
}

export class NoProxyProvider implements ProxyProvider {
  async leaseProxy(): Promise<undefined> {
    return undefined;
  }

  async releaseProxy(): Promise<void> {}
  async markHealthy(): Promise<void> {}
  async markBlocked(): Promise<void> {}
  async markExhausted(): Promise<void> {}
}

export function parseProxyString(input: string, defaults: Partial<ProxyProfile> = {}): ProxyProfile {
  const trimmed = input.trim();

  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    return ProxyProfileSchema.parse({
      id: defaults.id ?? "proxy",
      protocol: normalizeProtocol(url.protocol.replace(":", "")),
      host: url.hostname,
      port: Number(url.port),
      username: decodeURIComponent(url.username || defaults.username || ""),
      password: decodeURIComponent(url.password || defaults.password || ""),
      poolType: defaults.poolType ?? "unknown",
      country: defaults.country,
      source: defaults.source ?? "manual"
    });
  }

  const [host, port, username, password] = trimmed.split(":");
  if (!host || !port) {
    throw new Error("Proxy string must be host:port:user:pass or a proxy URL");
  }

  return ProxyProfileSchema.parse({
    id: defaults.id ?? "proxy",
    protocol: defaults.protocol ?? "http",
    host,
    port: Number(port),
    username: username || defaults.username,
    password: password || defaults.password,
    poolType: defaults.poolType ?? "unknown",
    country: defaults.country,
    source: defaults.source ?? "manual"
  });
}

export function proxyToUrl(profile: ProxyProfile): string {
  const auth = profile.username
    ? `${encodeURIComponent(profile.username)}:${encodeURIComponent(profile.password ?? "")}@`
    : "";
  return `${profile.protocol}://${auth}${profile.host}:${profile.port}`;
}

export function proxyToPlaywright(profile: ProxyProfile): { server: string; username?: string; password?: string } {
  return {
    server: `${profile.protocol}://${profile.host}:${profile.port}`,
    ...(profile.username ? { username: profile.username } : {}),
    ...(profile.password ? { password: profile.password } : {})
  };
}

export function maskProxy(profile: ProxyProfile): string {
  const auth = profile.username ? `${profile.username}:***@` : "";
  return `${profile.protocol}://${auth}${profile.host}:${profile.port}`;
}

export function loadProxyProfileFromEnv(
  env: ProxyEnv = process.env,
  defaults: Partial<ProxyProfile> = {}
): ProxyProfile | undefined {
  const singleString = env.CARTTRUTH_TORCH_ISP_PROXY?.trim();
  if (singleString) {
    return parseProxyString(singleString, {
      id: defaults.id ?? DEFAULT_TORCH_PROXY_PROFILE_ID,
      protocol: defaults.protocol ?? "http",
      poolType: defaults.poolType ?? "isp",
      country: defaults.country ?? env.CARTTRUTH_PROXY_COUNTRY ?? "US",
      source: defaults.source ?? "torchproxies"
    });
  }

  const host = env.CARTTRUTH_PROXY_HOST?.trim();
  const port = env.CARTTRUTH_PROXY_PORT?.trim();
  if (!host || !port) {
    return undefined;
  }

  return parseProxyString(`${host}:${port}:${env.CARTTRUTH_PROXY_USERNAME ?? ""}:${env.CARTTRUTH_PROXY_PASSWORD ?? ""}`, {
    id: defaults.id ?? "env-proxy",
    protocol: (defaults.protocol ?? env.CARTTRUTH_PROXY_PROTOCOL ?? "http") as ProxyProfile["protocol"],
    poolType: defaults.poolType ?? "unknown",
    country: defaults.country ?? env.CARTTRUTH_PROXY_COUNTRY,
    source: defaults.source ?? "env"
  });
}

export function proxySummary(profile: ProxyProfile | undefined): ProxySummary {
  if (!profile) {
    return {
      enabled: false,
      fingerprint: "none"
    };
  }

  return {
    enabled: true,
    fingerprint: proxyFingerprint(profile),
    id: profile.id,
    source: profile.source,
    poolType: profile.poolType,
    ...(profile.country ? { country: profile.country } : {}),
    masked: maskProxy(profile)
  };
}

function proxyFingerprint(profile: ProxyProfile): string {
  return createHash("sha256").update(JSON.stringify({
    id: profile.id,
    protocol: profile.protocol,
    host: profile.host,
    port: profile.port,
    username: profile.username ?? "",
    password: profile.password ?? "",
    poolType: profile.poolType,
    country: profile.country ?? "",
    source: profile.source
  })).digest("hex");
}

export async function testProxyConnectivity(
  profile: ProxyProfile,
  url = "https://api.ipify.org?format=json",
  timeoutMs = 20000
): Promise<{ ok: boolean; status: number; bodyPreview: string; elapsedMs: number; proxy: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = new ProxyAgent(proxyToUrl(profile));

  try {
    const response = await fetch(url, {
      dispatcher,
      signal: controller.signal
    });
    const body = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      bodyPreview: body.slice(0, 500),
      elapsedMs: Date.now() - started,
      proxy: maskProxy(profile)
    };
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}

function normalizeProtocol(protocol: string): ProxyProfile["protocol"] {
  if (protocol === "http" || protocol === "https" || protocol === "socks5") {
    return protocol;
  }
  throw new Error(`Unsupported proxy protocol: ${protocol}`);
}
