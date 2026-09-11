-- A message to one person.
--
-- The two broadcast audiences answer "everyone on this job" and "the team". Neither answers the
-- most ordinary thing anybody does on a site: asking one named person something. Without it those
-- conversations go back to WhatsApp, taking the record with them — which is the whole failure this
-- feature exists to stop.
--
-- Direct is not a third kind of privacy setting bolted onto the same broadcast. A direct message is
-- visible to exactly two people, its author and its recipient, and that is enforced on every read
-- rather than by who happens to be looking.

-- Postgres 16 allows this inside the migration's transaction; what it forbids is *using* the new
-- label in the same transaction, which is why the constraint below compares text rather than the
-- enum literal.
ALTER TYPE "message_audience" ADD VALUE IF NOT EXISTS 'direct';

ALTER TABLE "site_messages" ADD COLUMN "recipient_id" UUID;

ALTER TABLE "site_messages" ADD CONSTRAINT "site_messages_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Both halves, as one equivalence: a direct message always names somebody, and a message that
-- names somebody is always direct. Either half alone leaves a row whose audience and recipient
-- disagree, and the read filter would then have to guess which one to believe.
ALTER TABLE "site_messages" ADD CONSTRAINT "site_messages_direct_names_one_person"
  CHECK ((audience::text = 'direct') = ("recipient_id" IS NOT NULL));

CREATE INDEX "site_messages_recipient_id_created_at_idx"
  ON "site_messages"("recipient_id", "created_at" DESC);
