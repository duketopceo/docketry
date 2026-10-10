import { describe, expect, it } from "vitest";
import { normalizeEventSelection } from "../lib/events";
import {
	buildIssueCreateBody,
	buildIssueListQuery,
	buildIssueUpdateBody,
	rlcValue,
} from "../lib/params";
import { signDocketryBody, verifyDocketrySignature } from "../lib/signature";
import {
	extractList,
	normalizeBaseUrl,
	num,
	str,
	workspaceUrl,
} from "../lib/transport";

const SECRET = "dok_wh_testsecret123";

describe("signature", () => {
	it("round-trips a body the API would sign", () => {
		const body = JSON.stringify({ id: "d1", action: "issue.created", n: 1 });
		const sig = signDocketryBody(body, SECRET);
		expect(sig.startsWith("sha256=")).toBe(true);
		expect(verifyDocketrySignature(body, sig, SECRET)).toBe(true);
	});

	it("rejects tampered bodies, wrong secrets, and malformed headers", () => {
		const body = JSON.stringify({ id: "d1", action: "issue.created" });
		const sig = signDocketryBody(body, SECRET);
		expect(
			verifyDocketrySignature(body.replace("d1", "d2"), sig, SECRET),
		).toBe(false);
		expect(verifyDocketrySignature(body, sig, "other-secret")).toBe(false);
		expect(verifyDocketrySignature(body, "sha1=abc", SECRET)).toBe(false);
		expect(verifyDocketrySignature(body, undefined, SECRET)).toBe(false);
		expect(verifyDocketrySignature(undefined, sig, SECRET)).toBe(false);
		expect(verifyDocketrySignature(body, sig, undefined)).toBe(false);
	});

	it("verifies against a re-stringified parsed body (n8n webhook path)", () => {
		const body = JSON.stringify({ id: "d1", action: "issue.created", x: [1, 2] });
		const sig = signDocketryBody(body, SECRET);
		const reparsed = JSON.stringify(JSON.parse(body));
		expect(verifyDocketrySignature(reparsed, sig, SECRET)).toBe(true);
	});
});

describe("events", () => {
	it("collapses * and dedupes selections", () => {
		expect(normalizeEventSelection(["issue.created", "*"])).toEqual(["*"]);
		expect(
			normalizeEventSelection(["issue.created", "issue.created", "issue.commented"]),
		).toEqual(["issue.created", "issue.commented"]);
	});
});

describe("transport", () => {
	it("normalizes base URLs and builds workspace URLs", () => {
		expect(normalizeBaseUrl("  https://api.example.com/  ")).toBe(
			"https://api.example.com",
		);
		const creds = { baseUrl: "https://api.example.com/", workspace: "acme co" };
		expect(workspaceUrl(creds, "/issues")).toBe(
			"https://api.example.com/v1/workspaces/acme%20co/issues",
		);
	});

	it("extracts list envelopes and typed fields", () => {
		expect(extractList({ issues: [1, 2] }, "issues")).toEqual([1, 2]);
		expect(extractList({}, "issues")).toEqual([]);
		expect(extractList({ issues: "nope" }, "issues")).toEqual([]);
		expect(str({ key: "SL-1" }, "key")).toBe("SL-1");
		expect(str({ key: 5 }, "key")).toBeUndefined();
		expect(num({ estimate: 3 }, "estimate")).toBe(3);
		expect(num({ estimate: "3" }, "estimate")).toBeUndefined();
	});
});

describe("params", () => {
	it("extracts ids from resourceLocator params", () => {
		expect(rlcValue({ __rl: true, mode: "list", value: "abc" })).toBe("abc");
		expect(rlcValue("plain")).toBe("plain");
		expect(rlcValue({ __rl: true, mode: "list", value: 4 })).toBe("");
	});

	it("builds create bodies with only set fields", () => {
		const body = buildIssueCreateBody({
			teamKey: "SL",
			title: "thing",
			description: "",
			priority: "high",
			assigneeType: "agent",
			assigneeId: "",
			labelIds: ["l1"],
		});
		expect(body).toEqual({
			teamKey: "SL",
			title: "thing",
			source: "api",
			priority: "high",
			labelIds: ["l1"],
		});
	});

	it("builds update bodies and expands clearFields", () => {
		const body = buildIssueUpdateBody({
			state: "in_progress",
			priority: "bogus",
			estimate: 3.7,
			clearFields: ["assignee", "project"],
		});
		expect(body).toEqual({
			state: "in_progress",
			estimate: 3,
			assigneeType: null,
			assigneeId: null,
			projectId: null,
		});
	});

	it("builds list queries, dropping empty filters", () => {
		expect(
			buildIssueListQuery({ state: "backlog", search: "", priority: "high" }, 50),
		).toEqual({ state: "backlog", priority: "high", limit: 50 });
	});
});
