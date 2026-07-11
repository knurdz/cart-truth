import type express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { ApiKeyRecord } from "./store.js";
import type { LocalRuntime, RuntimeProxyEventContext } from "./runtime.js";

const instructions = [
  "CartTruth checks saved Daraz product links and final checkout prices for the authenticated user.",
  "Use these tools for links, settings, queued checks, jobs, and run history only.",
  "If a job returns needs_user_action, the user must finish Daraz login or verification in the CartTruth web UI before retrying.",
  "Do not ask for or store Daraz credentials through MCP."
].join(" ");

export function createMcpRequestHandler(runtime: LocalRuntime) {
  return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const server = createCartTruthMcpServer(runtime, request.apiUser.id, request.apiKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

    response.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      next(error);
    }
  };
}

function createCartTruthMcpServer(runtime: LocalRuntime, userId: string, apiKey: ApiKeyRecord): McpServer {
  const server = new McpServer({
    name: "carttruth",
    version: "0.1.0"
  }, {
    instructions
  });

  server.registerTool("carttruth_list_links", {
    title: "List saved links",
    description: "List the authenticated user's saved Daraz product links."
  }, async () => jsonResult({ links: runtime.listSavedLinks(userId) }));

  server.registerTool("carttruth_add_link", {
    title: "Add saved link",
    description: "Save a Daraz product URL and queue a final checkout price check.",
    inputSchema: {
      url: z.string().url()
    }
  }, async ({ url }) => {
    const link = await runtime.addSavedLink(userId, url, mcpProxyContext(apiKey));
    const checkJob = runtime.enqueueSavedLinkCheck(userId, "link_added", [link.id]);
    return jsonResult({ link, checkJob: publicMcpPriceCheckJob(checkJob) });
  });

  server.registerTool("carttruth_delete_link", {
    title: "Delete saved link",
    description: "Delete a saved Daraz product link.",
    inputSchema: {
      linkId: z.string().min(1)
    }
  }, async ({ linkId }) => {
    runtime.deleteSavedLink(userId, linkId);
    return jsonResult({ ok: true });
  });

  server.registerTool("carttruth_get_settings", {
    title: "Get settings",
    description: "Read automatic price-check settings for the authenticated user."
  }, async () => jsonResult(runtime.settingsForUser(userId)));

  server.registerTool("carttruth_update_settings", {
    title: "Update settings",
    description: "Update automatic price-check settings for the authenticated user.",
    inputSchema: {
      autoPriceCheckEnabled: z.boolean().optional(),
      autoPriceCheckIntervalHours: z.number().int().min(1).max(24).optional(),
      proxyCountryPreference: z.string().regex(/^[A-Za-z]{2}$/).optional()
    }
  }, async (input) => jsonResult(runtime.updateSettingsForUser(userId, {
    ...(input.autoPriceCheckEnabled !== undefined ? { autoPriceCheckEnabled: input.autoPriceCheckEnabled } : {}),
    ...(input.autoPriceCheckIntervalHours !== undefined ? { autoPriceCheckIntervalHours: input.autoPriceCheckIntervalHours } : {}),
    ...(input.proxyCountryPreference !== undefined ? { proxyCountryPreference: input.proxyCountryPreference } : {})
  })));

  server.registerTool("carttruth_queue_check", {
    title: "Queue saved-link check",
    description: "Queue a final checkout price check for all or selected saved links.",
    inputSchema: {
      linkIds: z.array(z.string().min(1)).optional()
    }
  }, async ({ linkIds }) => {
    const job = runtime.enqueueSavedLinkCheck(userId, "manual", linkIds);
    return jsonResult({ job: publicMcpPriceCheckJob(job) });
  });

  server.registerTool("carttruth_list_jobs", {
    title: "List jobs",
    description: "List recent price-check jobs for the authenticated user."
  }, async () => jsonResult({ jobs: runtime.listPriceCheckJobs(userId).map(publicMcpPriceCheckJob) }));

  server.registerTool("carttruth_get_job", {
    title: "Get job",
    description: "Read one price-check job by ID.",
    inputSchema: {
      jobId: z.string().min(1)
    }
  }, async ({ jobId }) => {
    const job = runtime.getPriceCheckJob(userId, jobId);
    if (!job) {
      throw new Error("Price check job not found.");
    }
    return jsonResult({ job: publicMcpPriceCheckJob(job) });
  });

  server.registerTool("carttruth_list_runs", {
    title: "List runs",
    description: "List completed Daraz check runs for the authenticated user."
  }, async () => jsonResult({ runs: await runtime.listDarazRuns(userId) }));

  server.registerTool("carttruth_get_run", {
    title: "Get run",
    description: "Read one Daraz check run by ID.",
    inputSchema: {
      runId: z.string().min(1)
    }
  }, async ({ runId }) => {
    if (runtime.store.runOwner(runId) !== userId) {
      throw new Error("Run not found.");
    }
    return jsonResult(await runtime.readDarazRun(userId, runId));
  });

  return server;
}

function jsonResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(value, null, 2)
    }]
  };
}

function mcpProxyContext(apiKey: ApiKeyRecord): RuntimeProxyEventContext {
  return { source: "mcp", apiKey };
}

function publicMcpPriceCheckJob(job: {
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
