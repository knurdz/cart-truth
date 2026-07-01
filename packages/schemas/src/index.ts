import { z } from "zod";

export const RetailerIdSchema = z.enum(["walmart", "target", "bestbuy"]);
export type RetailerId = z.infer<typeof RetailerIdSchema>;

export const CurrencySchema = z.string().length(3).default("USD");

export const MoneySchema = z.object({
  currency: CurrencySchema,
  amount: z.union([z.string(), z.number()]).optional(),
  minorUnits: z.number().int().optional()
}).refine((value) => value.amount !== undefined || value.minorUnits !== undefined, {
  message: "Money requires amount or minorUnits"
});
export type Money = z.infer<typeof MoneySchema>;

export const CartItemRequestSchema = z.object({
  productUrl: z.string().url(),
  sku: z.string().min(1).optional(),
  quantity: z.number().int().positive().default(1),
  expectedUnitPrice: MoneySchema.optional()
});
export type CartItemRequest = z.infer<typeof CartItemRequestSchema>;

export const FulfillmentSchema = z.object({
  mode: z.enum(["shipping", "pickup"]).default("shipping"),
  postalCode: z.string().min(3).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(2).optional(),
  country: z.string().length(2).default("US")
});
export type Fulfillment = z.infer<typeof FulfillmentSchema>;

export const ExpectedTotalSchema = z.object({
  currency: CurrencySchema,
  subtotal: MoneySchema.optional(),
  shipping: MoneySchema.optional(),
  tax: MoneySchema.optional(),
  discounts: MoneySchema.optional(),
  total: MoneySchema,
  toleranceMinorUnits: z.number().int().nonnegative().default(100)
});
export type ExpectedTotal = z.infer<typeof ExpectedTotalSchema>;

export const CartCheckRequestSchema = z.object({
  scenarioId: z.string().min(1).optional(),
  retailer: RetailerIdSchema,
  accountRef: z.string().min(1),
  proxyProfile: z.string().min(1).optional(),
  items: z.array(CartItemRequestSchema).min(1),
  fulfillment: FulfillmentSchema.default({ mode: "shipping", country: "US" }),
  coupons: z.array(z.string().min(1)).default([]),
  expected: ExpectedTotalSchema.optional(),
  stopBeforePurchase: z.literal(true).default(true),
  metadata: z.record(z.unknown()).default({})
});
export type CartCheckRequest = z.infer<typeof CartCheckRequestSchema>;

export const LineItemSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  productUrl: z.string().url().optional(),
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
  lineTotal: MoneySchema
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const AdjustmentSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["coupon", "promotion", "shipping", "tax", "fee", "other"]),
  amount: MoneySchema
});
export type Adjustment = z.infer<typeof AdjustmentSchema>;

export const ObservedCartTotalSchema = z.object({
  currency: CurrencySchema,
  subtotal: MoneySchema.optional(),
  shipping: MoneySchema.optional(),
  tax: MoneySchema.optional(),
  discounts: MoneySchema.optional(),
  fees: MoneySchema.optional(),
  total: MoneySchema,
  lineItems: z.array(LineItemSchema).default([]),
  adjustments: z.array(AdjustmentSchema).default([]),
  capturedAt: z.string().datetime()
});
export type ObservedCartTotal = z.infer<typeof ObservedCartTotalSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum(["screenshot", "trace", "har", "video", "json", "log", "storage-state"]),
  uri: z.string().min(1),
  redacted: z.boolean().default(true),
  createdAt: z.string().datetime()
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FailureReasonSchema = z.object({
  code: z.enum([
    "adapter_not_implemented",
    "adapter_failure",
    "blocked",
    "captcha",
    "login_required",
    "login_failed",
    "proxy_unhealthy",
    "product_unavailable",
    "price_delta",
    "checkout_estimate_unavailable",
    "validation_error",
    "internal_error"
  ]),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  details: z.record(z.unknown()).default({})
});
export type FailureReason = z.infer<typeof FailureReasonSchema>;

