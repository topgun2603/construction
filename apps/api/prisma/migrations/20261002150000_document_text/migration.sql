-- Searchable text from the documents people upload.
--
-- A builder's drawing register is the one place in this product where the answer somebody needs is
-- already written down and still unreachable: it is on page 14 of a 60-page structural PDF that
-- nobody is going to scroll through on site. One row per readable chunk of one document makes that
-- page findable, and findable is the whole feature.
--
-- Separate from `documents` rather than a column on it. A 60-page drawing set is 60-odd rows, and
-- putting that text in the documents table would make every list query — the common one — drag a
-- megabyte of contract prose along with it.
CREATE TABLE "document_chunks" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID         NOT NULL,
  "document_id" UUID         NOT NULL,
  -- 1-based, as the PDF viewer counts them, so a citation can be followed by hand.
  "page"        INTEGER      NOT NULL,
  -- Which piece of that page, for pages long enough to split. Ordered within the page.
  "ordinal"     INTEGER      NOT NULL DEFAULT 0,
  "content"     TEXT         NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- CASCADE on the document: a deleted revision's text must go with it, or a question would be
-- answered from a drawing that was superseded for a reason.
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per piece, and re-reading a document replaces rather than duplicates.
CREATE UNIQUE INDEX "document_chunks_document_id_page_ordinal_key"
  ON "document_chunks"("document_id", "page", "ordinal");

/*
 * The search index.
 *
 * `english` rather than `simple`: the questions are English sentences, and stemming is what makes
 * "what are the slab thicknesses" match a drawing note reading "slab thickness 150mm". Drawing
 * codes and dimensions pass through the stemmer unchanged, so nothing is lost on the half of this
 * text that is not prose.
 *
 * An expression index rather than a stored tsvector column, so Prisma's view of this table stays a
 * plain one — the datamodel cannot express a generated column, and a drift check that fails every
 * time is a check people learn to ignore.
 */
CREATE INDEX "document_chunks_search_idx"
  ON "document_chunks" USING GIN (to_tsvector('english', "content"));

CREATE INDEX "document_chunks_tenant_id_document_id_idx"
  ON "document_chunks"("tenant_id", "document_id");

-- Tenancy, the same way as every other table here: the policy binds the owner too, so a query
-- without `app.tenant_id` set reads nothing rather than everything.
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_chunks" USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitebook_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "document_chunks" TO sitebook_admin;
  END IF;
END $$;

-- What has been read, and what went wrong trying.
--
-- On the document rather than in the chunk table, because the interesting state is "this drawing
-- has no text in it at all" — a scan, a photograph of a plan — and that is a document with zero
-- chunks, which is indistinguishable from one nobody has got to yet.
ALTER TABLE "documents" ADD COLUMN "text_extracted_at" TIMESTAMPTZ(6);
ALTER TABLE "documents" ADD COLUMN "text_pages" INTEGER;
