import { describe, expect, it } from "vitest";
import { api, bootstrap } from "../../test/github.js";
import { app } from "../index.js";

describe("agent key revoke (UX-009)", () => {
  it("revokes a key immediately; plaintext was only ever in the mint response", async () => {
    const cookie = await bootstrap("akeys");
    const ag = await api(cookie, "/v1/workspaces/akeys/agents", {
      method: "POST",
      body: JSON.stringify({ name: "revoker", harness: "test" }),
    });
    expect(ag.status).toBe(201);
    const mint = await api(cookie, `/v1/workspaces/akeys/agents/${ag.body.id}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: "ci", scopes: ["read"] }),
    });
    expect(mint.status).toBe(201);
    expect(mint.body.key).toMatch(/^tly_agt_/);
    const asAgent = () =>
      app.fetch(
        new Request("http://api.test/v1/whoami", {
          headers: { authorization: `Bearer ${mint.body.key}` },
        }),
      );
    expect((await asAgent()).status).toBe(200);

    const list = await api(cookie, `/v1/workspaces/akeys/agents/${ag.body.id}/keys`);
    expect(JSON.stringify(list.body)).not.toContain(mint.body.key);

    const del = await api(
      cookie,
      `/v1/workspaces/akeys/agents/${ag.body.id}/keys/${mint.body.id}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);
    expect((await asAgent()).status).toBe(401);
    const gone = await api(
      cookie,
      `/v1/workspaces/akeys/agents/${ag.body.id}/keys/${mint.body.id}`,
      { method: "DELETE" },
    );
    expect(gone.status).toBe(404);
    const bad = await api(cookie, `/v1/workspaces/akeys/agents/${ag.body.id}/keys/nope`, {
      method: "DELETE",
    });
    expect(bad.status).toBe(404);
  });
});
