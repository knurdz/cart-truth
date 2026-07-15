import type { Money } from "@carttruth/schemas";

export type NotificationPlatform = "slack" | "discord" | "telegram";

export interface SlackChannelConfig {
  webhookUrl: string;
}

export interface DiscordChannelConfig {
  webhookUrl: string;
}

export interface TelegramChannelConfig {
  botToken: string;
  chatId: string;
}

export type NotificationChannelConfig =
  | SlackChannelConfig
  | DiscordChannelConfig
  | TelegramChannelConfig;

export interface ProductChange {
  linkId: string;
  title: string;
  url: string;
  previousPrice?: Money;
  newPrice?: Money;
  previousAvailability?: string;
  newAvailability?: string;
}

export interface PriceChangeReport {
  changes: ProductChange[];
  isTest?: boolean;
}

export interface ChannelTarget {
  channelId: string;
  platform: NotificationPlatform;
  config: NotificationChannelConfig;
}

export interface ChannelDeliveryResult {
  channelId: string;
  platform: NotificationPlatform;
  ok: boolean;
  error?: string;
}
