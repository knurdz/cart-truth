import { basename, extname } from "node:path";
import express, { type Express } from "express";
import { z } from "zod";
import { DarazCheckRequestSchema } from "@carttruth/schemas";
import { isAllowedWebhookUrl } from "@carttruth/notifications";
import {
  clearOAuthCookie,
  clearSessionCookie,
  encryptSecret,
  googleRedirectUri,
  newApiKeyToken,
  newOAuthCookieValue,
  newSessionCookie,
  readCookie,
  safeEqualString,
  serializeOAuthCookie,
  serializeSessionCookie,
  type UserRole
} from "./auth.js";
import { requestId } from "./logger.js";
import { createMcpRequestHandler } from "./mcp.js";
import { DarazSessionActionRequiredError, TORCH_PROXY_COUNTRY_OPTIONS, type LocalRuntime, type RuntimeProxyEventContext } from "./runtime.js";
import type { ApiKeyRecord, ApiKeyScope, AppUser } from "./store.js";

const DarazSearchBodySchema = z.object({
  query: z.string().min(1)
});

const DarazProductLinkBodySchema = z.object({
  url: z.string().url()
});

const UserSettingsBodySchema = z.object({
  autoPriceCheckEnabled: z.boolean().optional(),
  autoPriceCheckIntervalHours: z.number().int().min(1).max(24).optional(),
  proxyCountryPreference: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional()
});

const ApiKeyScopesSchema = z.array(z.enum(["rest", "mcp"])).min(1);

const ApiKeyCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: ApiKeyScopesSchema
});

const ApiKeyUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  scopes: ApiKeyScopesSchema.optional()
}).refine((value) => value.name !== undefined || value.scopes !== undefined, {
  message: "Provide a name or scopes."
});

const NotificationChannelCreateBodySchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("slack"),
    label: z.string().trim().min(1).max(80).optional(),
    webhookUrl: z.string().url()
  }),
  z.object({
    platform: z.literal("discord"),
    label: z.string().trim().min(1).max(80).optional(),
    webhookUrl: z.string().url()
  }),
  z.object({
    platform: z.literal("telegram"),
    label: z.string().trim().min(1).max(80).optional(),
    botToken: z.string().trim().min(1),
    chatId: z.string().trim().regex(/^-?\d+$/)
  })
]);

const NotificationChannelUpdateBodySchema = z.object({
  label: z.string().trim().min(1).max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
  botToken: z.string().trim().min(1).optional(),
  chatId: z.string().trim().regex(/^-?\d+$/).optional()
}).refine((value) => (
  value.label !== undefined
  || value.enabled !== undefined
  || value.webhookUrl !== undefined
  || value.botToken !== undefined
  || value.chatId !== undefined
), {
  message: "Provide at least one field to update."
});

const ProxyTestBodySchema = z.object({
  url: z.string().url().optional(),
  timeoutMs: z.number().int().positive().max(60000).optional()
});

const OAUTH_STATE_COOKIE = "carttruth_oauth_state";
const OAUTH_NONCE_COOKIE = "carttruth_oauth_nonce";

