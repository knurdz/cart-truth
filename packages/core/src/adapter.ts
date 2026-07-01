import type {
  CartCheckRequest,
  CartCheckResult,
  Evidence,
  FailureReason,
  ObservedCartTotal,
  RetailerId
} from "@carttruth/schemas";
import type { EvidenceStore } from "./evidence.js";
import type { ProxyLease } from "./proxy.js";

export interface AdapterContext {
  runId: string;
  startedAt: string;
  request: CartCheckRequest;
  evidenceStore: EvidenceStore;
  proxyLease?: ProxyLease;
  logger: Pick<Console, "info" | "warn" | "error">;
}

export interface AdapterRunResult {
  observed?: ObservedCartTotal;
  evidence?: Evidence[];
  failure?: FailureReason;
  metadata?: Record<string, unknown>;
}

export interface RetailerAdapter {
  readonly id: string;
  supports(retailer: RetailerId): boolean;
  run(context: AdapterContext): Promise<AdapterRunResult>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly failure: FailureReason
  ) {
    super(message);
  }
}

export function resultStatusFromFailure(failure?: FailureReason): CartCheckResult["status"] {
  if (!failure) {
    return "passed";
  }

  if (failure.code === "blocked" || failure.code === "captcha") {
    return "blocked";
  }

  if (failure.code === "adapter_not_implemented" || failure.code === "login_required") {
    return "needs_attention";
  }

  return failure.retryable ? "needs_attention" : "error";
}
