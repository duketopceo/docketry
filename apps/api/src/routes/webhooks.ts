import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import {
  githubInstallations,
  githubRepos,
  githubWebhookEvents,
} from "../db/schema.js";
import { config_ } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { verifyGitHubSignature } from "../lib/github.js";

interface GhRepo {
  id: number;
  full_name?: string;
  name: string;
}

interface GhInstallationPayload {
  action: string;
  installation: { id: number; account: { login: string } };
  repositories?: GhRepo[];
  repositories_added?: GhRepo[];
  repositories_removed?: GhRepo[];
}

// workspace resolution: an installation maps to one workspace. The link is
// created on installation.created — bound to the workspace of the user who
// initiated it via state (future OAuth flow); for now the workspace is
// resolved from an existing installation row or the connect call.
async function upsertInstallationRepos(
  installationId: number,
  repos: GhRepo[],
): Promise<boolean> {
  const [inst] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  if (!inst) return false; // unbound — setup callback backfills from this delivery later
  for (const repo of repos) {
    const fullName = repo.full_name ?? repo.name;
    await db
      .insert(githubRepos)
      .values({
        workspaceId: inst.workspaceId,
        installationId,
        repoId: repo.id,
        fullName,
        enabled: false,
      })
      .onConflictDoUpdate({
        target: [githubRepos.workspaceId, githubRepos.fullName],
        set: { installationId, repoId: repo.id },
      });
  }
  return true;
}

export const webhookRoutes = new Hono().post("/github", async (c) => {
  if (!config_.githubWebhookSecret) {
    throw new HttpError(503, "GITHUB_NOT_CONFIGURED", "webhook secret not set");
  }

  const rawBody = await c.req.raw.text();
  const signature = c.req.header("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBody, signature, config_.githubWebhookSecret)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "bad webhook signature");
  }

  const deliveryId = c.req.header("x-github-delivery");
  const eventType = c.req.header("x-github-event");
  if (!deliveryId || !eventType) {
    throw new HttpError(400, "MALFORMED_DELIVERY", "missing delivery headers");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "MALFORMED_PAYLOAD", "invalid JSON body");
  }

  // dedupe: replayed deliveries are dropped and logged
  const [inserted] = await db
    .insert(githubWebhookEvents)
    .values({ deliveryId, eventType, payload })
    .onConflictDoNothing({ target: githubWebhookEvents.deliveryId })
    .returning({ id: githubWebhookEvents.id });
  if (!inserted) {
    console.warn(`github webhook: duplicate delivery ${deliveryId} dropped`);
    return c.json({ ok: true, duplicate: true });
  }

  if (eventType === "installation" || eventType === "installation_repositories") {
    const p = payload as unknown as GhInstallationPayload;
    if (eventType === "installation" && p.action === "deleted") {
      await db
        .delete(githubInstallations)
        .where(eq(githubInstallations.installationId, p.installation.id));
    } else if (p.installation?.id) {
      const repos =
        p.action === "repositories_removed"
          ? []
          : [...(p.repositories ?? []), ...(p.repositories_added ?? [])];
      const bound = await upsertInstallationRepos(p.installation.id, repos);
      for (const repo of p.repositories_removed ?? []) {
        const fullName = repo.full_name ?? repo.name;
        await db
          .delete(githubRepos)
          .where(
            and(
              eq(githubRepos.installationId, p.installation.id),
              eq(githubRepos.fullName, fullName),
            ),
          );
      }
      // unbound installations stay unprocessed so the setup callback can
      // backfill repos from the stored payload once a workspace claims it
      if (bound) {
        await db
          .update(githubWebhookEvents)
          .set({ processedAt: new Date() })
          .where(eq(githubWebhookEvents.deliveryId, deliveryId));
      }
    }
  }
  // other event types persist in the delivery log for #19/#20 consumers

  return c.json({ ok: true });
});
