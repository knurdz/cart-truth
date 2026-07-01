import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEvidenceStore } from "@carttruth/core";

const tempDirs: string[] = [];

describe("LocalEvidenceStore", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes and reads binary artifacts", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "carttruth-evidence-"));
    tempDirs.push(runsDir);
    const store = new LocalEvidenceStore(runsDir);

    const evidence = await store.writeBinary("run-1", "screen.png", Buffer.from("image"), "screenshot");
    const artifact = await store.readArtifact("run-1", "screen.png");

    expect(evidence.kind).toBe("screenshot");
    expect(artifact.toString("utf8")).toBe("image");
  });
});
