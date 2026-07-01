import type { AdapterContext, AdapterRunResult, RetailerAdapter } from "@carttruth/core";
import type { RetailerId } from "@carttruth/schemas";

const LOGIN_URLS: Record<RetailerId, string> = {
  walmart: "https://www.walmart.com/account/login",
  target: "https://www.target.com/login",
  bestbuy: "https://www.bestbuy.com/identity/signin"
};

export class ScaffoldRetailerAdapter implements RetailerAdapter {
  constructor(readonly id: RetailerId) {}

  supports(retailer: RetailerId): boolean {
    return retailer === this.id;
  }

  async run(context: AdapterContext): Promise<AdapterRunResult> {
    const manifest = {
      adapter: this.id,
      loginUrl: LOGIN_URLS[this.id],
      accountRef: context.request.accountRef,
      itemCount: context.request.items.length,
      stopBeforePurchase: context.request.stopBeforePurchase,
      proxy: context.proxyLease?.profile.id ?? "none",
      nextImplementationStep: "Replace this scaffold with retailer-specific Playwright selectors and checkout total extraction."
    };
    const evidence = await context.evidenceStore.writeJson(context.runId, "adapter-manifest.json", manifest);

    return {
      evidence: [evidence],
      failure: {
        code: "adapter_not_implemented",
        message: `${this.id} adapter scaffold is wired but retailer-specific browser flow is not implemented yet.`,
        retryable: false,
        details: manifest
      },
      metadata: { adapter: this.id }
    };
  }
}

export function retailerLoginUrl(retailer: RetailerId): string {
  return LOGIN_URLS[retailer];
}
