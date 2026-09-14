-- A ribbon on a plan card: "Best value", "Most popular", "Premium".
-- Nullable and free text: which term a builder should be pushed towards is a commercial
-- decision that changes with the season, and an enum of labels would need a migration to
-- say something new.
ALTER TABLE "plans" ADD COLUMN "badge" TEXT;

-- Two to start with, on the terms most builders should be pushed towards. An operator can clear or
-- change either from the console; this is a default, not a rule.
UPDATE "plans" SET "badge" = 'Best value' WHERE "code" = 'one_year';
UPDATE "plans" SET "badge" = 'Premium'    WHERE "code" = 'lifetime';
