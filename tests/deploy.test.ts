import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment config", () => {
  it("configures Caddy for the production domain", async () => {
    const caddy = await readFile("Caddyfile", "utf8");
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(caddy).toContain("carttruth.knurdz.org");
    expect(caddy).toContain("reverse_proxy carttruth:5173");
    expect(compose).toContain("caddy:");
    expect(compose).toContain("80:80");
    expect(compose).toContain("443:443");
  });

  it("installs VNC browser dependencies in Docker", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    expect(dockerfile).toContain("novnc");
    expect(dockerfile).toContain("websockify");
    expect(dockerfile).toContain("x11vnc");
    expect(dockerfile).toContain("xvfb");
  });

  it("documents production domain and debug log commands", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("https://carttruth.knurdz.org");
    expect(readme).toContain("docker compose logs -f carttruth");
    expect(readme).toContain("CARTTRUTH_LOG_LEVEL=debug");
  });
});
