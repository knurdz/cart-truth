import { fetch } from "undici";
import { formatReportText } from "./format.js";
import type { PriceChangeReport } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function sendTelegramMessage(botToken: string, chatId: string, report: PriceChangeReport): Promise<void> {
  const text = escapeHtml(formatReportText(report));
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    })
  });
  const payload = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram API failed (${response.status}): ${payload.description ?? "unknown error"}`);
  }
}
