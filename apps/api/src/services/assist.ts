import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { comments, issues } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import {
  createOpenRouterProvider,
  type FetchLike,
  type LLMProvider,
} from "./llm.js";

// Every surface is opt-in: callers invoke on demand, nothing fires on writes.
// The kill switch lives in the route layer (requireLLM) — a provider injected
// here is explicit intent to run, which is what tests and future tools use.

export interface TriageSuggestion {
  action: "accept" | "decline";
  reason: string;
}

export interface DuplicateMatch {
  key: string;
  title: string;
  reason: string;
}

const SYSTEM = "You are a terse assistant embedded in an issue tracker. Answer only what is asked; no preamble.";

function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

async function findIssueRow(workspaceId: string, key: string) {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.key, key)));
  if (!issue) throw new HttpError(404, "NOT_FOUND", "issue not found");
  return issue;
}

export function createAssist(provider?: LLMProvider, fetchImpl?: FetchLike) {
  const llm = provider ?? createOpenRouterProvider(fetchImpl);

  return {
    async summarizeIssue(workspaceId: string, key: string): Promise<string> {
      const issue = await findIssueRow(workspaceId, key);
      const thread = await db
        .select({ body: comments.body })
        .from(comments)
        .where(eq(comments.issueId, issue.id))
        .orderBy(desc(comments.createdAt))
        .limit(20);
      const prompt = [
        `Issue ${issue.key} (${issue.state}, priority ${issue.priority}): ${issue.title}`,
        issue.description ? `Description:\n${issue.description}` : "",
        thread.length > 0
          ? `Comments (newest first):\n${thread.map((c) => `- ${c.body}`).join("\n")}`
          : "",
        "\nSummarize this issue in 2-3 sentences: what it is, current state, and what happens next if anything.",
      ]
        .filter(Boolean)
        .join("\n\n");
      return llm.complete({ system: SYSTEM, user: prompt });
    },

    async suggestTriage(
      workspaceId: string,
      key: string,
    ): Promise<TriageSuggestion> {
      const issue = await findIssueRow(workspaceId, key);
      const prompt = [
        `Triage this issue:\nKey: ${issue.key}\nTitle: ${issue.title}`,
        issue.description ? `Description:\n${issue.description}` : "",
        `\nReply as JSON only: {"action":"accept"|"decline","reason":"one sentence"}.`,
        `Accept if this is actionable work for the team; decline if it is noise, spam, a question, or not work.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const text = await llm.complete({
        system: SYSTEM,
        user: prompt,
        maxTokens: 128,
      });
      const parsed = parseJson<{ action?: string; reason?: string }>(text);
      if (
        !parsed ||
        (parsed.action !== "accept" && parsed.action !== "decline")
      ) {
        throw new HttpError(
          502,
          "LLM_BAD_RESPONSE",
          "triage suggestion was not parseable",
        );
      }
      return { action: parsed.action, reason: parsed.reason ?? "" };
    },

    async checkDuplicates(
      workspaceId: string,
      title: string,
      description?: string,
    ): Promise<DuplicateMatch[]> {
      // candidates: recent non-terminal issues — cap keeps the prompt small
      const candidates = await db
        .select({ key: issues.key, title: issues.title })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            ne(issues.state, "done"),
            ne(issues.state, "canceled"),
            ne(issues.state, "duplicate"),
          ),
        )
        .orderBy(desc(issues.createdAt))
        .limit(100);
      if (candidates.length === 0) return [];

      const prompt = [
        `New issue title: ${title}`,
        description ? `New issue description: ${description}` : "",
        `Existing open issues:\n${candidates.map((c) => `${c.key}: ${c.title}`).join("\n")}`,
        `\nWhich existing issues are likely duplicates of the new one? Reply as JSON only: {"duplicates":[{"key":"ABC-1","reason":"one sentence"}]}. Return an empty list if none.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const text = await llm.complete({
        system: SYSTEM,
        user: prompt,
        maxTokens: 256,
      });
      const parsed = parseJson<{
        duplicates?: { key?: string; reason?: string }[];
      }>(text);
      const byKey = new Map(candidates.map((c) => [c.key, c.title]));
      return (parsed?.duplicates ?? [])
        .filter((d): d is { key: string; reason?: string } => !!d.key)
        .flatMap((d) => {
          const t = byKey.get(d.key);
          return t ? [{ key: d.key, title: t, reason: d.reason ?? "" }] : [];
        });
    },
  };
}

export type Assist = ReturnType<typeof createAssist>;
