import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { config_ } from "../env.js";
import { createAssist } from "../services/assist.js";
import { llmEnabled, requireLLM } from "../services/llm.js";
import { requireWorkspace } from "./workspaces.js";

const assist = createAssist();

const dupCheckSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
});

export const assistRoutes = new Hono()
  .get("/workspaces/:ws/llm/status", async (c) => {
    await requireWorkspace(c);
    return c.json({
      enabled: llmEnabled(),
      // model name is not a secret — the UI shows what it would call
      model: llmEnabled() ? config_.llmModel : null,
    });
  })
  .post("/workspaces/:ws/issues/:key/summarize", async (c) => {
    const ws = await requireWorkspace(c);
    requireLLM();
    const summary = await assist.summarizeIssue(ws.id, c.req.param("key"));
    return c.json({ summary });
  })
  .post("/workspaces/:ws/issues/:key/triage-suggest", async (c) => {
    const ws = await requireWorkspace(c);
    requireLLM();
    return c.json(await assist.suggestTriage(ws.id, c.req.param("key")));
  })
  .post(
    "/workspaces/:ws/issues/dup-check",
    zValidator("json", dupCheckSchema),
    async (c) => {
      const ws = await requireWorkspace(c);
      requireLLM();
      const body = c.req.valid("json");
      const duplicates = await assist.checkDuplicates(
        ws.id,
        body.title,
        body.description,
      );
      return c.json({ duplicates });
    },
  );