export const ComparisonSchema = z.object({
  expectedTotalMinorUnits: z.number().int(),
  observedTotalMinorUnits: z.number().int(),
  deltaMinorUnits: z.number().int(),
  toleranceMinorUnits: z.number().int().nonnegative(),
  withinTolerance: z.boolean()
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const CartCheckStatusSchema = z.enum(["passed", "failed", "blocked", "needs_attention", "error"]);
export type CartCheckStatus = z.infer<typeof CartCheckStatusSchema>;

export const CartCheckResultSchema = z.object({
  runId: z.string().min(1),
  scenarioId: z.string().optional(),
  retailer: RetailerIdSchema,
  accountRef: z.string().min(1),
  status: CartCheckStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  proxyProfile: z.string().optional(),
  observed: ObservedCartTotalSchema.optional(),
  comparison: ComparisonSchema.optional(),
  failure: FailureReasonSchema.optional(),
  evidence: z.array(EvidenceSchema).default([]),
  metadata: z.record(z.unknown()).default({})
});
export type CartCheckResult = z.infer<typeof CartCheckResultSchema>;

export const ProxyProfileSchema = z.object({
  id: z.string().min(1),
  protocol: z.enum(["http", "https", "socks5"]).default("http"),
  host: z.string().min(1),
  port: z.number().int().positive(),
  username: z.string().optional(),
  password: z.string().optional(),
  poolType: z.enum(["isp", "residential", "datacenter", "mobile", "unknown"]).default("unknown"),
  country: z.string().length(2).optional(),
  source: z.string().default("manual")
});
export type ProxyProfile = z.infer<typeof ProxyProfileSchema>;

export const DarazProductStatusSchema = z.enum(["checked", "unavailable", "login_required", "blocked", "needs_attention"]);
export type DarazProductStatus = z.infer<typeof DarazProductStatusSchema>;

export const DarazSearchResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  imageUrl: z.string().url().optional(),
  observedPrice: MoneySchema.optional(),
  availability: z.string().optional()
});
export type DarazSearchResult = z.infer<typeof DarazSearchResultSchema>;

export const DarazSelectedProductSchema = DarazSearchResultSchema.extend({
  quantity: z.number().int().positive().default(1)
});
export type DarazSelectedProduct = z.infer<typeof DarazSelectedProductSchema>;

export const DarazCheckRequestSchema = z.object({
  products: z.array(DarazSelectedProductSchema).min(1),
  allowGuestCheckout: z.boolean().default(false)
});
export type DarazCheckRequestInput = z.input<typeof DarazCheckRequestSchema>;
export type DarazCheckRequest = z.infer<typeof DarazCheckRequestSchema>;

export const DarazBreakdownKindSchema = z.enum([
  "product_subtotal",
  "delivery",
  "platform_fee",
  "service_fee",
  "tax",
  "discount",
  "voucher",
  "total",
  "other"
]);
export type DarazBreakdownKind = z.infer<typeof DarazBreakdownKindSchema>;

export const DarazPriceBreakdownItemSchema = z.object({
  label: z.string().min(1),
  kind: DarazBreakdownKindSchema,
  amount: MoneySchema
});
export type DarazPriceBreakdownItem = z.infer<typeof DarazPriceBreakdownItemSchema>;

export const DarazProductPriceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  quantity: z.number().int().positive(),
  observedPrice: MoneySchema.optional(),
  checkoutUnitPrice: MoneySchema.optional(),
  checkoutLinePrice: MoneySchema.optional(),
  breakdown: z.array(DarazPriceBreakdownItemSchema).default([]),
  status: DarazProductStatusSchema,
  note: z.string().optional()
});
export type DarazProductPrice = z.infer<typeof DarazProductPriceSchema>;

export const DarazCheckResultSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["checked", "login_required", "blocked", "needs_attention", "error"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  products: z.array(DarazProductPriceSchema),
  checkoutTotal: MoneySchema.optional(),
  priceBreakdown: z.array(DarazPriceBreakdownItemSchema).default([]),
  globalAdjustments: z.array(AdjustmentSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  message: z.string().optional()
});
export type DarazCheckResult = z.infer<typeof DarazCheckResultSchema>;
