import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApiApp } from "./api.js";
import { LocalRuntime } from "./runtime.js";

const apiOnly = process.argv.includes("--api-only");
const port = Number(process.env.PORT ?? (apiOnly ? 4174 : 5173));
const runtime = new LocalRuntime();
const app = express();

app.use(createApiApp(runtime));

if (!apiOnly) {
  const vite = await createViteServer({
    root: resolve("apps/web"),
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const server = createServer(app);
server.listen(port, () => {
  const mode = apiOnly ? "API" : "web";
  console.log(`Daraz Price Checker ${mode} server listening at http://localhost:${port}`);
});

async function shutdown() {
  await runtime.close();
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
