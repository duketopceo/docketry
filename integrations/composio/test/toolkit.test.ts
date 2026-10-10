import { describe, expect, it } from "vitest";
import { ApiError, DocketryClient, type FetchLike } from "../src/client.js";
import { createDocketryToolkit } from "../src/toolkit.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(handler: (call: Call) => unknown): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      ...(init?.body !== undefined ? { body: init.body } : {}),
    };
    calls.push(call);
    const out = handler(call);
    return new Response(JSON.stringify(out ?? {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const CONFIG = {
  baseUrl: "https://docketry.example.com/",
  workspace: "acme",
  apiKey: "dok_agt_test",
};

describe("DocketryClient", () => {
  it("sends bearer auth against the workspace base", async () => {
    const { fetch, calls } = fakeFetch(() => ({ issues: [] }));
    const client = new DocketryClient({ ...CONFIG, fetch });
    await client.apiGet("/issues", { state: "todo", limit: 5 });
    const [c] = calls;
    expect(c!.url).toBe(
      "https://docketry.example.com/v1/workspaces/acme/issues?state=todo&limit=5",
    );
    expect(c!.headers.authorization).toBe("Bearer dok_agt_test");
  });

  it("surfaces API error envelopes as ApiError", async () => {
    const failing: FetchLike = async () =>
      new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: "illegal transition" } }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    const client = new DocketryClient({ ...CONFIG, fetch: failing });
    await expect(client.apiGet("/issues")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "CONFLICT",
    } satisfies Partial<ApiError>);
  });
});

describe("createDocketryToolkit", () => {
  it("registers DOCKETRY_* tools mapping 1:1 to the API surface", () => {
    const toolkit = createDocketryToolkit({ ...CONFIG, fetch: fakeFetch(() => ({})).fetch });
    const slugs = toolkit.tools.map((t) => t.slug);
    for (const expected of [
      "DOCKETRY_WHOAMI",
      "DOCKETRY_LIST_ISSUES",
      "DOCKETRY_GET_ISSUE",
      "DOCKETRY_CREATE_ISSUE",
      "DOCKETRY_UPDATE_ISSUE",
      "DOCKETRY_TRIAGE_ISSUE",
      "DOCKETRY_COMMENT",
      "DOCKETRY_LIST_EVENTS",
      "DOCKETRY_LIST_TEAMS",
      "DOCKETRY_LIST_AGENTS",
      "DOCKETRY_LIST_LABELS",
      "DOCKETRY_LIST_PROJECTS",
      "DOCKETRY_LIST_CYCLES",
    ]) {
      expect(slugs).toContain(expected);
    }
  });

  it("executes tools through the client", async () => {
    const { fetch, calls } = fakeFetch((c) => {
      if (c.url.endsWith("/issues/SL-7")) return { key: "SL-7", title: "x" };
      if (c.url.endsWith("/issues/SL-7/triage")) return { ok: true };
      return {};
    });
    const toolkit = createDocketryToolkit({ ...CONFIG, fetch });
    const bySlug = new Map(toolkit.tools.map((t) => [t.slug, t]));

    const get = await bySlug.get("DOCKETRY_GET_ISSUE")!.execute(
      { key: "SL-7" },
      { userId: "u" } as Parameters<
        (typeof toolkit.tools)[number]["execute"]
      >[1],
    );
    expect(get.key).toBe("SL-7");

    await bySlug.get("DOCKETRY_TRIAGE_ISSUE")!.execute(
      { key: "SL-7", action: "accept" },
      { userId: "u" } as Parameters<
        (typeof toolkit.tools)[number]["execute"]
      >[1],
    );
    const triage = calls.find((c) => c.url.endsWith("/triage"))!;
    expect(triage.method).toBe("POST");
    expect(JSON.parse(triage.body!)).toEqual({ action: "accept" });
  });
});
