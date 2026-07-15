import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<{ ok: boolean }>;
}>>());

vi.mock("undici", () => ({
  fetch: fetchMock
}));

import {
  availabilityEqual,
  detectProductChange,
  dispatchPriceChangeReport,
  formatReportText,
  isAllowedWebhookUrl,
  pricesEqual
} from "@carttruth/notifications";
import { encryptSecret } from "../apps/web/src/auth.js";
import { AppStore } from "../apps/web/src/store.js";

let store: AppStore;
let dbDir: string;

beforeEach(async () => {
  dbDir = await mkdtemp(join(tmpdir(), "notification-channels-"));
  process.env.CARTTRUTH_ENCRYPTION_KEY = "test-encryption-key";
  store = new AppStore(join(dbDir, "carttruth.db"));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ ok: true })
  }));
});

afterEach(async () => {
  store.close();
  await rm(dbDir, { recursive: true, force: true });
});

describe("notification format helpers", () => {
  it("detects price decreases", () => {
    const change = detectProductChange({
      linkId: "link-1",
      title: "Sample Product",
      url: "https://www.daraz.lk/products/sample.html",
      previousPrice: { currency: "LKR", minorUnits: 450000 },
      newPrice: { currency: "LKR", minorUnits: 399000 },
      previousAvailability: "available",
      newAvailability: "checked"
    });
    expect(change).toBeDefined();
    expect(pricesEqual(change?.previousPrice, change?.newPrice)).toBe(false);
    expect(availabilityEqual(change?.previousAvailability, change?.newAvailability)).toBe(true);
  });

  it("detects stock flips", () => {
    const change = detectProductChange({
      linkId: "link-1",
      title: "Sample Product",
      url: "https://www.daraz.lk/products/sample.html",
      previousPrice: { currency: "LKR", minorUnits: 450000 },
      newPrice: { currency: "LKR", minorUnits: 450000 },
      previousAvailability: "available",
      newAvailability: "unavailable"
    });
    expect(change).toBeDefined();
    expect(formatReportText({ changes: [change!] })).toContain("Stock: available → unavailable");
  });

  it("skips first baseline without prior snapshot", () => {
    const change = detectProductChange({
      linkId: "link-1",
      title: "Sample Product",
      url: "https://www.daraz.lk/products/sample.html",
      newPrice: { currency: "LKR", minorUnits: 399000 },
      newAvailability: "checked"
    });
    expect(change).toBeUndefined();
  });

  it("returns undefined when nothing changed", () => {
    const change = detectProductChange({
      linkId: "link-1",
      title: "Sample Product",
      url: "https://www.daraz.lk/products/sample.html",
      previousPrice: { currency: "LKR", minorUnits: 450000 },
      newPrice: { currency: "LKR", minorUnits: 450000 },
      previousAvailability: "checked",
      newAvailability: "checked"
    });
    expect(change).toBeUndefined();
  });
});

describe("webhook host validation", () => {
  it("accepts Slack and Discord webhook URLs", () => {
    expect(isAllowedWebhookUrl("https://hooks.slack.com/services/T00/B00/xxxxx")).toBe(true);
    expect(isAllowedWebhookUrl("https://discord.com/api/webhooks/123/abc")).toBe(true);
  });

  it("rejects arbitrary hosts", () => {
    expect(isAllowedWebhookUrl("https://example.com/webhook")).toBe(false);
    expect(isAllowedWebhookUrl("http://hooks.slack.com/services/T00/B00/xxxxx")).toBe(false);
  });
});

describe("notification channel store", () => {
  it("creates, lists, updates, and deletes encrypted channels", () => {
    const user = store.createUser({
      username: "notify-user",
      passwordHash: "oauth:google",
      role: "user"
    });
    const encryptedConfig = encryptSecret(JSON.stringify({ webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxxx" }));
    const created = store.createNotificationChannel({
      userId: user.id,
      platform: "slack",
      label: "#deals",
      encryptedConfig
    });
    expect(created.platform).toBe("slack");
    expect(created.label).toBe("#deals");

    const listed = store.listNotificationChannels(user.id);
    expect(listed).toHaveLength(1);

    const updated = store.updateNotificationChannel(user.id, created.id, { enabled: false });
    expect(updated?.enabled).toBe(false);

    store.touchNotificationChannelDelivery(created.id, { lastDeliveryAt: new Date().toISOString(), lastError: null });
    const touched = store.getNotificationChannel(user.id, created.id);
    expect(touched?.lastDeliveryAt).toBeTruthy();
    expect(touched?.lastError).toBeUndefined();

    store.deleteNotificationChannel(user.id, created.id);
    expect(store.listNotificationChannels(user.id)).toHaveLength(0);
  });
});

describe("dispatchPriceChangeReport", () => {
  it("delivers to all configured platforms", async () => {
    const results = await dispatchPriceChangeReport([
      {
        channelId: "slack-1",
        platform: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxxx" }
      },
      {
        channelId: "discord-1",
        platform: "discord",
        config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" }
      },
      {
        channelId: "telegram-1",
        platform: "telegram",
        config: { botToken: "123:abc", chatId: "999" }
      }
    ], {
      changes: [{
        linkId: "link-1",
        title: "Sample Product",
        url: "https://www.daraz.lk/products/sample.html",
        previousPrice: { currency: "LKR", minorUnits: 450000 },
        newPrice: { currency: "LKR", minorUnits: 399000 },
        previousAvailability: "available",
        newAvailability: "checked"
      }]
    });

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("records per-channel failures", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("discord.com")) {
        return { ok: false, status: 400, text: async () => "bad request" };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({ ok: true }) };
    });

    const results = await dispatchPriceChangeReport([
      {
        channelId: "slack-1",
        platform: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/T00/B00/xxxxx" }
      },
      {
        channelId: "discord-1",
        platform: "discord",
        config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" }
      }
    ], { changes: [], isTest: true });

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.error).toContain("Discord webhook failed");
  });
});
