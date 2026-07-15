import { fetch } from "undici";
import { formatProductChange, formatReportText } from "./format.js";
import type { PriceChangeReport } from "./types.js";

export async function sendSlackWebhook(webhookUrl: string, report: PriceChangeReport): Promise<void> {
  const text = formatReportText(report);
  const blocks = report.isTest
    ? [{ type: "section", text: { type: "mrkdwn", text: `*${text.split("\n")[0]}*\n\n${text.split("\n").slice(2).join("\n")}` } }]
    : [
        { type: "header", text: { type: "plain_text", text: report.changes.length === 1 ? "Price update" : `${report.changes.length} product updates` } },
        ...report.changes.flatMap((change) => {
          const lines = formatProductChange(change).split("\n");
          const title = lines[0] ?? change.title;
          const details = lines.slice(1).join("\n");
          return [
            { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${details}` } },
            { type: "divider" }
          ];
        })
      ];

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, blocks })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body.slice(0, 200)}`);
  }
}
