-- Record whether a wage period was drafted by the scheduler or created by a person.
--
-- The nightly `wage-period-draft` job creates periods unattended. Without this column an
-- owner opening a sheet they do not remember asking for has no way to tell it was drafted
-- for them — which reads as somebody else having been in their account.
--
-- Existing rows default to 'manual', which is true: nothing had been drafted automatically
-- before this column existed.

CREATE TYPE "wage_period_source" AS ENUM ('manual', 'scheduled');

ALTER TABLE "wage_periods"
  ADD COLUMN "source" "wage_period_source" NOT NULL DEFAULT 'manual';
