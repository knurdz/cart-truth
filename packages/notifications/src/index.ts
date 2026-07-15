export * from "./types.js";
export * from "./format.js";
export * from "./dispatch.js";
export * from "./slack.js";
export * from "./discord.js";
export * from "./telegram.js";

export const ALLOWED_WEBHOOK_HOSTS = new Set([
  "hooks.slack.com",
  "discord.com",
  "discordapp.com"
]);

export function isAllowedWebhookUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") {
      return false;
    }
    if (!ALLOWED_WEBHOOK_HOSTS.has(url.hostname)) {
      return false;
    }
    if (url.hostname === "discord.com" || url.hostname === "discordapp.com") {
      return url.pathname.startsWith("/api/webhooks/");
    }
    if (url.hostname === "hooks.slack.com") {
      return url.pathname.startsWith("/services/");
    }
    return false;
  } catch {
    return false;
  }
}

export function maskWebhookHost(urlString: string): string | undefined {
  try {
    return new URL(urlString).hostname;
  } catch {
    return undefined;
  }
}
