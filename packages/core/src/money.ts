import type { Comparison, ExpectedTotal, Money, ObservedCartTotal } from "@carttruth/schemas";

export function moneyToMinorUnits(money: Money): number {
  if (money.minorUnits !== undefined) {
    return money.minorUnits;
  }

  const amount = String(money.amount);
  const negative = amount.trim().startsWith("-");
  const normalized = amount.trim().replace(/^-/, "");
  const [major = "0", fraction = ""] = normalized.split(".");
  const cents = `${fraction}00`.slice(0, 2);
  const value = Number.parseInt(major, 10) * 100 + Number.parseInt(cents, 10);

  if (Number.isNaN(value)) {
    throw new Error(`Invalid money amount: ${amount}`);
  }

  return negative ? -value : value;
}

export function parseMoneyText(input: string, currency = "USD"): Money | undefined {
  const normalized = input
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .replace(/\(([^)]+)\)/g, "-$1");
  const match = normalized.match(/-?\$?\s*(\d+)(?:\.(\d{1,2}))?/);

  if (!match) {
    return undefined;
  }

  const negative = normalized.slice(0, match.index ?? 0).includes("-") || match[0].trim().startsWith("-");
  const major = Number.parseInt(match[1] ?? "0", 10);
  const cents = Number.parseInt(`${match[2] ?? ""}00`.slice(0, 2), 10);
  const minorUnits = major * 100 + cents;

  if (Number.isNaN(minorUnits)) {
    return undefined;
  }

  return { currency, minorUnits: negative ? -minorUnits : minorUnits };
}

export function minorUnitsToMoney(minorUnits: number, currency = "USD"): Money {
  return { currency, minorUnits };
}

export function compareExpectedTotal(expected: ExpectedTotal, observed: ObservedCartTotal): Comparison {
  const expectedTotalMinorUnits = moneyToMinorUnits(expected.total);
  const observedTotalMinorUnits = moneyToMinorUnits(observed.total);
  const deltaMinorUnits = observedTotalMinorUnits - expectedTotalMinorUnits;
  const toleranceMinorUnits = expected.toleranceMinorUnits;

  return {
    expectedTotalMinorUnits,
    observedTotalMinorUnits,
    deltaMinorUnits,
    toleranceMinorUnits,
    withinTolerance: Math.abs(deltaMinorUnits) <= toleranceMinorUnits
  };
}

export function sumMinorUnits(values: Money[]): number {
  return values.reduce((total, value) => total + moneyToMinorUnits(value), 0);
}
