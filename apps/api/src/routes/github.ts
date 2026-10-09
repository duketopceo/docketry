import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  githubInstallations,
  githubRepos,
  githubWebhookEvents,
  teams,
} from "../db/schema.js";
import { config_ } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { requireWorkspace } from "./workspaces.js";

const repoBodySchema = z.object({
  fullName: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "expected 'owner/repo'"),
  teamKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9]*$/)
    .optional(),
});

export const githubRoutes = new Hono()
  // manifest flow: self-hosters POST this to github.com/apps/new to create
  // their own GitHub App with the right permissions/URLs preconfigured
  .get("/workspaces/:ws/github/manifest", async (c) => {
    await requireWorkspace(c);
    const base = config_.apiBaseUrl;
    return c.json({
      name: "docketry",
      url: base,
      hook_attributes: {
        url: `${base}/webhooks/github`,
        active: true,
      },
      redirect_url: `${base}/v1/github/setup`,
      public: false,
      default_permissions: {
        issues: "write",
        pull_requests: "read",
        contents: "read",
        metadata: "read",
      },
      default_events: [
        "installation",
        "installation_repositories",
        "issues",
        "issue_comment",
        "pull_request",
        "pull_request_review",
        "push",
      ],
    });
  })
  .get("/workspaces/:ws/github/install-url", async (c) => {
    await requireWorkspace(c);
    if (!config_.githubAppSlug) {
      throw new HttpError(503, "GITHUB_NOT_CONFIGURED", "GITHUB_APP_SLUG not set");
    }
    return c.json({
      installUrl: `https://github.com/apps/${config_.githubAppSlug}/installations/new`,
    });
  })
  // setup callback: GitHub redirects here after install; binds the
  // installation to this workspace and backfills repos from the stored
  // installation.created delivery (which arrives unbound)
  .get("/workspaces/:ws/github/setup", async (c) => {
    const ws = await requireWorkspace(c);
    const installationId = Number(c.req.query("installation_id"));
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new HttpError(400, "MALFORMED_SETUP", "missing installation_id");
    }
    const accountLogin = c.req.query("account_login") ?? "unknown";

    await db
      .insert(githubInstallations)
      .values({ workspaceId: ws.id, installationId, accountLogin })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: { workspaceId: ws.id, accountLogin },
      });

    // backfill repos captured in the delivery log before binding
    const deliveries = await db
      .select()
      .from(githubWebhookEvents)
      .where(
        and(
          eq(githubWebhookEvents.eventType, "installation"),
          isNull(githubWebhookEvents.processedAt),
        ),
      );
    for (const d of deliveries) {
      const p = d.payload as {
        installation?: { id: number };
        repositories?: { id: number; full_name?: string; name: string }[];
      };
      if (p.installation?.id !== installationId) continue;
      for (const repo of p.repositories ?? []) {
        const fullName = repo.full_name ?? repo.name;
        await db
          .insert(githubRepos)
          .values({
            workspaceId: ws.id,
            installationId,
            repoId: repo.id,
            fullName,
            enabled: false,
          })
          .onConflictDoNothing();
      }
      await db
        .update(githubWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(githubWebhookEvents.id, d.id));
    }

    return c.json({ ok: true, installationId, workspace: ws.slug });
  })
  .get("/workspaces/:ws/github/repos", async (c) => {
    const ws = await requireWorkspace(c);
    const rows = await db
      .select()
      .from(githubRepos)
      .where(eq(githubRepos.workspaceId, ws.id));
    return c.json({ repos: rows });
  })
  .post(
    "/workspaces/:ws/github/repos/connect",
    zValidator("json", repoBodySchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const { fullName, teamKey } = c.req.valid("json");
      let teamId: string | null = null;
      if (teamKey) {
        const [team] = await db
          .select()
          .from(teams)
          .where(and(eq(teams.workspaceId, ws.id), eq(teams.key, teamKey)))
          .limit(1);
        if (!team) {
          throw new HttpError(404, "NOT_FOUND", `team '${teamKey}' not found`);
        }
        teamId = team.id;
      }
      const [row] = await db
        .insert(githubRepos)
        .values({ workspaceId: ws.id, fullName, teamId, enabled: true })
        .onConflictDoUpdate({
          target: [githubRepos.workspaceId, githubRepos.fullName],
          set: { enabled: true, teamId },
        })
        .returning();
      return c.json(row);
    },
  )
  .post(
    "/workspaces/:ws/github/repos/disconnect",
    zValidator("json", repoBodySchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const { fullName } = c.req.valid("json");
      const [row] = await db
        .update(githubRepos)
        .set({ enabled: false })
        .where(
          and(
            eq(githubRepos.workspaceId, ws.id),
            eq(githubRepos.fullName, fullName),
          ),
        )
        .returning();
      if (!row) {
        throw new HttpError(404, "NOT_FOUND", `repo '${fullName}' not linked`);
      }
      return c.json(row);
    },
  );
