import { fetch } from "undici";
import { availabilityEqual, formatAvailability, formatMoney, formatReportText, priceDeltaLabel, pricesEqual } from "./format.js";
import type { PriceChangeReport } from "./types.js";

export async function sendDiscordWebhook(webhookUrl: string, report: PriceChangeReport): Promise<void> {
  const embeds = report.isTest
    ? [{
        title: "CartTruth test notification",
        description: "Your notification channel is connected. You will receive alerts here when tracked product prices or stock change.",
        color: 0x3b82f6
      }]
    : report.changes.map((change) => {
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        if (!pricesEqual(change.previousPrice, change.newPrice)) {
          const delta = priceDeltaLabel(change.previousPrice, change.newPrice);
          const deltaSuffix = delta ? ` (${delta})` : "";
          fields.push({
            name: "Price",
            value: `${formatMoney(change.previousPrice)} → ${formatMoney(change.newPrice)}${deltaSuffix}`
          });
        }
        if (!availabilityEqual(change.previousAvailability, change.newAvailability)) {
          fields.push({
            name: "Stock",
            value: `${formatAvailability(change.previousAvailability)} → ${formatAvailability(change.newAvailability)}`
          });
        }
        return {
          title: change.title,
          url: change.url,
          color: 0x10b981,
          fields
        };
      });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: report.isTest ? undefined : formatReportText(report).split("\n")[0],
      embeds
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${body.slice(0, 200)}`);
  }
}
