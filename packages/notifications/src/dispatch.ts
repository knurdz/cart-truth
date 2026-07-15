import { sendDiscordWebhook } from "./discord.js";
import { sendSlackWebhook } from "./slack.js";
import { sendTelegramMessage } from "./telegram.js";
import type {
  ChannelDeliveryResult,
  ChannelTarget,
  DiscordChannelConfig,
  PriceChangeReport,
  SlackChannelConfig,
  TelegramChannelConfig
} from "./types.js";

export async function dispatchPriceChangeReport(
  targets: ChannelTarget[],
  report: PriceChangeReport
): Promise<ChannelDeliveryResult[]> {
  const results: ChannelDeliveryResult[] = [];
  for (const target of targets) {
    try {
      if (target.platform === "slack") {
        await sendSlackWebhook((target.config as SlackChannelConfig).webhookUrl, report);
      } else if (target.platform === "discord") {
        await sendDiscordWebhook((target.config as DiscordChannelConfig).webhookUrl, report);
      } else if (target.platform === "telegram") {
        const config = target.config as TelegramChannelConfig;
        await sendTelegramMessage(config.botToken, config.chatId, report);
      } else {
        throw new Error(`Unsupported platform: ${target.platform as string}`);
      }
      results.push({ channelId: target.channelId, platform: target.platform, ok: true });
    } catch (error) {
      results.push({
        channelId: target.channelId,
        platform: target.platform,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}
