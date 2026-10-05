-- Full audit log (roadmap Phase 3, security): every create, update and delete on tenant data.
--
-- WHY TRIGGERS, NOT A PRISMA EXTENSION
--
-- A Prisma query extension sees `updateMany`/`deleteMany` as a filter, not as rows, so it would
-- have to re-read every affected row before and after to produce a diff — doubling every bulk
-- write, and still missing `$executeRaw`, nested writes, ON DELETE cascades, the platform console's
-- separate client and anything a future service does by hand. A row trigger sees exactly the rows
-- that changed, OLD and NEW, in the same transaction, from every client — it cannot be forgotten
-- and cannot be bypassed short of dropping it, which takes a migration.
--
-- The one thing a trigger cannot know is *who* is acting. `TenantDb` already sets `app.tenant_id`
-- per transaction for RLS; it now sets `app.actor_id`, `app.request_id`, `app.client_ip` and
-- `app.user_agent` in the same statement (no extra round trip), read here by `audit_fill_context`.
-- No actor means a scheduled job or webhook (`system`), or — with no tenant context at all — the
-- BYPASSRLS console (`platform`).
--
-- TO AUDIT A NEW TABLE, its migration adds one line:
--
--     SELECT audit_attach('my_table');
--     SELECT audit_attach('my_table', 'noisy_column', 'other_column');  -- columns not worth a row
--
-- The table needs a `tenant_id` column (and, to link entries to the row, a uuid `id`).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- An audit row must keep naming its actor after that user is removed, and must never be rewritten
-- by ON DELETE SET NULL — so the actor is a plain uuid, resolved to a name when read.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";

ALTER TABLE "audit_logs" ADD COLUMN     "actor_type" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "entity_label" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "user_agent" TEXT;

CREATE INDEX "audit_logs_tenant_id_actor_id_created_at_idx" ON "audit_logs"("tenant_id", "actor_id", "created_at");

-- History written before this migration: every hand-written entry with an actor was a person.
-- The table forces RLS even on its owner, so the backfill has to lift that for a moment (the same
-- dance as 20260910141000_seed_system_roles).
ALTER TABLE "audit_logs" NO FORCE ROW LEVEL SECURITY;
UPDATE "audit_logs" SET "actor_type" = 'user' WHERE "actor_id" IS NOT NULL;
-- The one hand-written entity that was not named after its table; the log filters by table name.
UPDATE "audit_logs" SET "entity" = 'worker_documents' WHERE "entity" = 'worker_document';
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Who, from where — for every insert, whichever writer made it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_fill_context() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The wall clock, not the transaction's start: a wage period finalised in one transaction writes
  -- dozens of rows, and the log has to list them in the order they happened.
  NEW.created_at := clock_timestamp();
  NEW.actor_id   := coalesce(NEW.actor_id, nullif(current_setting('app.actor_id', true), '')::uuid);
  NEW.request_id := coalesce(NEW.request_id, nullif(current_setting('app.request_id', true), ''));
  NEW.ip         := coalesce(NEW.ip, nullif(current_setting('app.client_ip', true), ''));
  NEW.user_agent := coalesce(NEW.user_agent, nullif(current_setting('app.user_agent', true), ''));
  -- Otherwise whatever the writer said: `audit_row_change` passes `platform` when the change came
  -- from a connection with no tenant context (the console), and a service's hand-written entry
  -- without an actor keeps the column default, `system` — a job or a webhook.
  IF NEW.actor_id IS NOT NULL THEN
    NEW.actor_type := 'user';
  ELSIF current_tenant_id() IS NULL THEN
    NEW.actor_type := 'platform';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_fill_context BEFORE INSERT ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION audit_fill_context();

-- Append-only. The only deletes allowed are the cascade from removing the whole company, which
-- arrives from the foreign key's own trigger (depth > 1); a direct UPDATE or DELETE is refused even
-- for the table's owner, so no query in the app — buggy or otherwise — can edit history. (The owner
-- could still drop the trigger; that takes DDL, which the running app never issues.)
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- ---------------------------------------------------------------------------
-- Redaction
-- ---------------------------------------------------------------------------

