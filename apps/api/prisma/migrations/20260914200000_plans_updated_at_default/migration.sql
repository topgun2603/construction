-- Drop the stray `now()` default on `plans.updated_at`.
--
-- `@updatedAt` is a Prisma-side rule: the client sets the column on every write. The column itself
-- has no default in the datamodel, so a DEFAULT in the database is drift — the same one already
-- fixed on `payment_stages`, written the same way here. Inserts all come through Prisma, which
-- always supplies the value, so nothing depends on the default being there.
ALTER TABLE "plans" ALTER COLUMN "updated_at" DROP DEFAULT;
