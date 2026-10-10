-- 0019: promote users to global identity.
-- forward-only and row-deleting — the pre-deploy pg_dump is the rollback
-- path (docs/deploy.md). Runs under pg_advisory_lock via migrate.ts.

ALTER TABLE "users" DROP CONSTRAINT "users_workspace_id_email_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_workspace_id_workspaces_id_fk";--> statement-breakpoint
DROP INDEX "users_workspace_id_index";--> statement-breakpoint

-- (a)+(b) find duplicate emails by lower(btrim(email)) and pick the
-- canonical survivor: the row with the most recent session wins (the
-- surviving password_hash should be the one the human remembers), then
-- earliest created_at, then lowest uuid
CREATE TEMP TABLE "_dup_users" AS
WITH last_session AS (
  SELECT "user_id", max("created_at") AS last_at
  FROM "sessions" GROUP BY "user_id"
),
ranked AS (
  SELECT u."id",
    lower(btrim(u."email")) AS norm,
    row_number() OVER (
      PARTITION BY lower(btrim(u."email"))
      ORDER BY ls.last_at DESC NULLS LAST, u."created_at" ASC, u."id" ASC
    ) AS rn
  FROM "users" u
  LEFT JOIN last_session ls ON ls."user_id" = u."id"
  WHERE lower(btrim(u."email")) IN (
    SELECT lower(btrim("email")) FROM "users" GROUP BY 1 HAVING count(*) > 1
  )
)
SELECT r."id" AS loser_id, c."id" AS canonical_id, r.norm
FROM ranked r
JOIN ranked c ON c.norm = r.norm AND c.rn = 1
WHERE r.rn > 1;--> statement-breakpoint

-- (c) audit trail — snapshot the full deleted row so a bad canonical
-- pick is forensically reconstructible
INSERT INTO "user_id_map" ("old_user_id", "merged_into_user_id", "reason", "snapshot")
SELECT d.loser_id, d.canonical_id, 'duplicate_email', to_jsonb(u.*)
FROM "_dup_users" d
JOIN "users" u ON u."id" = d.loser_id;--> statement-breakpoint

-- (d) re-point every FK'd and new-table reference before delete
UPDATE "sessions" s SET "user_id" = d.canonical_id
FROM "_dup_users" d WHERE s."user_id" = d.loser_id;--> statement-breakpoint
UPDATE "user_tokens" t SET "user_id" = d.canonical_id
FROM "_dup_users" d WHERE t."user_id" = d.loser_id;--> statement-breakpoint
UPDATE "views" v SET "owner_id" = d.canonical_id
FROM "_dup_users" d WHERE v."owner_id" = d.loser_id;--> statement-breakpoint
UPDATE "auth_identities" a SET "user_id" = d.canonical_id
FROM "_dup_users" d WHERE a."user_id" = d.loser_id;--> statement-breakpoint
UPDATE "oauth_codes" o SET "user_id" = d.canonical_id
FROM "_dup_users" d WHERE o."user_id" = d.loser_id;--> statement-breakpoint
UPDATE "invites" i SET "created_by" = d.canonical_id
FROM "_dup_users" d WHERE i."created_by" = d.loser_id;--> statement-breakpoint
UPDATE "invites" i SET "accepted_by" = d.canonical_id
FROM "_dup_users" d WHERE i."accepted_by" = d.loser_id;--> statement-breakpoint

-- workspace_members: merge loser memberships into canonical. Two-stage:
-- first collapse all loser rows per (workspace, canonical) to their best
-- role — multiple losers in the same workspace would otherwise propose
-- duplicate conflict targets in one command (21000). Then ON CONFLICT
-- keeps the higher role — a plain DO NOTHING could silently keep
-- canonical's 'member' row while discarding the loser's 'owner',
-- stripping a workspace's only owner
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "created_at")
SELECT src."workspace_id", src.canonical_id, src.best_role, src.earliest_at
FROM (
  SELECT m."workspace_id", d.canonical_id,
    CASE min(CASE m."role" WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END)
      WHEN 0 THEN 'owner' WHEN 1 THEN 'admin' ELSE 'member'
    END::"member_role" AS best_role,
    min(m."created_at") AS earliest_at
  FROM "workspace_members" m
  JOIN "_dup_users" d ON d.loser_id = m."user_id"
  GROUP BY m."workspace_id", d.canonical_id
) src
ON CONFLICT ("workspace_id", "user_id") DO UPDATE SET "role" =
  CASE
    WHEN "workspace_members"."role" = 'owner' OR EXCLUDED."role" = 'owner' THEN 'owner'
    WHEN "workspace_members"."role" = 'admin' OR EXCLUDED."role" = 'admin' THEN 'admin'
    ELSE 'member'
  END::"member_role";--> statement-breakpoint
DELETE FROM "workspace_members" m
USING "_dup_users" d WHERE m."user_id" = d.loser_id;--> statement-breakpoint

-- team_members: same collision-safe merge (no roles to preserve)
INSERT INTO "team_members" ("team_id", "user_id", "created_at")
SELECT t."team_id", d.canonical_id, t."created_at"
FROM "team_members" t
JOIN "_dup_users" d ON d.loser_id = t."user_id"
ON CONFLICT ("team_id", "user_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "team_members" t
USING "_dup_users" d WHERE t."user_id" = d.loser_id;--> statement-breakpoint

-- (e) actor columns re-point on user_id_map membership — NOT an actor-type
-- predicate: today's unvalidated x-actor-type path can forge agent-typed
-- rows carrying a users.id, and a type guard would leave them dangling
UPDATE "issues" i SET "creator_id" = d.canonical_id
FROM "_dup_users" d WHERE i."creator_id" = d.loser_id;--> statement-breakpoint
UPDATE "issues" i SET "assignee_id" = d.canonical_id
FROM "_dup_users" d WHERE i."assignee_id" = d.loser_id;--> statement-breakpoint
UPDATE "comments" c SET "actor_id" = d.canonical_id
FROM "_dup_users" d WHERE c."actor_id" = d.loser_id;--> statement-breakpoint
UPDATE "events" e SET "actor_id" = d.canonical_id
FROM "_dup_users" d WHERE e."actor_id" = d.loser_id;--> statement-breakpoint

-- (f) delete the merged rows — cascades have nothing left to kill
DELETE FROM "users" u USING "_dup_users" d WHERE u."id" = d.loser_id;--> statement-breakpoint
DROP TABLE "_dup_users";--> statement-breakpoint

ALTER TABLE "workspaces" ADD COLUMN "allowed_domains" text[];--> statement-breakpoint
-- (g) global normalized-email uniqueness — predicate matches the
-- lower(btrim(email)) lookup exactly
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower(btrim("email")));--> statement-breakpoint
-- (h) users is no longer workspace-scoped
ALTER TABLE "users" DROP COLUMN "workspace_id";