import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CartCheckResult, Evidence } from "@carttruth/schemas";

export interface EvidenceStore {
  runDir(runId: string): string;
  writeJson(runId: string, name: string, value: unknown, redacted?: boolean): Promise<Evidence>;
  writeBinary(runId: string, name: string, value: Buffer, kind: Evidence["kind"], redacted?: boolean): Promise<Evidence>;
  readArtifact(runId: string, file: string): Promise<Buffer>;
  listResults(): Promise<CartCheckResult[]>;
  readResult(runId: string): Promise<CartCheckResult>;
}

export class LocalEvidenceStore implements EvidenceStore {
  private readonly rootDir: string;

  constructor(rootDir = "runs") {
    this.rootDir = resolve(rootDir);
  }

  runDir(runId: string): string {
    return join(this.rootDir, runId);
  }

  async writeJson(runId: string, name: string, value: unknown, redacted = true): Promise<Evidence> {
    const directory = this.runDir(runId);
    await mkdir(directory, { recursive: true });
    const uri = join(directory, name);
    await writeFile(uri, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    return {
      kind: "json",
      uri,
      redacted,
      createdAt: new Date().toISOString()
    };
  }

  async writeBinary(runId: string, name: string, value: Buffer, kind: Evidence["kind"], redacted = true): Promise<Evidence> {
    const directory = this.runDir(runId);
    await mkdir(directory, { recursive: true });
    const uri = join(directory, name);
    await writeFile(uri, value);

    return {
      kind,
      uri,
      redacted,
      createdAt: new Date().toISOString()
    };
  }

  async readArtifact(runId: string, file: string): Promise<Buffer> {
    const safeFile = basename(file);
    return readFile(join(this.runDir(runId), safeFile));
  }

  async listResults(): Promise<CartCheckResult[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir);
    const results: CartCheckResult[] = [];

    for (const entry of entries) {
      const resultPath = join(this.rootDir, entry, "result.json");
      try {
        const info = await stat(resultPath);
        if (!info.isFile()) {
          continue;
        }
        results.push(JSON.parse(await readFile(resultPath, "utf8")) as CartCheckResult);
      } catch {
        // Ignore incomplete or non-run directories.
      }
    }

    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async readResult(runId: string): Promise<CartCheckResult> {
    const content = await readFile(join(this.runDir(runId), "result.json"), "utf8");
    return JSON.parse(content) as CartCheckResult;
  }
}
