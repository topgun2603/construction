-- Order site media by hand, and drop the separate cover flag.
--
-- The previous migration gave a photo an `is_cover` flag so somebody could choose what leads the
-- card. Adding drag-to-reorder makes that flag a second opinion about the same question: drag a
-- photo to the front of the gallery and the flag would still send a different one to the card. Two
-- mechanisms deciding one thing is how a UI starts lying.
--
-- So there is one concept now: position. The gallery shows them in that order and the card leads
-- with the first photo in it. "Make this the main image" is just "move it to the front", which is
-- also what dragging it there does.

ALTER TABLE "project_media" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- The order people are already looking at, preserved: chosen cover first, then newest.
--
-- FORCE is lifted for the backfill. Migrations run as `sitebook_app`, which owns the table and is
-- NOBYPASSRLS, and the table is FORCE ROW LEVEL SECURITY — with no `app.tenant_id` set the policy
-- matches nothing, so the UPDATE would silently touch zero rows. ENABLE stays on throughout, and
-- Prisma runs this file in a transaction, so a failure anywhere puts FORCE back.
ALTER TABLE "project_media" NO FORCE ROW LEVEL SECURITY;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY "is_cover" DESC, "taken_at" DESC NULLS LAST, "created_at" DESC
    ) - 1 AS rank
  FROM "project_media"
  WHERE "deleted_at" IS NULL
)
UPDATE "project_media" m
SET "position" = ranked.rank
FROM ranked
WHERE m.id = ranked.id;

ALTER TABLE "project_media" FORCE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS "project_media_one_cover_per_project";
ALTER TABLE "project_media" DROP COLUMN "is_cover";

-- Positions are not unique: a reorder rewrites a whole site's rows, and a uniqueness constraint
-- would fail halfway through unless every intermediate state also happened to be valid. Ties break
-- on `created_at`, so the order is total even when two rows share a position.
CREATE INDEX "project_media_project_id_position_idx" ON "project_media"("project_id", "position");
