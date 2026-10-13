import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runColonCommand } from "./colon-commands";

// runColonCommand is fetch-driven; stub fetch per scenario and assert on
// the request bodies it sends to the /api bridges.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function okJson(body: unknown = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

function patchCalls(): { key: string; body: Record<string, unknown> }[] {
  return fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit)?.method === "PATCH")
    .map((c) => ({
      key: String(c[0]).split("/api/issues/")[1]!,
      body: JSON.parse(String((c[1] as RequestInit).body)),
    }));
}

describe("runColonCommand", () => {
  it("priority sets a valid level and rejects junk", async () => {
    fetchMock.mockImplementation(() => okJson());
    const good = await runColonCommand("priority TLY-1 urgent");
    expect(good.ok).toBe(true);
    expect(patchCalls()).toEqual([
      { key: "TLY-1", body: { priority: "urgent" } },
    ]);

    const bad = await runColonCommand("priority TLY-1 someday");
    expect(bad.ok).toBe(false);
    expect(patchCalls()).toHaveLength(1);
  });

  it("unassign clears both assignee fields", async () => {
    fetchMock.mockImplementation(() => okJson());
    const r = await runColonCommand("unassign TLY-2");
    expect(r.ok).toBe(true);
    expect(patchCalls()).toEqual([
      { key: "TLY-2", body: { assigneeType: null, assigneeId: null } },
    ]);
  });

  it("label add merges with the existing set; remove subtracts", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/labels")
        return okJson({
          labels: [
            { id: "L1", name: "bug" },
            { id: "L2", name: "feature" },
          ],
        });
      if (url.startsWith("/api/issues/"))
        return okJson({ labels: [{ id: "L1", name: "bug" }] });
      return okJson();
    });
    const add = await runColonCommand("label TLY-3 add feature");
    expect(add.ok).toBe(true);
    expect(patchCalls().at(-1)?.body).toEqual({ labelIds: ["L1", "L2"] });

    const rm = await runColonCommand("label TLY-3 remove bug");
    expect(patchCalls().at(-1)?.body).toEqual({ labelIds: [] });

    const miss = await runColonCommand("label TLY-3 add nope");
    expect(miss.ok).toBe(false);
    expect(miss.message).toContain("not found");
  });

  it("due validates the date shape", async () => {
    fetchMock.mockImplementation(() => okJson());
    const r = await runColonCommand("due TLY-4 2026-12-01");
    expect(r.ok).toBe(true);
    expect(patchCalls()[0]?.body.dueDate).toBe("2026-12-01T00:00:00.000Z");

    await runColonCommand("due TLY-4 none");
    expect(patchCalls()[1]?.body.dueDate).toBeNull();

    const bad = await runColonCommand("due TLY-4 tuesday");
    expect(bad.ok).toBe(false);
  });

  it("estimate accepts points or none", async () => {
    fetchMock.mockImplementation(() => okJson());
    await runColonCommand("estimate TLY-5 3");
    expect(patchCalls()[0]?.body).toEqual({ estimate: 3 });
    await runColonCommand("estimate TLY-5 none");
    expect(patchCalls()[1]?.body).toEqual({ estimate: null });
    const bad = await runColonCommand("estimate TLY-5 lots");
    expect(bad.ok).toBe(false);
  });
});
