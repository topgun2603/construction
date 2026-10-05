-- Safety (HSE), roadmap Phase 2, module 8: incidents and near misses with their people, root cause
-- and corrective actions; permits to work with their crew and two signatures; toolbox talks with
-- the workers who attended; safety observations; and the photos that are the evidence for all of
-- it. RLS in the same migration as the tables (spec §17).
--
-- Every name is prefixed `safety_`: QA/QC keeps checklists and observations of its own.

-- CreateEnum
CREATE TYPE "safety_incident_type" AS ENUM ('near_miss', 'first_aid', 'medical_treatment', 'lost_time_injury', 'fatality', 'property_damage', 'environmental');

-- CreateEnum
CREATE TYPE "safety_severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "safety_incident_status" AS ENUM ('reported', 'investigating', 'actions_open', 'closed');

-- CreateEnum
CREATE TYPE "safety_person_role" AS ENUM ('injured', 'involved', 'witness');

-- CreateEnum
CREATE TYPE "safety_action_kind" AS ENUM ('corrective', 'preventive');

-- CreateEnum
CREATE TYPE "safety_action_status" AS ENUM ('open', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "safety_permit_type" AS ENUM ('hot_work', 'work_at_height', 'confined_space', 'excavation', 'electrical_isolation', 'lifting');

-- CreateEnum
CREATE TYPE "safety_permit_status" AS ENUM ('requested', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "safety_observation_type" AS ENUM ('unsafe_act', 'unsafe_condition', 'positive');

-- CreateEnum
CREATE TYPE "safety_observation_status" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "safety_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "type" "safety_incident_type" NOT NULL,
    "severity" "safety_severity" NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "immediate_action" TEXT,
    "root_cause_whys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "root_cause" TEXT,
    "lost_days" INTEGER,
    "status" "safety_incident_status" NOT NULL DEFAULT 'reported',
    "reported_by" UUID NOT NULL,
    "investigated_by" UUID,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "closure_note" TEXT,
    "serious_notified_at" TIMESTAMPTZ(6),
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_incident_people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "worker_id" UUID,
    "name" TEXT NOT NULL,
    "role" "safety_person_role" NOT NULL DEFAULT 'involved',
    "body_part" TEXT,
    "injury_nature" TEXT,
    "statement" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_incident_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "incident_id" UUID,
    "observation_id" UUID,
    "kind" "safety_action_kind" NOT NULL DEFAULT 'corrective',
    "description" TEXT NOT NULL,
    "assignee_id" UUID,
    "due_on" DATE,
    "status" "safety_action_status" NOT NULL DEFAULT 'open',
    "raised_on" DATE NOT NULL,
    "raised_by" UUID NOT NULL,
    "done_by" UUID,
    "done_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_permits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "safety_permit_type" NOT NULL,
    "description" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "precautions" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6) NOT NULL,
    "status" "safety_permit_status" NOT NULL DEFAULT 'requested',
    "requested_by" UUID NOT NULL,
    "issuer_id" UUID,
    "issued_at" TIMESTAMPTZ(6),
    "area_authority_id" UUID,
    "area_authority_at" TIMESTAMPTZ(6),
    "suspended_reason" TEXT,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "close_note" TEXT,
    "expiry_alerted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_permit_crew" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "permit_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_permit_crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_toolbox_talks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "talk_date" DATE NOT NULL,
    "topic_key" TEXT,
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "presenter_id" UUID NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_toolbox_talks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_toolbox_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "talk_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_toolbox_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "observed_on" DATE NOT NULL,
    "type" "safety_observation_type" NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "safety_severity" NOT NULL DEFAULT 'medium',
    "description" TEXT NOT NULL,
    "location" TEXT,
    "transcript" TEXT,
    "suggested_by" TEXT,
    "status" "safety_observation_status" NOT NULL DEFAULT 'open',
    "reported_by" UUID NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "close_note" TEXT,
    "client_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "incident_id" UUID,
    "observation_id" UUID,
    "permit_id" UUID,
    "toolbox_talk_id" UUID,
    "purpose" TEXT NOT NULL DEFAULT 'evidence',
    "s3_key" TEXT NOT NULL,
    "caption" TEXT,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_incidents_tenant_id_project_id_occurred_on_idx" ON "safety_incidents"("tenant_id", "project_id", "occurred_on");

-- CreateIndex
CREATE INDEX "safety_incidents_tenant_id_status_idx" ON "safety_incidents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "safety_incidents_tenant_id_number_key" ON "safety_incidents"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "safety_incidents_tenant_id_client_id_key" ON "safety_incidents"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "safety_incident_people_incident_id_idx" ON "safety_incident_people"("incident_id");

-- CreateIndex
CREATE INDEX "safety_incident_people_worker_id_idx" ON "safety_incident_people"("worker_id");

-- CreateIndex
CREATE INDEX "safety_incident_people_tenant_id_idx" ON "safety_incident_people"("tenant_id");

-- CreateIndex
CREATE INDEX "safety_actions_tenant_id_status_idx" ON "safety_actions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "safety_actions_incident_id_idx" ON "safety_actions"("incident_id");

-- CreateIndex
CREATE INDEX "safety_actions_observation_id_idx" ON "safety_actions"("observation_id");

-- CreateIndex
CREATE INDEX "safety_actions_project_id_idx" ON "safety_actions"("project_id");

-- CreateIndex
CREATE INDEX "safety_permits_tenant_id_project_id_status_idx" ON "safety_permits"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "safety_permits_tenant_id_status_valid_to_idx" ON "safety_permits"("tenant_id", "status", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "safety_permits_tenant_id_number_key" ON "safety_permits"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "safety_permit_crew_worker_id_idx" ON "safety_permit_crew"("worker_id");

-- CreateIndex
CREATE INDEX "safety_permit_crew_tenant_id_idx" ON "safety_permit_crew"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "safety_permit_crew_permit_id_worker_id_key" ON "safety_permit_crew"("permit_id", "worker_id");

-- CreateIndex
CREATE INDEX "safety_toolbox_talks_tenant_id_project_id_talk_date_idx" ON "safety_toolbox_talks"("tenant_id", "project_id", "talk_date");

-- CreateIndex
CREATE INDEX "safety_toolbox_attendees_worker_id_idx" ON "safety_toolbox_attendees"("worker_id");

-- CreateIndex
CREATE INDEX "safety_toolbox_attendees_tenant_id_idx" ON "safety_toolbox_attendees"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "safety_toolbox_attendees_talk_id_worker_id_key" ON "safety_toolbox_attendees"("talk_id", "worker_id");

-- CreateIndex
CREATE INDEX "safety_observations_tenant_id_project_id_observed_on_idx" ON "safety_observations"("tenant_id", "project_id", "observed_on");

-- CreateIndex
CREATE INDEX "safety_observations_tenant_id_status_idx" ON "safety_observations"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "safety_observations_tenant_id_number_key" ON "safety_observations"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "safety_observations_tenant_id_client_id_key" ON "safety_observations"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "safety_photos_incident_id_idx" ON "safety_photos"("incident_id");

-- CreateIndex
CREATE INDEX "safety_photos_observation_id_idx" ON "safety_photos"("observation_id");

-- CreateIndex
CREATE INDEX "safety_photos_permit_id_idx" ON "safety_photos"("permit_id");

-- CreateIndex
CREATE INDEX "safety_photos_toolbox_talk_id_idx" ON "safety_photos"("toolbox_talk_id");

-- CreateIndex
CREATE INDEX "safety_photos_tenant_id_idx" ON "safety_photos"("tenant_id");

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incident_people" ADD CONSTRAINT "safety_incident_people_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incident_people" ADD CONSTRAINT "safety_incident_people_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "safety_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incident_people" ADD CONSTRAINT "safety_incident_people_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_actions" ADD CONSTRAINT "safety_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_actions" ADD CONSTRAINT "safety_actions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_actions" ADD CONSTRAINT "safety_actions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "safety_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_actions" ADD CONSTRAINT "safety_actions_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "safety_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_permits" ADD CONSTRAINT "safety_permits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_permits" ADD CONSTRAINT "safety_permits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_permit_crew" ADD CONSTRAINT "safety_permit_crew_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_permit_crew" ADD CONSTRAINT "safety_permit_crew_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "safety_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_permit_crew" ADD CONSTRAINT "safety_permit_crew_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_toolbox_talks" ADD CONSTRAINT "safety_toolbox_talks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_toolbox_talks" ADD CONSTRAINT "safety_toolbox_talks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_toolbox_attendees" ADD CONSTRAINT "safety_toolbox_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_toolbox_attendees" ADD CONSTRAINT "safety_toolbox_attendees_talk_id_fkey" FOREIGN KEY ("talk_id") REFERENCES "safety_toolbox_talks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_toolbox_attendees" ADD CONSTRAINT "safety_toolbox_attendees_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_observations" ADD CONSTRAINT "safety_observations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_observations" ADD CONSTRAINT "safety_observations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "safety_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "safety_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "safety_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_photos" ADD CONSTRAINT "safety_photos_toolbox_talk_id_fkey" FOREIGN KEY ("toolbox_talk_id") REFERENCES "safety_toolbox_talks"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- --------------------------------------------------------------------------
-- What the service checks first, with the database as the backstop for a bug
-- --------------------------------------------------------------------------
ALTER TABLE "safety_incidents"
  ADD CONSTRAINT "safety_incidents_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "safety_incidents_lost_days_not_negative" CHECK ("lost_days" IS NULL OR "lost_days" >= 0),
  ADD CONSTRAINT "safety_incidents_whys_at_most_five" CHECK (cardinality("root_cause_whys") <= 5);

-- An action belongs to exactly one incident or one observation.
ALTER TABLE "safety_actions"
  ADD CONSTRAINT "safety_actions_one_parent" CHECK (num_nonnulls("incident_id", "observation_id") = 1);

-- A permit runs forwards, and never beyond the longest a single permit may (24 hours, see
-- SAFETY_PERMIT_MAX_HOURS): longer jobs are re-permitted shift by shift.
ALTER TABLE "safety_permits"
  ADD CONSTRAINT "safety_permits_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "safety_permits_window" CHECK (
    "valid_to" > "valid_from" AND "valid_to" <= "valid_from" + interval '24 hours'
  ),
  ADD CONSTRAINT "safety_permits_checklist_is_array" CHECK (jsonb_typeof("checklist") = 'array');

ALTER TABLE "safety_toolbox_talks"
  ADD CONSTRAINT "safety_toolbox_talks_duration_range" CHECK ("duration_minutes" BETWEEN 1 AND 240);

ALTER TABLE "safety_observations"
  ADD CONSTRAINT "safety_observations_number_positive" CHECK ("number" > 0);

-- A photo is attached to exactly one record.
ALTER TABLE "safety_photos"
  ADD CONSTRAINT "safety_photos_one_parent" CHECK (
    num_nonnulls("incident_id", "observation_id", "permit_id", "toolbox_talk_id") = 1
  ),
  ADD CONSTRAINT "safety_photos_purpose_known" CHECK (
    "purpose" IN ('evidence', 'witness_statement', 'closeout', 'attendance')
  );

-- --------------------------------------------------------------------------
-- Every new table is tenant data: the same isolation policy as the rest.
-- --------------------------------------------------------------------------
ALTER TABLE "safety_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_incidents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_incidents"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_incident_people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_incident_people" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_incident_people"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_actions"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_permits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_permits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_permits"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_permit_crew" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_permit_crew" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_permit_crew"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_toolbox_talks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_toolbox_talks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_toolbox_talks"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_toolbox_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_toolbox_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_toolbox_attendees"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_observations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_observations"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE "safety_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_photos"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The platform console's role reads and repairs tenant data across companies, as for every other
-- tenant table; skipped where that role does not exist (a developer's database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "safety_incidents",
      "safety_incident_people",
      "safety_actions",
      "safety_permits",
      "safety_permit_crew",
      "safety_toolbox_talks",
      "safety_toolbox_attendees",
      "safety_observations",
      "safety_photos"
    TO sitebook_admin;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- The new permissions on the built-in roles
-- --------------------------------------------------------------------------
--
-- System roles read their preset from code at request time, so this is the stored column catching
-- up rather than the source of truth. FORCE is lifted for the updates: migrations run as
-- `sitebook_app`, which is NOBYPASSRLS, and with no tenant context set the policy matches nothing.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

UPDATE "roles" SET permissions = permissions || ARRAY['safety.view', 'safety.report', 'safety.manage']
  WHERE is_system = true AND base_role IN ('owner', 'project_manager');

UPDATE "roles" SET permissions = permissions || ARRAY['safety.view', 'safety.report']
  WHERE is_system = true AND base_role = 'site_supervisor';

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
-- An incident report is the record an inspector, an insurer or a court reads; who changed the
-- root cause, who signed a permit and who closed an action all have to be on it.
SELECT audit_attach('safety_incidents');
SELECT audit_attach('safety_incident_people');
SELECT audit_attach('safety_actions');
SELECT audit_attach('safety_permits');
SELECT audit_attach('safety_permit_crew');
SELECT audit_attach('safety_toolbox_talks');
SELECT audit_attach('safety_toolbox_attendees');
SELECT audit_attach('safety_observations');
SELECT audit_attach('safety_photos');
