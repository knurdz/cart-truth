import { AdapterRegistry } from "@carttruth/core";
import type { RetailerId } from "@carttruth/schemas";
import { MockCartAdapter } from "./mock.js";
import { ScaffoldRetailerAdapter } from "./scaffold.js";
import { WalmartAdapter } from "./walmart.js";

const RETAILERS: RetailerId[] = ["walmart", "target", "bestbuy"];

export function createDefaultAdapterRegistry(options: { mock?: boolean } = {}): AdapterRegistry {
  const registry = new AdapterRegistry();

  for (const retailer of RETAILERS) {
    if (options.mock) {
      registry.register(retailer, new MockCartAdapter());
    } else if (retailer === "walmart") {
      registry.register(retailer, new WalmartAdapter());
    } else {
      registry.register(retailer, new ScaffoldRetailerAdapter(retailer));
    }
  }

  return registry;
}
