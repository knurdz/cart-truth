import { randomUUID } from "node:crypto";
import {
  CartCheckRequestSchema,
  CartCheckResultSchema,
  type CartCheckRequest,
  type CartCheckResult,
  type FailureReason
} from "@carttruth/schemas";
import type { AdapterRegistry } from "./registry.js";
import type { EvidenceStore } from "./evidence.js";
import { compareExpectedTotal } from "./money.js";
import type { ProxyProvider } from "./proxy.js";
import { NoProxyProvider } from "./proxy.js";
import { resultStatusFromFailure } from "./adapter.js";

export interface CartTruthRunnerOptions {
  registry: AdapterRegistry;
  evidenceStore: EvidenceStore;
  proxyProvider?: ProxyProvider;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class CartTruthRunner {
  private readonly proxyProvider: ProxyProvider;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly options: CartTruthRunnerOptions) {
    this.proxyProvider = options.proxyProvider ?? new NoProxyProvider();
    this.logger = options.logger ?? console;
  }

  async run(rawRequest: CartCheckRequest): Promise<CartCheckResult> {
    const request = CartCheckRequestSchema.parse(rawRequest);
    const startedAt = new Date().toISOString();
    const runId = buildRunId(request);
    const adapter = this.options.registry.get(request.retailer);
    const evidence = [];
    let proxyLease = undefined;

    try {
      proxyLease = await this.proxyProvider.leaseProxy({
        retailer: request.retailer,
        accountRef: request.accountRef,
        sticky: true,
        ...(request.proxyProfile ? { profileId: request.proxyProfile } : {}),
        ...(request.scenarioId ? { scenarioId: request.scenarioId } : {})
      });

      const adapterResult = await adapter.run({
        runId,
        startedAt,
        request,
        evidenceStore: this.options.evidenceStore,
        logger: this.logger,
        ...(proxyLease ? { proxyLease } : {})
      });

      evidence.push(...(adapterResult.evidence ?? []));

      const comparison = request.expected && adapterResult.observed
        ? compareExpectedTotal(request.expected, adapterResult.observed)
        : undefined;

      const priceFailure: FailureReason | undefined = comparison && !comparison.withinTolerance
        ? {
            code: "price_delta",
            message: `Observed total delta ${comparison.deltaMinorUnits} minor units exceeds tolerance ${comparison.toleranceMinorUnits}`,
            retryable: false,
            details: { comparison }
          }
        : undefined;

      const failure = adapterResult.failure ?? priceFailure;
      const status = failure ? resultStatusFromFailure(failure) : "passed";
      const finishedAt = new Date().toISOString();

      const result = CartCheckResultSchema.parse({
        runId,
        scenarioId: request.scenarioId,
        retailer: request.retailer,
        accountRef: request.accountRef,
        status,
        startedAt,
        finishedAt,
        proxyProfile: request.proxyProfile,
        observed: adapterResult.observed,
        comparison,
        failure,
        evidence,
        metadata: adapterResult.metadata ?? {}
      });

      const reportEvidence = await this.options.evidenceStore.writeJson(runId, "result.json", result);
      result.evidence.push(reportEvidence);

      if (proxyLease) {
        await this.proxyProvider.releaseProxy(proxyLease, status === "blocked" ? "blocked" : status === "passed" ? "success" : "failure");
      }

      return result;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const failure: FailureReason = {
        code: "internal_error",
        message: error instanceof Error ? error.message : "Unknown internal error",
        retryable: true,
        details: {}
      };

      const result = CartCheckResultSchema.parse({
        runId,
        scenarioId: request.scenarioId,
        retailer: request.retailer,
        accountRef: request.accountRef,
        status: "error",
        startedAt,
        finishedAt,
        proxyProfile: request.proxyProfile,
        failure,
        evidence,
        metadata: {}
      });

      const reportEvidence = await this.options.evidenceStore.writeJson(runId, "result.json", result);
      result.evidence.push(reportEvidence);

      if (proxyLease) {
        await this.proxyProvider.releaseProxy(proxyLease, "failure");
      }

      return result;
    }
  }
}

function buildRunId(request: CartCheckRequest): string {
  const prefix = request.scenarioId ?? request.retailer;
  return `${slugify(prefix)}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "run";
}
