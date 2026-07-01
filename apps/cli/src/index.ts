#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { chromium } from "playwright";
import { CartCheckRequestSchema, type ProxyProfile, type RetailerId } from "@carttruth/schemas";
import {
  CartTruthRunner,
  LocalEvidenceStore,
  StaticProxyProvider,
  maskProxy,
  parseProxyString,
  proxyToPlaywright,
  testProxyConnectivity
} from "@carttruth/core";
import { createDefaultAdapterRegistry, retailerLoginUrl } from "@carttruth/adapters";

const program = new Command()
  .name("carttruth")
  .description("CLI-first cart total verification runner")
  .version("0.1.0");

program
  .command("check")
  .description("Run a cart total scenario")
  .requiredOption("-s, --scenario <file>", "YAML or JSON scenario file")
  .option("-o, --out <dir>", "Run artifact directory", "runs")
  .option("--proxy-profile <id>", "Proxy profile id to use")
  .option("--mock", "Use deterministic mock adapters")
  .action(async (options) => {
    const request = CartCheckRequestSchema.parse(await loadStructuredFile(options.scenario));
    const proxyProfile = options.proxyProfile ? loadProxyProfile(options.proxyProfile) : undefined;
    const registry = createDefaultAdapterRegistry({ mock: Boolean(options.mock) });
    const evidenceStore = new LocalEvidenceStore(options.out);
    const proxyProvider = proxyProfile ? new StaticProxyProvider(new Map([[proxyProfile.id, proxyProfile]])) : undefined;
    const runner = new CartTruthRunner({
      registry,
      evidenceStore,
      ...(proxyProvider ? { proxyProvider } : {})
    });

    const result = await runner.run({
      ...request,
      proxyProfile: proxyProfile?.id ?? request.proxyProfile
    });

    output.write(`${JSON.stringify(summarizeResult(result), null, 2)}\n`);
    output.write(`Result: ${result.evidence.find((item) => item.uri.endsWith("result.json"))?.uri ?? evidenceStore.runDir(result.runId)}\n`);
    if (result.status !== "passed") {
      process.exitCode = 2;
    }
  });

program
  .command("proxy:test")
  .description("Validate a proxy profile through an outbound request")
  .option("--profile <id>", "Proxy profile id", "torch-isp-trial")
  .option("--url <url>", "Diagnostic URL", "https://api.ipify.org?format=json")
  .option("--timeout-ms <ms>", "Timeout in milliseconds", "20000")
  .action(async (options) => {
    const proxyProfile = loadProxyProfile(options.profile);
    output.write(`Testing ${maskProxy(proxyProfile)}\n`);
    const result = await testProxyConnectivity(proxyProfile, options.url, Number(options.timeoutMs));
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
      process.exitCode = 2;
    }
  });

program
  .command("report")
  .description("Read a run report")
  .requiredOption("--run-id <id>", "Run id")
  .option("--runs-dir <dir>", "Run artifact directory", "runs")
  .option("--json", "Print full JSON")
  .action(async (options) => {
    const store = new LocalEvidenceStore(options.runsDir);
    const result = await store.readResult(options.runId);
    output.write(`${JSON.stringify(options.json ? result : summarizeResult(result), null, 2)}\n`);
  });

program
  .command("account:login")
  .description("Open a headed browser so an operator can create or refresh a retailer session")
  .requiredOption("--retailer <retailer>", "walmart, target, or bestbuy")
  .requiredOption("--account <ref>", "Internal account reference")
  .option("--profile <id>", "Optional proxy profile id")
  .option("--sessions-dir <dir>", "Session storage directory", ".carttruth/sessions")
  .action(async (options) => {
    const retailer = CartCheckRequestSchema.shape.retailer.parse(options.retailer) as RetailerId;
    const proxyProfile = options.profile ? loadProxyProfile(options.profile) : undefined;
    const storagePath = resolve(options.sessionsDir, retailer, `${options.account}.json`);
    await mkdir(dirname(storagePath), { recursive: true });

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      ...(proxyProfile ? { proxy: proxyToPlaywright(proxyProfile) } : {})
    });
    const page = await context.newPage();
    await page.goto(retailerLoginUrl(retailer), { waitUntil: "domcontentloaded" });

    output.write(`Browser opened for ${retailer}. Complete login manually, then press Enter here.\n`);
    const rl = createInterface({ input, output });
    await rl.question("");
    rl.close();

    await context.storageState({ path: storagePath });
    await browser.close();
    output.write(`Saved storage state: ${storagePath}\n`);
  });

program.parseAsync(process.argv).catch((error) => {
  output.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function loadStructuredFile(path: string): Promise<unknown> {
  const content = await readFile(resolve(path), "utf8");
  if ([".yaml", ".yml"].includes(extname(path))) {
    return parseYaml(content);
  }
  return JSON.parse(content);
}

function loadProxyProfile(id: string): ProxyProfile {
  const singleString = process.env.CARTTRUTH_TORCH_ISP_PROXY;

  if (id === "torch-isp-trial" && singleString) {
    return parseProxyString(singleString, {
      id,
      protocol: "http",
      poolType: "isp",
      country: "US",
      source: "torchproxies"
    });
  }

  const host = process.env.CARTTRUTH_PROXY_HOST;
  const port = process.env.CARTTRUTH_PROXY_PORT;
  if (host && port) {
    return parseProxyString(`${host}:${port}:${process.env.CARTTRUTH_PROXY_USERNAME ?? ""}:${process.env.CARTTRUTH_PROXY_PASSWORD ?? ""}`, {
      id,
      protocol: (process.env.CARTTRUTH_PROXY_PROTOCOL as ProxyProfile["protocol"] | undefined) ?? "http",
      poolType: id.includes("isp") ? "isp" : "unknown",
      country: process.env.CARTTRUTH_PROXY_COUNTRY,
      source: "env"
    });
  }

  throw new Error(`Proxy profile ${id} is not configured. Set CARTTRUTH_TORCH_ISP_PROXY or CARTTRUTH_PROXY_* env vars.`);
}

function summarizeResult(result: {
  runId: string;
  retailer: string;
  status: string;
  comparison?: unknown | undefined;
  failure?: { code: string; message: string } | undefined;
  evidence: unknown[];
}) {
  return {
    runId: result.runId,
    retailer: result.retailer,
    status: result.status,
    comparison: result.comparison,
    failure: result.failure ? { code: result.failure.code, message: result.failure.message } : undefined,
    evidenceCount: result.evidence.length
  };
}
