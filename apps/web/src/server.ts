import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApiApp } from "./api.js";
import { applyProjectEnvFiles, adjustLocalDevPublicUrls } from "./env.js";
import { LocalRuntime } from "./runtime.js";

applyProjectEnvFiles();

const apiOnly = process.argv.includes("--api-only");
const defaultPort = apiOnly ? 4174 : 5173;
const port = await resolvePort(Number(process.env.PORT ?? defaultPort), Boolean(process.env.PORT));
const hmrPort = await resolvePort(Number(process.env.VITE_HMR_PORT ?? 24678), Boolean(process.env.VITE_HMR_PORT));
process.env.PORT = String(port);
adjustLocalDevPublicUrls(port);
const runtime = new LocalRuntime();
await runtime.bootstrap();
const app = express();
let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

app.use(createApiApp(runtime));

if (!apiOnly) {
  vite = await createViteServer({
    root: resolve("apps/web"),
    server: {
      middlewareMode: true,
      hmr: { port: hmrPort }
    },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const server = createHttpServer(app);
server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";
  const match = url.match(/^\/vnc\/([^/]+)\/websockify(?:[/?#]|$)/);
  if (!match?.[1]) {
    socket.destroy();
    return;
  }
  const session = runtime.vncSessionForToken(decodeURIComponent(match[1]));
  if (!session) {
    runtime.logger.warn("vnc websocket rejected", { url });
    socket.destroy();
    return;
  }
  const upstream = createConnection(session.webPort, "127.0.0.1", () => {
    upstream.write(`${request.method} ${url} HTTP/${request.httpVersion}\r\n`);
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const key = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (key && value) {
        upstream.write(`${key}: ${value}\r\n`);
      }
    }
    upstream.write("\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", (error) => {
    runtime.logger.error("vnc websocket upstream error", { error: error.message });
    socket.destroy();
  });
});
server.listen(port, () => {
  const mode = apiOnly ? "API" : "web";
  runtime.logger.info("server listening", {
    mode,
    port,
    url: process.env.CARTTRUTH_PUBLIC_URL ?? `http://localhost:${port}`
  });
});

async function shutdown() {
  await vite?.close();
  await runtime.close();
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

async function resolvePort(startPort: number, fixed: boolean): Promise<number> {
  if (fixed || await isPortAvailable(startPort)) {
    return startPort;
  }

  for (let port = startPort + 1; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return startPort;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const probe = createNetServer()
      .once("error", () => resolveAvailable(false))
      .once("listening", () => {
        probe.close(() => resolveAvailable(true));
      });
    probe.listen(port);
  });
}
