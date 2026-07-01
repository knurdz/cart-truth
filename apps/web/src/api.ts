import { basename, extname } from "node:path";
import express, { type Express } from "express";
import { z } from "zod";
import { DarazCheckRequestSchema } from "@carttruth/schemas";
import type { LocalRuntime } from "./runtime.js";

const DarazSearchBodySchema = z.object({
  query: z.string().min(1)
});

const DarazProductLinkBodySchema = z.object({
  url: z.string().url()
});

export function createApiApp(runtime: LocalRuntime): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "daraz-price-checker",
      hasDarazSession: runtime.hasDarazSession()
    });
  });

  app.post("/api/daraz/search", async (request, response, next) => {
    try {
      const body = DarazSearchBodySchema.parse(request.body);
      response.json({ results: await runtime.searchDaraz(body.query) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/product", async (request, response, next) => {
    try {
      const body = DarazProductLinkBodySchema.parse(request.body);
      response.json({ product: await runtime.findDarazProduct(body.url) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/start", async (_request, response, next) => {
    try {
      response.json(await runtime.startDarazSession());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/session/save", async (request, response, next) => {
    try {
      const captureId = z.object({ captureId: z.string().min(1) }).parse(request.body).captureId;
      response.json(await runtime.saveDarazSession(captureId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daraz/check", async (request, response, next) => {
    try {
      const body = DarazCheckRequestSchema.parse(request.body);
      const result = await runtime.checkDaraz(body);
      response.status(result.status === "checked" ? 200 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs", async (_request, response, next) => {
    try {
      response.json(await runtime.listDarazRuns());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs/:runId", async (request, response, next) => {
    try {
      response.json(await runtime.readDarazRun(request.params.runId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daraz/runs/:runId/artifacts/:file", async (request, response, next) => {
    try {
      const file = basename(request.params.file);
      const artifact = await runtime.evidenceStore.readArtifact(request.params.runId, file);
      response.type(contentTypeFor(file)).send(artifact);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const formatted = formatApiError(error);
    response.status(formatted.status).json({ error: formatted.message });
  });

  return app;
}

function formatApiError(error: unknown): { status: number; message: string } {
  if (error instanceof z.ZodError) {
    return { status: 400, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/^Paste a valid Daraz/i.test(message)) {
    return { status: 400, message };
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
