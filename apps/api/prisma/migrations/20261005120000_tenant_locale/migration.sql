-- Per-company locale settings (roadmap Phase 0, item 1).
--
-- Every India assumption that was a constant in code — rupees, IST, en-IN grouping, GST — becomes
-- a column here. The defaults are those same constants, so each existing company is backfilled to
-- exactly the behaviour it had, and onboarding without these fields still makes an Indian company.
--
-- `currency` is CHAR(3) and the code treats it as fixed once set: every money column is a count
-- of minor units, and the currency decides the exponent (two for INR and AED, three for KWD).
--
-- No RLS change: `tenants` policies are row-level and the new columns ride on them.
ALTER TABLE "tenants"
  ADD COLUMN "country"    CHAR(2) NOT NULL DEFAULT 'IN',
  ADD COLUMN "currency"   CHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN "timezone"   TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN "locale"     TEXT    NOT NULL DEFAULT 'en-IN',
  ADD COLUMN "tax_regime" TEXT    NOT NULL DEFAULT 'gst_in';

-- Cheap guards against a write that skipped the API's validation. The time zone and locale are
-- checked against Intl in the API; Postgres has no BCP 47 parser to repeat that here.
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "tenants_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "tenants_tax_regime_known"
    CHECK ("tax_regime" IN ('gst_in', 'vat_ae', 'vat_sa', 'none'));
