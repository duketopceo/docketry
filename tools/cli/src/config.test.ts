import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";

describe("resolveConfig legacy docketry compatibility", () => {
  it("reads DOCKETRY_* env when TALLYLINE_* is unset; new names win", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tly-cfg-"));
    const legacy = await resolveConfig({
      env: { HOME: dir, DOCKETRY_TOKEN: "dok_agt_old", DOCKETRY_WORKSPACE: "old" },
      cwd: dir,
    });
    expect(legacy.config.token).toBe("dok_agt_old");
    expect(legacy.config.workspace).toBe("old");

    const both = await resolveConfig({
      env: {
        HOME: dir,
        DOCKETRY_TOKEN: "dok_agt_old",
        TALLYLINE_TOKEN: "tly_agt_new",
      },
      cwd: dir,
    });
    expect(both.config.token).toBe("tly_agt_new");
  });

  it("still loads legacy config files; tallyline-named files override them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tly-cfg-"));
    await mkdir(join(dir, ".docketry"), { recursive: true });
    await writeFile(
      join(dir, ".docketry", "config.json"),
      JSON.stringify({ workspace: "legacy-ws", apiUrl: "http://legacy" }),
    );
    const onlyLegacy = await resolveConfig({ env: { HOME: dir }, cwd: dir });
    expect(onlyLegacy.config.workspace).toBe("legacy-ws");

    await writeFile(
      join(dir, ".tallyline.json"),
      JSON.stringify({ workspace: "new-ws" }),
    );
    const both = await resolveConfig({ env: { HOME: dir }, cwd: dir });
    expect(both.config.workspace).toBe("new-ws");
    expect(both.config.apiUrl).toBe("http://legacy");
  });
});