-- By column name, so a secret column added later is hidden without anybody remembering to list
-- it: refresh-token hashes, FCM push tokens, the encrypted document numbers, and anything that
-- looks like a password or one-time-code secret. The log still records *that* it changed.
CREATE OR REPLACE FUNCTION audit_is_secret(column_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT column_name ~* '(token|secret|password|passcode|cipher|hash|api_key|private_key|(^|_)t?otp(_|$))'
$$;

CREATE OR REPLACE FUNCTION audit_redact(row_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    jsonb_object_agg(
      key,
      CASE WHEN audit_is_secret(key) AND value <> 'null'::jsonb THEN '"[redacted]"'::jsonb ELSE value END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(row_data)
$$;

-- ---------------------------------------------------------------------------
-- The row trigger
-- ---------------------------------------------------------------------------

-- Trigger arguments name columns whose changes alone are not worth an entry (a login timestamp,
-- a background job's bookkeeping). They are left out of snapshots and diffs alike.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row     jsonb := coalesce(v_new, v_old);
  -- Never interesting in a diff: the tenant cannot change, and the timestamps are the entry's own.
  v_skip    text[] := ARRAY['tenant_id', 'created_at', 'updated_at'] || TG_ARGV;
  v_tenant  uuid := coalesce(v_row ->> 'tenant_id', CASE WHEN TG_TABLE_NAME = 'tenants' THEN v_row ->> 'id' END)::uuid;
  v_prior   text := current_setting('app.tenant_id', true);
  v_action  text := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[] := '{}';
BEGIN
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_after := audit_redact(jsonb_strip_nulls(v_new - v_skip));
  ELSIF TG_OP = 'DELETE' THEN
    v_before := audit_redact(jsonb_strip_nulls(v_old - v_skip));
  ELSE
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}'),
           jsonb_object_agg(n.key, o.value),
           jsonb_object_agg(n.key, n.value)
      INTO v_changed, v_before, v_after
      FROM jsonb_each(v_new) n
      JOIN jsonb_each(v_old) o ON o.key = n.key
     WHERE n.value IS DISTINCT FROM o.value
       AND NOT (n.key = ANY (v_skip));
    -- Saved unchanged, or only a skipped column moved: nothing anybody needs to read.
    IF cardinality(v_changed) = 0 THEN
      RETURN NULL;
    END IF;
    v_before := audit_redact(v_before);
    v_after := audit_redact(v_after);
    -- Most deletes here are soft. Reading as a delete is what the person looking for one expects.
    IF (v_old ->> 'deleted_at') IS NULL AND (v_new ->> 'deleted_at') IS NOT NULL THEN
      v_action := 'delete';
    END IF;
  END IF;

  /*
   * The audit row is written under the changed row's own tenant.
   *
   * In a request that is already the context. A migration's backfill or the BYPASSRLS console has
   * none, and `audit_logs` forces RLS even on its owner — so the context is set for the one insert
   * and put back, rather than a backfill failing because nobody could write its history. It is
   * never a widening: the writer was already allowed to change this tenant's row.
   */
  IF v_prior IS DISTINCT FROM v_tenant::text THEN
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
  END IF;

  -- A row going because its whole company is: the tenant row is already gone, and its log with it.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant) THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prior, ''), true);
    RETURN NULL;
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_type, action, entity, entity_id, entity_label, changed_fields, before, after)
  VALUES (
    v_tenant,
    -- The console's connection never sets a tenant; a request or a tenant's own job always does.
    CASE WHEN nullif(v_prior, '') IS NULL THEN 'platform' ELSE 'system' END,
    v_action,
    TG_TABLE_NAME,
    CASE WHEN (v_row ->> 'id') ~* '^[0-9a-f-]{36}$' THEN (v_row ->> 'id')::uuid END,
    left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'label', v_row ->> 'activity',
                  v_row ->> 'filename', v_row ->> 'caption', v_row ->> 'category'), 200),
    v_changed,
    v_before,
    v_after
  );

  IF v_prior IS DISTINCT FROM v_tenant::text THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prior, ''), true);
  END IF;
  RETURN NULL;
END $$;

-- The one-liner a migration uses to put a table under audit. Idempotent, so re-attaching with a
-- different list of skipped columns just replaces the trigger.
CREATE OR REPLACE FUNCTION audit_attach(target regclass, VARIADIC skip_columns text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS audit_trail ON %s', target);
  EXECUTE format(
    'CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION audit_row_change(%s)',
    target,
    coalesce((SELECT string_agg(quote_literal(c), ', ') FROM unnest(skip_columns) AS c), '')
  );
END $$;

CREATE OR REPLACE FUNCTION audit_detach(target regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS audit_trail ON %s', target);
END $$;

-- ---------------------------------------------------------------------------
-- What is audited
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT audited:
--   audit_logs               itself.
--   notifications            a per-user inbox the app writes on every event and marks read on
--                            every open; the event that caused it is already logged.
--   sync_log                 already an append-only log of what each device pushed.
--   refresh_tokens           sessions: rotated on every refresh, and nothing in them is readable.
--   auth_identities          a trigger-maintained mirror of `users`, with no tenant RLS.
--   site_message_reads       read receipts, rewritten every time somebody opens a conversation.
--   document_chunks          text derived from a document and rebuilt wholesale; the document
--                            itself is audited.
--   site_forecasts           recomputed by the nightly job from data that is itself audited.
--   billing_identities, stripe_identities, webhook_events, plans, platform_*
--                            not tenant data (the console has `platform_audit_log`).

SELECT audit_attach('tenants');
SELECT audit_attach('roles');
-- Every sign-in moves `last_login`, and every device registration `fcm_tokens`.
SELECT audit_attach('users', 'last_login', 'fcm_tokens');
SELECT audit_attach('projects');
SELECT audit_attach('project_members');
SELECT audit_attach('milestones');
SELECT audit_attach('contractors');
SELECT audit_attach('workers');
SELECT audit_attach('worker_projects');
-- `reminded_at` is the expiry job's own bookkeeping.
SELECT audit_attach('worker_documents', 'reminded_at');
SELECT audit_attach('camps');
SELECT audit_attach('daily_reports');
SELECT audit_attach('dpr_activities');
SELECT audit_attach('dpr_photos');
SELECT audit_attach('dpr_manpower');
SELECT audit_attach('attendance');
SELECT audit_attach('wage_periods');
SELECT audit_attach('wage_lines');
SELECT audit_attach('labour_payments');
SELECT audit_attach('materials');
SELECT audit_attach('material_indents');
SELECT audit_attach('indent_items');
SELECT audit_attach('material_estimates');
SELECT audit_attach('stock_movements');
SELECT audit_attach('expenses');
SELECT audit_attach('project_media');
SELECT audit_attach('site_messages');
SELECT audit_attach('site_message_attachments');
-- Text extraction is a background job's work on the file, not a change anybody made.
SELECT audit_attach('documents', 'text_pages', 'text_extracted_at');
SELECT audit_attach('payment_stages');
SELECT audit_attach('client_payments');
SELECT audit_attach('approvals');
SELECT audit_attach('site_checks');
SELECT audit_attach('subscriptions');
SELECT audit_attach('invoices');
