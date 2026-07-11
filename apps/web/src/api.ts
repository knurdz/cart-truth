import { basename, extname } from "node:path";
import express, { type Express } from "express";
import { z } from "zod";
import { DarazCheckRequestSchema } from "@carttruth/schemas";
import {
  clearSessionCookie,
  encryptSecret,
  hashPassword,
  newSessionCookie,
  readCookie,
  serializeSessionCookie,
  verifyPassword,
  type UserRole
} from "./auth.js";
import { requestId } from "./logger.js";
import { DarazSessionActionRequiredError, type LocalRuntime } from "./runtime.js";
import type { AppUser } from "./store.js";

const DarazSearchBodySchema = z.object({
  query: z.string().min(1)
});

const DarazProductLinkBodySchema = z.object({
  url: z.string().url()
});

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
        userId: request.user?.id
      });
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "daraz-price-checker",
      proxy: runtime.proxyStatus()
    });
  });

  app.post("/api/auth/login", async (request, response, next) => {
    try {
      const body = z.object({
        username: z.string().min(1),
        password: z.string().min(1)
      }).parse(request.body ?? {});
      const user = runtime.store.findUserByUsername(body.username);
      if (!user || user.disabled || !await verifyPassword(body.password, user.passwordHash)) {
        runtime.logger.warn("login failed", { username: body.username });
        response.status(401).json({ error: "Invalid username or password." });
        return;
      }
      const session = newSessionCookie();
      runtime.store.createSession(user.id, session.hash, session.expiresAt);
      runtime.logger.info("login succeeded", { userId: user.id, username: user.username, role: user.role });
      response.setHeader("set-cookie", serializeSessionCookie(session.token, session.expiresAt));
      response.json({ user: publicUser(user) });
    } catch (error) {
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

  app.post("/api/auth/change-password", requireUser(runtime), async (request, response, next) => {
    try {
      const body = z.object({ password: z.string().min(8) }).parse(request.body ?? {});
      runtime.store.updateUserPassword(request.user.id, await hashPassword(body.password), false);
      response.json({ user: publicUser({ ...request.user, mustChangePassword: false }) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users", requireAdmin(runtime), (_request, response) => {
    response.json({ users: runtime.store.listUsers().map(publicUser) });
  });

  app.post("/api/admin/users", requireAdmin(runtime), async (request, response, next) => {
    try {
      const body = z.object({
        username: z.string().min(3),
        password: z.string().min(8),
        role: z.enum(["admin", "user"]).default("user")
      }).parse(request.body ?? {});
      const user = runtime.store.createUser({
        username: body.username,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        mustChangePassword: true
      });
      runtime.logger.info("admin created user", { adminUserId: request.user.id, createdUserId: user.id, username: user.username, role: user.role });
      response.status(201).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/users/:userId/password", requireAdmin(runtime), async (request, response, next) => {
    try {
      const body = z.object({ password: z.string().min(8) }).parse(request.body ?? {});
      runtime.store.updateUserPassword(routeParam(request, "userId"), await hashPassword(body.password), true);
      runtime.logger.info("admin reset user password", { adminUserId: request.user.id, targetUserId: routeParam(request, "userId") });
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
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

  app.post("/api/proxy/test", async (request, response, next) => {
    try {
      const body = z.object({
        url: z.string().url().optional(),
        timeoutMs: z.number().int().positive().max(60000).optional()
      }).parse(request.body ?? {});
      response.json(await runtime.testProxy(body.url, body.timeoutMs));
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
      response.json({ results: await runtime.searchDaraz(request.user.id, body.query) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/product", requireUser(runtime), async (request, response, next) => {
    try {
      const body = DarazProductLinkBodySchema.parse(request.body);
      response.json({ product: await runtime.findDarazProduct(request.user.id, body.url) });
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
      const result = await runtime.checkDaraz(request.user.id, body);
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
      const link = await runtime.addSavedLink(request.user.id, body.url);
      response.status(201).json({
        link,
        message: "Product page price saved. Final checkout price check can start."
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

  app.delete("/api/links/:linkId", requireUser(runtime), (request, response) => {
    runtime.deleteSavedLink(request.user.id, routeParam(request, "linkId"));
    response.json({ ok: true });
  });

  app.post("/api/links/check", requireUser(runtime), async (request, response, next) => {
    try {
      const body = z.object({ linkIds: z.array(z.string().min(1)).optional() }).parse(request.body ?? {});
      const result = await runtime.checkSavedLinks(request.user.id, body.linkIds);
      response.status(result.status === "checked" ? 200 : 202).json(result);
    } catch (error) {
      next(error);
    }
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

function publicUser(user: { id: string; username: string; role: UserRole; disabled: boolean; mustChangePassword: boolean; createdAt: string }) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt
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
  if (/^Paste a valid Daraz/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Add your Daraz email\/phone and password/i.test(message)) {
    return { status: 400, message };
  }
  if (/^Could not log in to Daraz automatically/i.test(message)) {
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
