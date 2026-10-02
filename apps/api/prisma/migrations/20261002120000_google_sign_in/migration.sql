-- A second way to reach the same person: their work email.
--
-- Sign-in has been a phone number and an SMS code since the beginning, which is right for a
-- supervisor standing on a slab. It is tedious for an owner at a desk, who has a Google account
-- already signed in and no wish to wait for an SMS. Google proves an email, never a phone — so an
-- email has to resolve to a user for that sign-in to land anywhere.
--
-- Nullable, and nobody is required to have one. The phone stays the primary identity: it is what
-- `users.phone` holds, what WhatsApp needs, and what a worker is known by.
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "auth_identities" ADD COLUMN "email" TEXT;

-- Unique per tenant, like the phone. Two builders may each employ a Rajesh with a Gmail address,
-- and one of them changing jobs must not collide with the other.
CREATE UNIQUE INDEX "users_email_tenant_id_key" ON "users" ("email", "tenant_id")
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "auth_identities_email_tenant_id_key"
  ON "auth_identities" ("email", "tenant_id") WHERE "email" IS NOT NULL;
CREATE INDEX "auth_identities_email_idx" ON "auth_identities" ("email")
  WHERE "email" IS NOT NULL;

-- The trigger carries it across, exactly as it does the phone. Application code never writes
-- `auth_identities` — it is the directory the login path reads before any tenant is known, and
-- having one writer is what keeps it true.
CREATE OR REPLACE FUNCTION sync_auth_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM auth_identities WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  -- A soft-deleted or disabled user must not resolve to a tenant at login.
  IF (NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM auth_identities WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO auth_identities (user_id, tenant_id, phone, email)
  VALUES (NEW.id, NEW.tenant_id, NEW.phone, NEW.email)
  ON CONFLICT (user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, phone = EXCLUDED.phone, email = EXCLUDED.email;

  RETURN NEW;
END $$;

-- `email` joins the columns that re-fire it; without this a user who adds an address keeps an
-- identity row that does not know about it, and their Google sign-in resolves to nobody.
DROP TRIGGER IF EXISTS users_sync_auth_identity ON "users";
CREATE TRIGGER users_sync_auth_identity
AFTER INSERT OR UPDATE OF phone, email, tenant_id, deleted_at OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION sync_auth_identity();

-- Existing rows have no email, so there is nothing to backfill, but the identities must be
-- re-synced for the column to exist on them as NULL rather than be absent from the insert path.
