import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  agents,
  comments,
  events,
  issues,
  slackLinks,
  teams,
  users,
  workspaces,
} from "../db/schema.js";
import { config_ } from "../env.js";
import { slackApi, type FetchLike } from "../lib/slack.js";
import { HttpError } from "../lib/errors.js";
import { createIssue, type Actor } from "./issues.js";

const SYSTEM: Actor = { type: "system", id: null };
// Provenance marker on comments mirrored FROM Slack — the outbound mirror
// skips bodies carrying it so a mirrored thread can't echo back and forth.
const SLACK_VIA = /via Slack:/;

export function createSlack(fetchImpl?: FetchLike) {
  const api = (method: string, body: Record<string, unknown>) =>
    slackApi(method, body, fetchImpl);

  async function boundWorkspace() {
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, config_.slackWorkspaceSlug));
    if (!ws) throw new HttpError(404, "NOT_FOUND", "slack workspace not bound");
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.workspaceId, ws.id))
      .orderBy(asc(teams.createdAt))
      .limit(1);
    if (!team) throw new HttpError(404, "NOT_FOUND", "no team in workspace");
    return { ws, team };
  }

  async function createFromSlack(input: {
    title: string;
    description?: string | undefined;
    channel: string;
    threadTs: string;
    reporterSlackId?: string | undefined;
    reporterName?: string | undefined;
  }) {
    const { ws, team } = await boundWorkspace();
    const issue = await createIssue({
      workspaceId: ws.id,
      teamId: team.id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      source: "slack",
      creator: SYSTEM,
      state: "triage",
    });
    // the (channel, thread_ts) unique claim is what makes intake atomic:
    // a losing concurrent/retried delivery gets no row back
    const [link] = await db
      .insert(slackLinks)
      .values({
        workspaceId: ws.id,
        issueId: issue.id,
        channel: input.channel,
        threadTs: input.threadTs,
        reporterSlackId: input.reporterSlackId ?? null,
        reporterName: input.reporterName ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: slackLinks.id });
    if (!link) {
      // another delivery claimed this thread first — drop our duplicate
      await db
        .delete(events)
        .where(and(eq(events.entityType, "issue"), eq(events.entityId, issue.id)));
      await db.delete(issues).where(eq(issues.id, issue.id));
      return null;
    }
    return issue;
  }

  function issueUrl(key: string): string {
    return `${config_.apiBaseUrl.replace(/:\d+$/, ":3100")}/issues/${key}`;
  }

  // ── slash command ──────────────────────────────────────────────────
  async function handleSlashCommand(p: {
    trigger_id?: string | undefined;
    text?: string | undefined;
    channel_id?: string | undefined;
    user_id?: string | undefined;
    user_name?: string | undefined;
  }): Promise<Record<string, unknown>> {
    const text = p.text?.trim();
    if (!text) {
      // no args → open the intake modal; the submission arrives separately
      const modal = {
        trigger_id: p.trigger_id,
        view: {
          type: "modal",
          callback_id: "docket_intake",
          private_metadata: p.channel_id ?? "",
          title: { type: "plain_text", text: "New issue" },
          submit: { type: "plain_text", text: "Create" },
          blocks: [
            {
              type: "input",
              block_id: "title",
              label: { type: "plain_text", text: "Title" },
              element: {
                type: "plain_text_input",
                action_id: "title",
                max_length: 200,
              },
            },
            {
              type: "input",
              block_id: "description",
              optional: true,
              label: { type: "plain_text", text: "Description" },
              element: { type: "plain_text_input", action_id: "description", multiline: true },
            },
            {
              type: "input",
              block_id: "urgency",
              optional: true,
              label: { type: "plain_text", text: "Urgency" },
              element: {
                type: "static_select",
                action_id: "urgency",
                options: ["low", "medium", "high", "urgent"].map((v) => ({
                  text: { type: "plain_text", text: v },
                  value: v,
                })),
              },
            },
          ],
        },
      };
      await api("views.open", modal);
      return {}; // 200 empty — modal carries the flow
    }
    // fast path: `/docket <title>` creates immediately
    const issue = await createFromSlack({
      title: text.slice(0, 200),
      channel: p.channel_id ?? "",
      threadTs: `${Date.now() / 1000}`,
      reporterSlackId: p.user_id,
      reporterName: p.user_name,
    });
    if (!issue) {
      return {
        response_type: "ephemeral",
        text: "That thread is already linked to a docketry issue.",
      };
    }
    return {
      response_type: "ephemeral",
      text: `Created *${issue.key}* — ${issue.title}\n${issueUrl(issue.key)}`,
    };
  }

  // ── modal submission ───────────────────────────────────────────────
  async function handleViewSubmission(p: {
    view?: {
      private_metadata?: string;
      state?: {
        values?: Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>>;
      };
    } | undefined;
    user?: { id?: string; username?: string; name?: string } | undefined;
  }): Promise<Record<string, unknown>> {
    const v = p.view?.state?.values ?? {};
    const title = v.title?.title?.value?.trim();
    if (!title) {
      return {
        response_action: "errors",
        errors: { title: "Title is required" },
      };
    }
    const desc = v.description?.description?.value?.trim();
    const urgency = v.urgency?.urgency?.selected_option?.value;
    const description = [
      desc ?? "",
      urgency ? `Urgency: ${urgency}` : "",
      `Reported from Slack${p.user?.username ? ` by @${p.user.username}` : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const channel = p.view?.private_metadata ?? "";
    const threadTs = `${Date.now() / 1000}`;
    const issue = await createFromSlack({
      title: title.slice(0, 200),
      ...(description ? { description } : {}),
      channel,
      threadTs,
      reporterSlackId: p.user?.id,
      reporterName: p.user?.username ?? p.user?.name,
    });
    if (!issue) {
      // duplicate submission on an already-linked thread — nothing to post
      return { response_action: "clear" };
    }
    if (channel) {
      try {
        const posted = await api("chat.postMessage", {
          channel,
          text: `:ticket: *${issue.key}* — ${issue.title}\n${issueUrl(issue.key)}`,
        });
        const ts = posted.ts as string | undefined;
        if (ts) {
          await db
            .update(slackLinks)
            .set({ threadTs: ts })
            .where(eq(slackLinks.issueId, issue.id));
        }
      } catch (e) {
        console.error("slack confirmation post failed", e);
      }
    }
    return { response_action: "clear" };
  }

  // ── emoji intake ───────────────────────────────────────────────────
  async function handleReactionAdded(ev: {
    reaction?: string;
    item?: { type?: string; channel?: string; ts?: string };
    item_user?: string;
  }) {
    if (ev.reaction !== config_.slackIntakeEmoji) return;
    if (ev.item?.type !== "message" || !ev.item.channel || !ev.item.ts) return;
    const channel = ev.item.channel;
    const parentTs = ev.item.ts;
    // one intake per thread — Slack retries events it thinks we dropped,
    // and a second person's :ticket: on the same message must not
    // double-create
    const [existing] = await db
      .select({ id: slackLinks.id })
      .from(slackLinks)
      .where(
        and(
          eq(slackLinks.channel, channel),
          eq(slackLinks.threadTs, parentTs),
        ),
      );
    if (existing) return;
    // thread context: the reacted message + its replies form the body
    let threadText = "";
    try {
      const replies = await api("conversations.replies", {
        channel,
        ts: parentTs,
        limit: 20,
      });
      const msgs = (replies.messages as { user?: string; text?: string }[]) ?? [];
      threadText = msgs
        .map((m) => `${m.user ? `<@${m.user}>: ` : ""}${m.text ?? ""}`)
        .join("\n")
        .slice(0, 4_000);
    } catch (e) {
      console.error("slack replies fetch failed", e);
    }
    const firstLine = threadText.split("\n")[0] ?? "Slack intake";
    const title = firstLine.replace(/^<@[A-Z0-9]+>:\s*/, "").slice(0, 120) || "Slack intake";
    const issue = await createFromSlack({
      title,
      description: `Captured from Slack thread:\n\n${threadText}`,
      channel,
      threadTs: parentTs,
      reporterSlackId: ev.item_user,
    });
    // null = a concurrent delivery claimed the thread first — its reply covers us
    if (!issue) return;
    try {
      await api("chat.postMessage", {
        channel,
        thread_ts: parentTs,
        text: `:ticket: Drafted *${issue.key}* — ${issue.title}\n${issueUrl(issue.key)}`,
      });
    } catch (e) {
      console.error("slack intake reply failed", e);
    }
  }

  // ── inbound mirror: slack thread reply → issue comment ────────────
  async function handleMessage(ev: {
    channel?: string;
    ts?: string;
    thread_ts?: string;
    text?: string;
    user?: string;
    bot_id?: string;
    subtype?: string;
  }) {
    // bot/our-own posts and edits never mirror — that's the loop break
    if (ev.bot_id || (ev.subtype && ev.subtype !== "thread_broadcast")) return;
    const threadTs = ev.thread_ts ?? ev.ts;
    if (!ev.channel || !threadTs || !ev.text) return;
    const [link] = await db
      .select()
      .from(slackLinks)
      .where(
        and(eq(slackLinks.channel, ev.channel), eq(slackLinks.threadTs, threadTs)),
      );
    if (!link) return;
    const [issue] = await db.select().from(issues).where(eq(issues.id, link.issueId));
    if (!issue) return;
    await db.insert(comments).values({
      workspaceId: link.workspaceId,
      issueId: issue.id,
      actorType: "system",
      actorId: null,
      body: `**<@${ev.user}> via Slack:** ${ev.text}`,
    });
    await db.insert(events).values({
      workspaceId: link.workspaceId,
      entityType: "issue",
      entityId: issue.id,
      action: "commented",
      actorType: "system",
      actorId: null,
      after: { via: "slack", key: issue.key },
    });
  }

  // ── outbound mirror: issue comment → slack thread ─────────────────
  async function mirrorComment(issueId: string, body: string) {
    if (SLACK_VIA.test(body)) return; // slack-originated — don't echo back
    const [link] = await db
      .select()
      .from(slackLinks)
      .where(eq(slackLinks.issueId, issueId));
    if (!link) return;
    try {
      await api("chat.postMessage", {
        channel: link.channel,
        thread_ts: link.threadTs,
        text: body.slice(0, 3_000),
      });
    } catch (e) {
      console.error("slack mirror failed", e);
    }
  }

  // ── resolution reply on terminal transition ───────────────────────
  async function notifyResolution(issueId: string, state: string, actor: Actor) {
    const [link] = await db
      .select()
      .from(slackLinks)
      .where(eq(slackLinks.issueId, issueId));
    if (!link) return;
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    if (!issue) return;
    let actorName: string = actor.type;
    if (actor.id) {
      const [u] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, actor.id));
      if (u) actorName = u.name;
      else {
        const [a] = await db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, actor.id));
        if (a) actorName = a.name;
      }
    }
    try {
      await api("chat.postMessage", {
        channel: link.channel,
        thread_ts: link.threadTs,
        text: `:white_check_mark: *${issue.key}* ${state} by ${actorName}`,
      });
    } catch (e) {
      console.error("slack resolution reply failed", e);
    }
  }

  return {
    createFromSlack,
    handleSlashCommand,
    handleViewSubmission,
    handleReactionAdded,
    handleMessage,
    mirrorComment,
    notifyResolution,
  };
}

export type Slack = ReturnType<typeof createSlack>;
