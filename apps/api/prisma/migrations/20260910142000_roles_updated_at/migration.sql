-- Drop the database default on roles.updated_at.
--
-- Prisma's `@updatedAt` is maintained by the client, and no other table in this schema
-- carries a default for it. Leaving one here put the schema and the database permanently
-- out of step, which makes `prisma migrate diff` useless as a drift check — and that check
-- is the only thing standing between a hand-written migration and a silent mismatch.
ALTER TABLE "roles" ALTER COLUMN "updated_at" DROP DEFAULT;
