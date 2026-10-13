import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";

describe("resolveConfig legacy docketry names (retired)", () => {
  it("ignores DOCKETRY_* env entirely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tly-cfg-"));
    const res = await resolveConfig({
      env: { HOME: dir, DOCKETRY_TOKEN: "dok_agt_old", DOCKETRY_WORKSPACE: "old" },
      cwd: dir,
    });
    expect(res.config.token).toBeUndefined();
    expect(res.config.workspace).toBeUndefined();
  });

  it("ignores legacy .docketry config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tly-cfg-"));
    await mkdir(join(dir, ".docketry"), { recursive: true });
    await writeFile(
      join(dir, ".docketry", "config.json"),
      JSON.stringify({ workspace: "legacy-ws", apiUrl: "http://legacy" }),
    );
    const res = await resolveConfig({ env: { HOME: dir }, cwd: dir });
    expect(res.config.workspace).toBeUndefined();
    expect(res.config.apiUrl).not.toBe("http://legacy");
  });
});
