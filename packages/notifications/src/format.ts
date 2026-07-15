import type { Money } from "@carttruth/schemas";
import type { PriceChangeReport, ProductChange } from "./types.js";

const IN_STOCK = new Set(["available", "checked"]);
const OUT_OF_STOCK = new Set(["unavailable", "blocked", "login_required", "needs_attention"]);

export function normalizeAvailability(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (IN_STOCK.has(normalized)) {
    return "in_stock";
  }
  if (OUT_OF_STOCK.has(normalized)) {
    return "out_of_stock";
  }
  return normalized;
}

export function moneyMinorUnits(price: Money | undefined): number | undefined {
  if (!price) {
    return undefined;
  }
  if (price.minorUnits !== undefined) {
    return price.minorUnits;
  }
  if (price.amount !== undefined) {
    const amount = typeof price.amount === "number" ? price.amount : Number(price.amount);
    return Math.round(amount * 100);
  }
  return undefined;
}

export function pricesEqual(left: Money | undefined, right: Money | undefined): boolean {
  const leftMinor = moneyMinorUnits(left);
  const rightMinor = moneyMinorUnits(right);
  if (leftMinor === undefined && rightMinor === undefined) {
    return true;
  }
  if (leftMinor === undefined || rightMinor === undefined) {
    return false;
  }
  return leftMinor === rightMinor;
}

export function availabilityEqual(left: string | undefined, right: string | undefined): boolean {
  return normalizeAvailability(left) === normalizeAvailability(right);
}

export function formatMoney(price: Money | undefined): string {
  if (!price) {
    return "unknown";
  }
  if (price.minorUnits !== undefined) {
    const major = price.minorUnits / 100;
    return `${price.currency} ${major.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  if (price.amount !== undefined) {
    const amount = typeof price.amount === "number" ? price.amount : Number(price.amount);
    return `${price.currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return "unknown";
}

export function formatAvailability(value: string | undefined): string {
  const normalized = normalizeAvailability(value);
  if (normalized === "in_stock") {
    return "available";
  }
  if (normalized === "out_of_stock") {
    return "unavailable";
  }
  return value ?? "unknown";
}

export function priceDeltaLabel(previous: Money | undefined, next: Money | undefined): string | undefined {
  const previousMinor = moneyMinorUnits(previous);
  const nextMinor = moneyMinorUnits(next);
  if (previousMinor === undefined || nextMinor === undefined || previousMinor === 0) {
    return undefined;
  }
  const delta = ((nextMinor - previousMinor) / previousMinor) * 100;
  const rounded = Math.round(delta);
  if (rounded === 0) {
    return undefined;
  }
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function formatProductChange(change: ProductChange): string {
  const lines: string[] = [change.title];
  if (!pricesEqual(change.previousPrice, change.newPrice)) {
    const delta = priceDeltaLabel(change.previousPrice, change.newPrice);
    const deltaSuffix = delta ? ` (${delta})` : "";
    lines.push(`Listed: ${formatMoney(change.previousPrice)} → ${formatMoney(change.newPrice)}${deltaSuffix}`);
  }
  if (!availabilityEqual(change.previousAvailability, change.newAvailability)) {
    lines.push(`Stock: ${formatAvailability(change.previousAvailability)} → ${formatAvailability(change.newAvailability)}`);
  }
  lines.push(change.url);
  return lines.join("\n");
}

export function formatReportText(report: PriceChangeReport): string {
  const header = report.isTest
    ? "CartTruth — Test notification"
    : report.changes.length === 1
      ? "CartTruth — Price update"
      : `CartTruth — ${report.changes.length} product updates`;
  const body = report.isTest
    ? "Your notification channel is connected. You will receive alerts here when tracked product prices or stock change."
    : report.changes.map(formatProductChange).join("\n\n");
  return `${header}\n\n${body}`;
}

export function detectProductChange(input: {
  linkId: string;
  title: string;
  url: string;
  previousPrice?: Money;
  newPrice?: Money;
  previousAvailability?: string;
  newAvailability?: string;
}): ProductChange | undefined {
  const hasBaseline = input.previousPrice !== undefined || input.previousAvailability !== undefined;
  if (!hasBaseline) {
    return undefined;
  }
  const priceChanged = !pricesEqual(input.previousPrice, input.newPrice);
  const stockChanged = !availabilityEqual(input.previousAvailability, input.newAvailability);
  if (!priceChanged && !stockChanged) {
    return undefined;
  }
  return {
    linkId: input.linkId,
    title: input.title,
    url: input.url,
    ...(input.previousPrice ? { previousPrice: input.previousPrice } : {}),
    ...(input.newPrice ? { newPrice: input.newPrice } : {}),
    ...(input.previousAvailability ? { previousAvailability: input.previousAvailability } : {}),
    ...(input.newAvailability ? { newAvailability: input.newAvailability } : {})
  };
}
