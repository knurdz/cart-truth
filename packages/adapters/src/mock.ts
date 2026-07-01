import type { AdapterContext, AdapterRunResult, RetailerAdapter } from "@carttruth/core";
import { minorUnitsToMoney, moneyToMinorUnits, sumMinorUnits } from "@carttruth/core";
import type { LineItem, ObservedCartTotal, RetailerId } from "@carttruth/schemas";

export class MockCartAdapter implements RetailerAdapter {
  readonly id = "mock";

  supports(): boolean {
    return true;
  }

  async run(context: AdapterContext): Promise<AdapterRunResult> {
    const currency = context.request.expected?.currency ?? "USD";
    const lineItems: LineItem[] = context.request.items.map((item, index) => {
      const unitPrice = item.expectedUnitPrice ?? minorUnitsToMoney(1000 + index * 250, currency);
      const lineTotal = minorUnitsToMoney(moneyToMinorUnits(unitPrice) * item.quantity, currency);

      return {
        name: `Mock item ${index + 1}`,
        sku: item.sku,
        productUrl: item.productUrl,
        quantity: item.quantity,
        unitPrice,
        lineTotal
      };
    });

    const subtotalMinor = sumMinorUnits(lineItems.map((item) => item.lineTotal));
    const shippingMinor = context.request.expected?.shipping ? moneyToMinorUnits(context.request.expected.shipping) : 0;
    const taxMinor = context.request.expected?.tax ? moneyToMinorUnits(context.request.expected.tax) : 0;
    const discountsMinor = context.request.expected?.discounts ? moneyToMinorUnits(context.request.expected.discounts) : 0;
    const observedTotal = minorUnitsToMoney(subtotalMinor + shippingMinor + taxMinor + discountsMinor, currency);
    const observed: ObservedCartTotal = {
      currency,
      subtotal: context.request.expected?.subtotal ?? minorUnitsToMoney(subtotalMinor, currency),
      shipping: context.request.expected?.shipping ?? minorUnitsToMoney(0, currency),
      tax: context.request.expected?.tax ?? minorUnitsToMoney(0, currency),
      discounts: context.request.expected?.discounts ?? minorUnitsToMoney(0, currency),
      total: observedTotal,
      lineItems,
      adjustments: context.request.coupons.map((coupon) => ({
        label: coupon,
        kind: "coupon",
        amount: minorUnitsToMoney(0, currency)
      })),
      capturedAt: new Date().toISOString()
    };

    const evidence = await context.evidenceStore.writeJson(context.runId, "adapter-observed.json", observed);
    return {
      observed,
      evidence: [evidence],
      metadata: {
        adapter: this.id,
        proxy: context.proxyLease?.profile.id ?? "none"
      }
    };
  }
}

export function createMockAdapterForRetailer(_retailer: RetailerId): MockCartAdapter {
  return new MockCartAdapter();
}
