-- Let somebody choose which photograph leads a site's card.
--
-- Without this the card showed whichever photo was newest, which is rarely the best one: the most
-- recent picture of a site is usually a close-up of whatever went wrong that morning, not the
-- elevation you would want a client to see.

ALTER TABLE "project_media" ADD COLUMN "is_cover" BOOLEAN NOT NULL DEFAULT false;

-- At most one cover per site, enforced by the database rather than by remembering to clear the old
-- one. A partial index is the right shape here: it constrains the rows that claim to be the cover and
-- says nothing about the many that do not.
CREATE UNIQUE INDEX "project_media_one_cover_per_project"
  ON "project_media"("project_id")
  WHERE "is_cover" = true AND "deleted_at" IS NULL;
