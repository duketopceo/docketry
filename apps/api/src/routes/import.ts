import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { teams } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { importGithubIssues, importLinearCsv } from "../services/import.js";
import { requireWorkspace } from "./workspaces.js";

const targetSchema = z.enum(["triage", "backlog"]).default("triage");

const githubImportSchema = z.object({
  fullName: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "expected 'owner/repo'"),
  // caller-supplied PAT or installation token; app-token minting lands with
  // bidirectional sync (#60)
  token: z.string().min(1),
  target: targetSchema,
  teamKey: z.string().regex(/^[A-Z][A-Z0-9]*$/).optional(),
});

const linearImportSchema = z.object({
  teamKey: z.string().regex(/^[A-Z][A-Z0-9]*$/),
  target: targetSchema,
  csv: z.string().min(1),
});

export const importRoutes = new Hono()
  .post(
    "/workspaces/:ws/import/github",
    zValidator("json", githubImportSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      let teamId: string | undefined;
      if (body.teamKey) {
        const [team] = await db
          .select()
          .from(teams)
          .where(and(eq(teams.workspaceId, ws.id), eq(teams.key, body.teamKey)))
          .limit(1);
        if (!team) {
          throw new HttpError(404, "NOT_FOUND", `team '${body.teamKey}' not found`);
        }
        teamId = team.id;
      }
      const result = await importGithubIssues({
        workspaceId: ws.id,
        fullName: body.fullName,
        token: body.token,
        target: body.target,
        teamId,
      });
      if (result.errors.length > 0 && result.created === 0) {
        throw new HttpError(502, "IMPORT_FAILED", result.errors.join("; "));
      }
      return c.json(result);
    },
  )
  .post(
    "/workspaces/:ws/import/linear",
    zValidator("json", linearImportSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      const body = c.req.valid("json");
      const [team] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.workspaceId, ws.id), eq(teams.key, body.teamKey)))
        .limit(1);
      if (!team) {
        throw new HttpError(404, "NOT_FOUND", `team '${body.teamKey}' not found`);
      }
      const result = await importLinearCsv({
        workspaceId: ws.id,
        teamId: team.id,
        csv: body.csv,
        target: body.target,
      });
      return c.json(result);
    },
  );
