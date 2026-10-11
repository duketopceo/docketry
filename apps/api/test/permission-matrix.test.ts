import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index.js";
import { routeDiff } from "../src/lib/route-diff.js";
import { openApiDoc } from "../src/openapi.js";
import { CREDENTIALS, OPERATIONS, type Caller, type CredName } from "./matrix-ops.js";
import { newSession, seedTenant, type Tenant } from "./tenants.js";

// PLAN-035: credential x operation permission matrix.
//
// The policy lives in permission-matrix.csv (one row per OpenAPI operation,
// one column per credential). This file never decides what is allowed; it only
// (1) proves the table covers exactly the operations the router registers and
// (2) replays every cell against the real app and compares.

interface Row {
  op: string;
  cells: Record<CredName, string>;
  notes: string;
}

function loadPolicy(): Row[] {
  const lines = readFileSync(new URL("./permission-matrix.csv", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"));
  const header = lines.shift()!.split(",");
  expect(header.slice(0, 2)).toEqual(["method", "path"]);
  expect(header.slice(2, 2 + CREDENTIALS.length)).toEqual([...CREDENTIALS]);
  return lines.map((line) => {
    const f = line.split(",");
    const cells = {} as Record<CredName, string>;
    CREDENTIALS.forEach((c, i) => (cells[c] = f[2 + i]!));
    return { op: `${f[0]} ${f[1]}`, cells, notes: f.slice(2 + CREDENTIALS.length).join(",") };
  });
}

const policy = loadPolicy();
const CELL = /^(ALLOW|(401|403):[A-Z_]+)$/;

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  // never touch the network: github import / provider probes / llm all fetch
  vi.stubGlobal(
    "fetch",
    async () => {
      throw new Error("network disabled in permission-matrix test");
    },
  );
  A = await seedTenant("a", "AAA"); // created first => owner A is the instance admin
  B = await seedTenant("b", "BBB");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("permission matrix: table coverage", () => {
  it("lists exactly the operations the router registers (fails on any missing route)", () => {
    const d = routeDiff(app, openApiDoc);
    const inTable = new Set(policy.map((r) => r.op));
    expect(d.impl.filter((o) => !inTable.has(o)), "registered but not in permission-matrix.csv").toEqual([]);
    expect([...inTable].filter((o) => !d.impl.includes(o)), "in permission-matrix.csv but not registered").toEqual([]);
    expect(policy.length).toBe(d.impl.length);
    expect(inTable.size).toBe(policy.length); // no duplicate rows
  });

  it("detects a route missing from the table (guard against a vacuous check)", () => {
    const d = routeDiff(app, openApiDoc);
    const trimmed = new Set(policy.slice(1).map((r) => r.op));
    expect(d.impl.filter((o) => !trimmed.has(o))).toEqual([policy[0]!.op]);
  });

  it("has a request builder for every operation", () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(policy.map((r) => r.op).sort());
  });

  it("uses only valid cells and covers all credentials", () => {
    for (const r of policy) {
      for (const c of CREDENTIALS) {
        expect(r.cells[c], `${r.op} / ${c}`).toMatch(CELL);
      }
    }
  });
});

async function resolve(name: CredName): Promise<{ headers: Record<string, string>; caller: Caller }> {
  switch (name) {
    case "anonymous":
      return { headers: {}, caller: { name, userId: null } };
    case "member":
    case "admin":
    case "owner":
      return {
        headers: { cookie: `dok_session=${await newSession(A, name)}` },
        caller: { name, userId: A.people[name].id },
      };
    case "agent_read":
      return { headers: { authorization: `Bearer ${A.agentKeys.read}` }, caller: { name, userId: null } };
    case "agent_write":
      return { headers: { authorization: `Bearer ${A.agentKeys.write}` }, caller: { name, userId: null } };
    case "pat_read":
      return { headers: { authorization: `Bearer ${A.pats.read}` }, caller: { name, userId: A.people.owner.id } };
    case "pat_write":
      return { headers: { authorization: `Bearer ${A.pats.write}` }, caller: { name, userId: A.people.owner.id } };
    case "outsider":
      return {
        headers: { cookie: `dok_session=${await newSession(B, "owner")}` },
        caller: { name, userId: B.people.owner.id },
      };
  }
}

const cases = policy.flatMap((r) => CREDENTIALS.map((c) => ({ op: r.op, cred: c, expected: r.cells[c] })));

describe("permission matrix: replay", () => {
  it(`covers ${policy.length} operations x ${CREDENTIALS.length} credentials = ${cases.length} cases`, () => {
    expect(cases.length).toBe(policy.length * CREDENTIALS.length);
    expect(cases.length).toBeGreaterThanOrEqual(891);
  });

  it.each(cases)("$op as $cred -> $expected", async ({ op, cred, expected }) => {
    const { headers, caller } = await resolve(cred);
    const built = await OPERATIONS[op]!(A, caller);
    const res = await app.fetch(
      new Request(`http://matrix.test${built.path}`, {
        method: built.method,
        headers: {
          ...(built.rawBody === undefined && built.body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
          ...built.headers,
        },
        ...(built.rawBody !== undefined
          ? { body: built.rawBody }
          : built.body !== undefined
            ? { body: JSON.stringify(built.body) }
            : {}),
      }),
    );
    const status = res.status;
    let code: string | undefined;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      const j = (await res.json()) as { error?: { code?: string } };
      code = j.error?.code;
    } else {
      await res.body?.cancel(); // SSE and redirects: status is all we need
    }

    const label = `${op} as ${cred}: got ${status}${code ? ":" + code : ""}`;
    if (expected === "ALLOW") {
      expect([401, 403], label).not.toContain(status);
      // 503 = feature not configured (LLM, GitHub App) — still authorized; 500 is a bug
      expect(status, label).not.toBe(500);
    } else {
      const [s, c] = expected.split(":");
      expect(`${status}:${code}`, label).toBe(`${s}:${c}`);
    }
  });
});
