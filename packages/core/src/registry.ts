import type { RetailerId } from "@carttruth/schemas";
import type { RetailerAdapter } from "./adapter.js";

export class AdapterRegistry {
  private readonly adapters = new Map<RetailerId, RetailerAdapter>();

  register(retailer: RetailerId, adapter: RetailerAdapter): void {
    if (!adapter.supports(retailer)) {
      throw new Error(`Adapter ${adapter.id} does not support ${retailer}`);
    }
    this.adapters.set(retailer, adapter);
  }

  get(retailer: RetailerId): RetailerAdapter {
    const adapter = this.adapters.get(retailer);
    if (!adapter) {
      throw new Error(`No adapter registered for ${retailer}`);
    }
    return adapter;
  }
}
