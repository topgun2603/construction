-- A Google address an operator may also sign in to the console with.
--
-- An alternative key to an existing operator, not a second kind of operator. A sign-in by address
-- is resolved to this row's `phone` before any token is issued, so `platform_audit_log.actor_phone`
-- keeps meaning what it always meant and an SMS login and a Google login by the same person are
-- the same entry in it.
--
-- `platform_operators` has no tenant_id and no RLS — it is read before any tenant context exists,
-- by the BYPASSRLS connection the console uses. Nothing to add here for that; noted so the next
-- person does not go looking for the policy that is deliberately absent.
ALTER TABLE "platform_operators" ADD COLUMN "email" TEXT;

-- Plain unique, not partial. Postgres treats NULLs as distinct in a unique index, so the many
-- operators who never link an address do not collide with each other — the partial index the
-- `users.email` migration needed was for its *composite* with tenant_id, which this has no
-- equivalent of.
CREATE UNIQUE INDEX "platform_operators_email_key" ON "platform_operators" ("email");