export function createApiApp(runtime: LocalRuntime): Express {
  const app = express();
  app.use((request, response, next) => {
    const id = request.headers["x-request-id"]?.toString() ?? requestId();
    const started = Date.now();
    response.setHeader("x-request-id", id);
    response.on("finish", () => {
      runtime.logger.info("http request", {
        requestId: id,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        elapsedMs: Date.now() - started,
        userId: request.user?.id ?? request.apiUser?.id,
        apiKeyId: request.apiKey?.id
      });
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const restLimiter = createApiKeyRateLimiter(Number(process.env.CARTTRUTH_API_RATE_LIMIT_PER_MINUTE ?? 120), 60_000);
  const restTaskLimiter = createApiKeyRateLimiter(Number(process.env.CARTTRUTH_API_TASK_RATE_LIMIT_PER_MINUTE ?? 10), 60_000);
  const mcpLimiter = createApiKeyRateLimiter(Number(process.env.CARTTRUTH_MCP_RATE_LIMIT_PER_MINUTE ?? 60), 60_000);
  const mcpHandler = createMcpRequestHandler(runtime);

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "daraz-price-checker",
      proxy: runtime.proxyStatus()
    });
  });

  app.get("/api/auth/google/start", (request, response, next) => {
    try {
      const state = newOAuthCookieValue();
      const nonce = newOAuthCookieValue();
      const redirectUri = googleRedirectUri();
      response.setHeader("set-cookie", [
        serializeOAuthCookie(OAUTH_STATE_COOKIE, state),
        serializeOAuthCookie(OAUTH_NONCE_COOKIE, nonce)
      ]);
      response.redirect(runtime.googleOAuthClient().authorizationUrl({ state, nonce, redirectUri }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/google/callback", async (request, response, next) => {
    const clearOAuthCookies = [
      clearOAuthCookie(OAUTH_STATE_COOKIE),
      clearOAuthCookie(OAUTH_NONCE_COOKIE)
    ];
    try {
      const query = z.object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().min(1).optional()
      }).parse(request.query);
      if (query.error) {
        response.setHeader("set-cookie", clearOAuthCookies);
        response.redirect(`/?auth_error=${encodeURIComponent(`Google sign-in failed: ${query.error}`)}`);
        return;
      }
      if (!query.code || !query.state) {
        response.setHeader("set-cookie", clearOAuthCookies);
        response.status(400).json({ error: "Google sign-in callback was missing required fields." });
        return;
      }

      const state = readCookie(request.headers.cookie, OAUTH_STATE_COOKIE);
      const nonce = readCookie(request.headers.cookie, OAUTH_NONCE_COOKIE);
      if (!safeEqualString(state, query.state) || !nonce) {
        response.setHeader("set-cookie", clearOAuthCookies);
        response.status(400).json({ error: "Invalid Google sign-in state." });
        return;
      }

      const identity = await runtime.googleOAuthClient().verifyCallback({
        code: query.code,
        nonce,
        redirectUri: googleRedirectUri()
      });
      if (!identity.emailVerified) {
        response.setHeader("set-cookie", clearOAuthCookies);
        response.status(403).json({ error: "Google email is not verified." });
        return;
      }
      const user = runtime.store.upsertGoogleUser({
        googleSub: identity.sub,
        email: identity.email,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        role: runtime.roleForGoogleEmail(identity.email)
      });
      if (user.disabled) {
        response.setHeader("set-cookie", clearOAuthCookies);
        response.status(403).json({ error: "This CartTruth account is disabled." });
        return;
      }

      const session = newSessionCookie();
      runtime.store.createSession(user.id, session.hash, session.expiresAt);
      runtime.logger.info("google login succeeded", { userId: user.id, email: user.email, role: user.role });
      response.setHeader("set-cookie", [
        ...clearOAuthCookies,
        serializeSessionCookie(session.token, session.expiresAt)
      ]);
      response.redirect("/");
    } catch (error) {
      response.setHeader("set-cookie", clearOAuthCookies);
      next(error);
    }
  });

  app.post("/api/auth/logout", (request, response) => {
    const token = readCookie(request.headers.cookie, "carttruth_session");
    if (token) {
      runtime.store.deleteSession(token);
    }
    runtime.logger.info("logout requested");
    response.setHeader("set-cookie", clearSessionCookie());
    response.json({ ok: true });
  });

  app.get("/api/auth/me", (request, response) => {
    const user = currentUser(runtime, request);
    response.json({ user: user ? publicUser(user) : undefined });
  });

  app.get("/api/api-keys", requireUser(runtime), (request, response) => {
    response.json({ apiKeys: runtime.store.listApiKeys(request.user.id).map(publicApiKey) });
  });

  app.post("/api/api-keys", requireUser(runtime), (request, response, next) => {
    try {
      const body = ApiKeyCreateBodySchema.parse(request.body ?? {});
      const token = newApiKeyToken();
      const apiKey = runtime.store.createApiKey({
        userId: request.user.id,
        name: body.name,
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
        scopes: body.scopes
      });
      runtime.logger.info("api key created", { userId: request.user.id, apiKeyId: apiKey.id, scopes: apiKey.scopes });
      response.status(201).json({ apiKey: publicApiKey(apiKey), token: token.token });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/api-keys/:keyId", requireUser(runtime), (request, response, next) => {
    try {
      const body = ApiKeyUpdateBodySchema.parse(request.body ?? {});
      const apiKey = runtime.store.updateApiKey(request.user.id, routeParam(request, "keyId"), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.scopes !== undefined ? { scopes: body.scopes } : {})
      });
      if (!apiKey) {
        response.status(404).json({ error: "API key not found." });
        return;
      }
      runtime.logger.info("api key updated", { userId: request.user.id, apiKeyId: apiKey.id, scopes: apiKey.scopes });
      response.json({ apiKey: publicApiKey(apiKey) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/api-keys/:keyId", requireUser(runtime), (request, response) => {
    const revoked = runtime.store.revokeApiKey(request.user.id, routeParam(request, "keyId"));
    if (!revoked) {
      response.status(404).json({ error: "API key not found." });
      return;
    }
    runtime.logger.info("api key revoked", { userId: request.user.id, apiKeyId: routeParam(request, "keyId") });
    response.json({ ok: true });
  });

  app.get("/api/admin/users", requireAdmin(runtime), (_request, response) => {
    response.json({ users: runtime.store.listUsers().map(publicUser) });
  });

  app.post("/api/admin/users/:userId/disabled", requireAdmin(runtime), (request, response, next) => {
    try {
      const body = z.object({ disabled: z.boolean() }).parse(request.body ?? {});
      runtime.store.setUserDisabled(routeParam(request, "userId"), body.disabled);
      runtime.logger.info("admin changed user disabled state", { adminUserId: request.user.id, targetUserId: routeParam(request, "userId"), disabled: body.disabled });
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/proxy/status", requireUser(runtime), (_request, response) => {
    response.json({
      proxy: runtime.proxyStatus(),
      countryOptions: TORCH_PROXY_COUNTRY_OPTIONS
    });
  });

  app.get("/api/admin/proxy/summary", requireAdmin(runtime), (_request, response) => {
    response.json({
      proxy: runtime.proxyStatus(),
      events: runtime.store.proxyEventSummary(),
      external: {
        provider: "torchproxies",
        apiConfigured: Boolean(process.env.TORCHPROXIES_API_KEY),
        syncStatus: process.env.TORCHPROXIES_API_KEY ? "credentials_configured_not_synced" : "not_configured",
        note: "TorchProxies dashboard/API data is not fetched until account credentials and endpoint contracts are confirmed."
      },
      countryOptions: TORCH_PROXY_COUNTRY_OPTIONS
    });
  });

  app.get("/api/admin/proxy/events", requireAdmin(runtime), (request, response, next) => {
    try {
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional()
      }).parse(request.query);
      response.json({ events: runtime.store.listProxyEvents(query.limit ?? 50) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/proxy/test", requireAdmin(runtime), async (request, response, next) => {
    try {
      const body = ProxyTestBodySchema.parse(request.body ?? {});
      response.json(await runtime.testProxy(body.url, body.timeoutMs, {
        source: "web",
        userId: request.user.id,
        operation: "admin_proxy_connectivity_test"
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/proxy/test", requireAdmin(runtime), async (request, response, next) => {
    try {
      const body = ProxyTestBodySchema.parse(request.body ?? {});
      response.json(await runtime.testProxy(body.url, body.timeoutMs, {
        source: "web",
        userId: request.user.id,
        operation: "admin_proxy_connectivity_test"
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", requireUser(runtime), (request, response) => {
    response.json(runtime.settingsForUser(request.user.id));
  });

  app.get("/api/notifications", requireUser(runtime), (request, response) => {
    response.json(runtime.listNotifications(request.user.id));
  });

  app.patch("/api/notifications/:notificationId/read", requireUser(runtime), (request, response) => {
    const notification = runtime.markNotificationRead(request.user.id, routeParam(request, "notificationId"));
    if (!notification) {
      response.status(404).json({ error: "Notification not found." });
      return;
    }
    response.json({ notification, unreadCount: runtime.store.unreadNotificationCount(request.user.id) });
  });

  app.post("/api/notifications/read-all", requireUser(runtime), (request, response) => {
    const marked = runtime.markAllNotificationsRead(request.user.id);
    response.json({ marked, unreadCount: 0 });
  });

  app.get("/api/notification-channels", requireUser(runtime), (request, response) => {
    response.json({ channels: runtime.listNotificationChannels(request.user.id) });
  });

  app.post("/api/notification-channels", requireUser(runtime), (request, response, next) => {
    try {
      const body = NotificationChannelCreateBodySchema.parse(request.body ?? {});
      if ((body.platform === "slack" || body.platform === "discord") && !isAllowedWebhookUrl(body.webhookUrl)) {
        response.status(400).json({ error: "Webhook URL is not from an allowed Slack or Discord host." });
        return;
      }
      const channel = runtime.createNotificationChannel(request.user.id, {
        platform: body.platform,
        ...(body.label ? { label: body.label } : {}),
        ...(body.platform === "telegram"
          ? { botToken: body.botToken, chatId: body.chatId }
          : { webhookUrl: body.webhookUrl })
      });
      response.status(201).json({ channel });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/notification-channels/:channelId", requireUser(runtime), (request, response, next) => {
    try {
      const body = NotificationChannelUpdateBodySchema.parse(request.body ?? {});
      if (body.webhookUrl && !isAllowedWebhookUrl(body.webhookUrl)) {
        response.status(400).json({ error: "Webhook URL is not from an allowed Slack or Discord host." });
        return;
      }
      const channel = runtime.updateNotificationChannel(request.user.id, routeParam(request, "channelId"), {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.webhookUrl !== undefined ? { webhookUrl: body.webhookUrl } : {}),
        ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
        ...(body.chatId !== undefined ? { chatId: body.chatId } : {})
      });
      if (!channel) {
        response.status(404).json({ error: "Notification channel not found." });
        return;
      }
      response.json({ channel });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/notification-channels/:channelId", requireUser(runtime), (request, response) => {
    runtime.deleteNotificationChannel(request.user.id, routeParam(request, "channelId"));
    response.json({ ok: true });
  });

  app.post("/api/notification-channels/:channelId/test", requireUser(runtime), async (request, response, next) => {
    try {
      const result = await runtime.testNotificationChannel(request.user.id, routeParam(request, "channelId"));
      response.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Notification channel not found.") {
        response.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.patch("/api/settings", requireUser(runtime), (request, response, next) => {
    try {
      const body = UserSettingsBodySchema.parse(request.body ?? {});
      response.json(runtime.updateSettingsForUser(request.user.id, {
        ...(body.autoPriceCheckEnabled !== undefined ? { autoPriceCheckEnabled: body.autoPriceCheckEnabled } : {}),
        ...(body.autoPriceCheckIntervalHours !== undefined ? { autoPriceCheckIntervalHours: body.autoPriceCheckIntervalHours } : {}),
        ...(body.proxyCountryPreference !== undefined ? { proxyCountryPreference: body.proxyCountryPreference } : {})
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/session/status", requireUser(runtime), (request, response) => {
    response.json(runtime.darazSessionStatus(request.user.id));
  });

  app.post("/api/daraz/search", requireUser(runtime), async (request, response, next) => {
    try {
      const body = DarazSearchBodySchema.parse(request.body);
      response.json({ results: await runtime.searchDaraz(request.user.id, body.query, webProxyContext()) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/product", requireUser(runtime), async (request, response, next) => {
    try {
      const body = DarazProductLinkBodySchema.parse(request.body);
      response.json({ product: await runtime.findDarazProduct(request.user.id, body.url, webProxyContext()) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/start", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.startDarazSession(request.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/save", requireUser(runtime), async (request, response, next) => {
    try {
      const captureId = z.object({ captureId: z.string().min(1) }).parse(request.body).captureId;
      response.json(await runtime.saveDarazSession(request.user.id, captureId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/reset", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.resetDarazSession(request.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/stop", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.stopDarazBrowser(request.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/repair", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.repairDarazBrowserProfile(request.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/credentials", requireUser(runtime), (request, response) => {
    const credentials = runtime.store.getDarazCredentials(request.user.id);
    response.json({
      saved: Boolean(credentials),
      username: credentials?.username,
      updatedAt: credentials?.updatedAt
    });
  });

  app.post("/api/daraz/credentials", requireUser(runtime), (request, response, next) => {
    try {
      const body = z.object({
        username: z.string().min(1),
        password: z.string().min(1)
      }).parse(request.body ?? {});
      runtime.store.saveDarazCredentials(request.user.id, body.username, encryptSecret(body.password));
      runtime.logger.info("daraz credentials saved", { userId: request.user.id, username: body.username });
      response.json({ saved: true, username: body.username });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/daraz/credentials", requireUser(runtime), (request, response) => {
    runtime.store.deleteDarazCredentials(request.user.id);
    runtime.logger.info("daraz credentials deleted", { userId: request.user.id });
    response.json({ saved: false });
  });

  app.post("/api/daraz/check", requireUser(runtime), async (request, response, next) => {
    try {
      const body = DarazCheckRequestSchema.parse(request.body);
      const result = await runtime.checkDaraz(request.user.id, body, webProxyContext());
      response.status(result.status === "checked" ? 200 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.listDarazRuns(request.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs/:runId", requireUser(runtime), async (request, response, next) => {
    try {
      response.json(await runtime.readDarazRun(request.user.id, routeParam(request, "runId")));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs/:runId/artifacts/:file", requireUser(runtime), async (request, response, next) => {
    try {
      const runId = routeParam(request, "runId");
      if (runtime.store.runOwner(runId) !== request.user.id) {
        response.status(404).json({ error: "Run not found." });
        return;
      }
      const file = basename(routeParam(request, "file"));
      const artifact = await runtime.evidenceStore.readArtifact(runId, file);
      response.type(contentTypeFor(file)).send(artifact);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/links", requireUser(runtime), (request, response) => {
    response.json({ links: runtime.listSavedLinks(request.user.id) });
  });

  app.post("/api/links", requireUser(runtime), async (request, response, next) => {
    try {
      const body = DarazProductLinkBodySchema.parse(request.body);
      const link = await runtime.addSavedLink(request.user.id, body.url, webProxyContext());
      const checkJob = runtime.enqueueSavedLinkCheck(request.user.id, "link_added", [link.id]);
      response.status(201).json({
        link,
        checkJob: publicPriceCheckJob(checkJob),
        message: "Product page price saved. Final checkout price check queued."
      });
    } catch (error) {
      if (error instanceof DarazSessionActionRequiredError) {
        response.status(202).json({
          status: "needs_user_action",
          message: error.message,
          session: error.session,
          browserUrl: error.session.browserUrl
        });
        return;
      }
      next(error);
    }
  });

  app.post("/api/links/check-jobs", requireUser(runtime), (request, response, next) => {
    try {
      const body = z.object({ linkIds: z.array(z.string().min(1)).optional() }).parse(request.body ?? {});
      const job = runtime.enqueueSavedLinkCheck(request.user.id, "manual", body.linkIds);
      response.status(202).json({ job: publicPriceCheckJob(job) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/price-check-jobs", requireUser(runtime), (request, response) => {
    response.json({ jobs: runtime.listPriceCheckJobs(request.user.id).map(publicPriceCheckJob) });
  });

  app.get("/api/price-check-jobs/:jobId", requireUser(runtime), (request, response) => {
    const job = runtime.getPriceCheckJob(request.user.id, routeParam(request, "jobId"));
    if (!job) {
      response.status(404).json({ error: "Price check job not found." });
      return;
    }
    response.json({ job: publicPriceCheckJob(job) });
  });

  app.delete("/api/links/:linkId", requireUser(runtime), (request, response) => {
    runtime.deleteSavedLink(request.user.id, routeParam(request, "linkId"));
    response.json({ ok: true });
  });

  app.post("/api/links/check", requireUser(runtime), async (request, response, next) => {
    try {
      const body = z.object({ linkIds: z.array(z.string().min(1)).optional() }).parse(request.body ?? {});
      const result = await runtime.checkSavedLinks(request.user.id, body.linkIds, webProxyContext());
      response.status(result.status === "checked" ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof DarazSessionActionRequiredError) {
        response.status(202).json({
          status: "needs_user_action",
          message: error.message,
          session: error.session,
          browserUrl: error.session.browserUrl
        });
        return;
      }
      next(error);
    }
  });

  const publicApi = express.Router();
  publicApi.use(requireApiKey(runtime, "rest", restLimiter));

  publicApi.get("/me", (request, response) => {
    response.json({ user: publicUser(request.apiUser), apiKey: publicApiKey(request.apiKey) });
  });

  publicApi.get("/settings", (request, response) => {
    response.json(runtime.settingsForUser(request.apiUser.id));
  });

  publicApi.patch("/settings", (request, response, next) => {
    try {
      const body = UserSettingsBodySchema.parse(request.body ?? {});
      response.json(runtime.updateSettingsForUser(request.apiUser.id, {
        ...(body.autoPriceCheckEnabled !== undefined ? { autoPriceCheckEnabled: body.autoPriceCheckEnabled } : {}),
        ...(body.autoPriceCheckIntervalHours !== undefined ? { autoPriceCheckIntervalHours: body.autoPriceCheckIntervalHours } : {}),
        ...(body.proxyCountryPreference !== undefined ? { proxyCountryPreference: body.proxyCountryPreference } : {})
      }));
    } catch (error) {
      next(error);
    }
  });

  publicApi.get("/notification-channels", (request, response) => {
    response.json({ channels: runtime.listNotificationChannels(request.apiUser.id) });
  });

  publicApi.post("/notification-channels", (request, response, next) => {
    try {
      const body = NotificationChannelCreateBodySchema.parse(request.body ?? {});
      if ((body.platform === "slack" || body.platform === "discord") && !isAllowedWebhookUrl(body.webhookUrl)) {
        response.status(400).json({ error: "Webhook URL is not from an allowed Slack or Discord host." });
        return;
      }
      const channel = runtime.createNotificationChannel(request.apiUser.id, {
        platform: body.platform,
        ...(body.label ? { label: body.label } : {}),
        ...(body.platform === "telegram"
          ? { botToken: body.botToken, chatId: body.chatId }
          : { webhookUrl: body.webhookUrl })
      });
      response.status(201).json({ channel });
    } catch (error) {
      next(error);
    }
  });

  publicApi.patch("/notification-channels/:channelId", (request, response, next) => {
    try {
      const body = NotificationChannelUpdateBodySchema.parse(request.body ?? {});
      if (body.webhookUrl && !isAllowedWebhookUrl(body.webhookUrl)) {
        response.status(400).json({ error: "Webhook URL is not from an allowed Slack or Discord host." });
        return;
      }
      const channel = runtime.updateNotificationChannel(request.apiUser.id, routeParam(request, "channelId"), {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.webhookUrl !== undefined ? { webhookUrl: body.webhookUrl } : {}),
        ...(body.botToken !== undefined ? { botToken: body.botToken } : {}),
        ...(body.chatId !== undefined ? { chatId: body.chatId } : {})
      });
      if (!channel) {
        response.status(404).json({ error: "Notification channel not found." });
        return;
      }
      response.json({ channel });
    } catch (error) {
      next(error);
    }
  });

  publicApi.delete("/notification-channels/:channelId", (request, response) => {
    runtime.deleteNotificationChannel(request.apiUser.id, routeParam(request, "channelId"));
    response.json({ ok: true });
  });

  publicApi.post("/notification-channels/:channelId/test", async (request, response, next) => {
    try {
      const result = await runtime.testNotificationChannel(request.apiUser.id, routeParam(request, "channelId"));
      response.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Notification channel not found.") {
        response.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  publicApi.get("/links", (request, response) => {
    response.json({ links: runtime.listSavedLinks(request.apiUser.id) });
  });

  publicApi.post("/links", enforceApiKeyRateLimit(restTaskLimiter), async (request, response, next) => {
    try {
      const body = DarazProductLinkBodySchema.parse(request.body);
      const link = await runtime.addSavedLink(request.apiUser.id, body.url, apiKeyProxyContext(request.apiKey));
      const checkJob = runtime.enqueueSavedLinkCheck(request.apiUser.id, "link_added", [link.id]);
      response.status(201).json({ link, checkJob: publicPriceCheckJob(checkJob) });
    } catch (error) {
      next(error);
    }
  });

  publicApi.delete("/links/:linkId", (request, response) => {
    runtime.deleteSavedLink(request.apiUser.id, routeParam(request, "linkId"));
    response.json({ ok: true });
  });

  publicApi.post("/links/check-jobs", enforceApiKeyRateLimit(restTaskLimiter), (request, response, next) => {
    try {
      const body = z.object({ linkIds: z.array(z.string().min(1)).optional() }).parse(request.body ?? {});
      const job = runtime.enqueueSavedLinkCheck(request.apiUser.id, "manual", body.linkIds);
      response.status(202).json({ job: publicPriceCheckJob(job) });
    } catch (error) {
      next(error);
    }
  });

  publicApi.get("/price-check-jobs", (request, response) => {
    response.json({ jobs: runtime.listPriceCheckJobs(request.apiUser.id).map(publicPriceCheckJob) });
  });

  publicApi.get("/price-check-jobs/:jobId", (request, response) => {
    const job = runtime.getPriceCheckJob(request.apiUser.id, routeParam(request, "jobId"));
    if (!job) {
      response.status(404).json({ error: "Price check job not found." });
      return;
    }
    response.json({ job: publicPriceCheckJob(job) });
  });

  publicApi.get("/runs", async (request, response, next) => {
    try {
      response.json({ runs: await runtime.listDarazRuns(request.apiUser.id) });
    } catch (error) {
      next(error);
    }
  });

  publicApi.get("/runs/:runId", async (request, response, next) => {
    try {
      const runId = routeParam(request, "runId");
      if (runtime.store.runOwner(runId) !== request.apiUser.id) {
        response.status(404).json({ error: "Run not found." });
        return;
      }
      response.json(await runtime.readDarazRun(request.apiUser.id, runId));
    } catch (error) {
      next(error);
    }
  });

  publicApi.get("/runs/:runId/artifacts/:file", async (request, response, next) => {
    try {
      const runId = routeParam(request, "runId");
      if (runtime.store.runOwner(runId) !== request.apiUser.id) {
        response.status(404).json({ error: "Run not found." });
        return;
      }
      const file = basename(routeParam(request, "file"));
      const artifact = await runtime.evidenceStore.readArtifact(runId, file);
      response.type(contentTypeFor(file)).send(artifact);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/v1", publicApi);

  app.all("/mcp", requireApiKey(runtime, "mcp", mcpLimiter), (request, response, next) => {
    void mcpHandler(request, response, next);
  });

  app.get(/^\/vnc\/([^/]+)\/(.*)$/, requireUser(runtime), async (request, response, next) => {
    try {
      const token = request.params[0];
      const tail = request.params[1] || "vnc.html";
      if (!token) {
        response.status(404).json({ error: "Browser session not found." });
        return;
      }
      const session = runtime.vncSessionForToken(token);
      if (!session || session.userId !== request.user.id) {
        response.status(404).json({ error: "Browser session not found." });
        return;
      }
      const queryIndex = request.originalUrl.indexOf("?");
      const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : "";
      const upstream = await fetch(`http://127.0.0.1:${session.webPort}/${tail}${query}`);
      response.status(upstream.status);
      response.setHeader("cache-control", "no-store");
      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        response.setHeader("content-type", contentType);
      }
      response.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });

  const ContactMessageBodySchema = z.object({
    subject: z.string().trim().min(1, "Subject is required.").max(200, "Subject too long."),
    content: z.string().trim().min(1, "Message is required.").max(5000, "Message too long.")
  });

  app.post("/api/contact", (request, response, next) => {
    try {
      const body = ContactMessageBodySchema.parse(request.body ?? {});
      const message = runtime.store.createContactMessage({ subject: body.subject, content: body.content });
      runtime.notifyAdminsOfContactMessage(message.subject, message.content);
      runtime.logger.info("contact message received", { messageId: message.id, subject: message.subject });
      response.status(201).json({ ok: true, message });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/messages", requireAdmin(runtime), (_request, response) => {
    response.json({ messages: runtime.store.listContactMessages() });
  });

  app.delete("/api/admin/messages/:messageId", requireAdmin(runtime), (request, response) => {
    runtime.store.deleteContactMessage(routeParam(request, "messageId"));
    response.json({ ok: true });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const formatted = formatApiError(error);
    runtime.logger.error("api error", { message: formatted.message, status: formatted.status });
    response.status(formatted.status).json({ error: formatted.message });
  });

  return app;
}

declare global {
  namespace Express {
    interface Request {
      user: AppUser;
      apiUser: AppUser;
      apiKey: ApiKeyRecord;
    }
  }
}

function currentUser(runtime: LocalRuntime, request: express.Request): AppUser | undefined {
  const token = readCookie(request.headers.cookie, "carttruth_session");
  if (!token) {
    return undefined;
  }
  return runtime.store.findSessionByToken(token)?.user;
}

function webProxyContext(): RuntimeProxyEventContext {
  return { source: "web" };
}

function apiKeyProxyContext(apiKey: ApiKeyRecord): RuntimeProxyEventContext {
  return { source: "rest", apiKey };
}

function requireUser(runtime: LocalRuntime) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const user = currentUser(runtime, request);
    if (!user) {
      response.status(401).json({ error: "Login required." });
      return;
    }
    request.user = user;
    next();
  };
}

function requireAdmin(runtime: LocalRuntime) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const user = currentUser(runtime, request);
    if (!user) {
      response.status(401).json({ error: "Login required." });
      return;
    }
    if (user.role !== "admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }
    request.user = user;
    next();
  };
}

function requireApiKey(runtime: LocalRuntime, scope: ApiKeyScope, limiter: ApiKeyRateLimiter) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const token = bearerToken(request);
    if (!token) {
      response.status(401).json({ error: "Bearer API key required." });
      return;
    }
    const match = runtime.store.findApiKeyByToken(token);
    if (!match) {
      response.status(401).json({ error: "Invalid API key." });
      return;
    }
    if (!match.apiKey.scopes.includes(scope)) {
      response.status(403).json({ error: `API key is not enabled for ${scope.toUpperCase()}.` });
      return;
    }

    request.apiKey = match.apiKey;
    request.apiUser = match.user;
    if (!applyApiKeyRateLimit(request, response, limiter)) {
      return;
    }
    runtime.store.markApiKeyUsed(match.apiKey.id);
    next();
  };
}

function enforceApiKeyRateLimit(limiter: ApiKeyRateLimiter) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (!applyApiKeyRateLimit(request, response, limiter)) {
      return;
    }
    next();
  };
}

interface ApiKeyRateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly buckets: Map<string, { count: number; resetAt: number }>;
}

function createApiKeyRateLimiter(rawLimit: number, windowMs: number): ApiKeyRateLimiter {
  return {
    limit: clampInteger(rawLimit, 1, 10_000, 120),
    windowMs,
    buckets: new Map()
  };
}

function applyApiKeyRateLimit(request: express.Request, response: express.Response, limiter: ApiKeyRateLimiter): boolean {
  const key = request.apiKey?.id;
  if (!key) {
    response.status(401).json({ error: "API key required." });
    return false;
  }
  const now = Date.now();
  const bucket = limiter.buckets.get(key);
  const current = !bucket || bucket.resetAt <= now ? { count: 0, resetAt: now + limiter.windowMs } : bucket;
  current.count += 1;
  limiter.buckets.set(key, current);

  const remaining = Math.max(0, limiter.limit - current.count);
  const resetSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  response.setHeader("x-ratelimit-limit", String(limiter.limit));
  response.setHeader("x-ratelimit-remaining", String(remaining));
  response.setHeader("x-ratelimit-reset", String(Math.ceil(current.resetAt / 1000)));
  if (current.count > limiter.limit) {
    response.setHeader("retry-after", String(resetSeconds));
    response.status(429).json({ error: "Rate limit exceeded." });
    return false;
  }
  return true;
}

function bearerToken(request: express.Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function publicUser(user: {
  id: string;
  username: string;
  googleSub?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}) {
  return {
    id: user.id,
    username: user.username,
    googleSub: user.googleSub,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt
  };
}

function publicApiKey(apiKey: ApiKeyRecord) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    tokenPrefix: apiKey.tokenPrefix,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt
  };
}

function publicPriceCheckJob(job: {
  id: string;
  userId: string;
  source: string;
  status: string;
  linkIds?: string[];
  runId?: string;
  message?: string;
  sessionJson?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}) {
  return {
    id: job.id,
    source: job.source,
    status: job.status,
    linkIds: job.linkIds,
    runId: job.runId,
    message: job.message,
    session: job.sessionJson ? JSON.parse(job.sessionJson) as unknown : undefined,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt
  };
}

function routeParam(request: express.Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

function formatApiError(error: unknown): { status: number; message: string } {
  if (error instanceof z.ZodError) {
    return { status: 400, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/^Google OAuth is not configured/i.test(message)) {
    return { status: 503, message };
  }
  if (/^Invalid Google sign-in state/i.test(message) || /^Google sign-in callback/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Google email is not verified/i.test(message)) {
    return { status: 403, message };
  }
  if (/^Google did not return/i.test(message) || /^Google sign-in nonce/i.test(message) || /^Google sign-in failed/i.test(message)) {
    return { status: 401, message };
  }
  if (/^Paste a valid Daraz/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Add your Daraz email\/phone and password/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Save your Daraz email\/phone and password/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Could not log in to Daraz automatically/i.test(message)) {
    return { status: 409, message };
  }
  if (/^Daraz browser (?:profile|is already open)/i.test(message)) {
    return { status: 409, message };
  }
  if (isMissingPlaywrightBrowser(message)) {
    return {
      status: 503,
      message: "The inbuilt Daraz login browser is not installed yet. Run `pnpm exec playwright install chromium`, then try Open Inbuilt Daraz Login again."
    };
  }

  return { status: 500, message };
}

function isMissingPlaywrightBrowser(message: string): boolean {
  return message.includes("Executable doesn't exist") && message.includes("playwright install");
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function contentTypeFor(file: string): string {
  switch (extname(file).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}
