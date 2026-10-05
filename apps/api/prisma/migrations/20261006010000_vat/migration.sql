-- VAT on expenses and on client instalments (roadmap Phase 1, item 5).
--
-- An expense's `amount` stays what left the bank; `tax_amount` is the part of it that was VAT or
-- GST, and so reclaimable as input tax. An instalment's `tax_amount` is charged on top of its
-- `amount`, so the client owes the two together. Every existing row is zero: nothing recorded
-- before this had its tax split out, and inventing one would misstate the return.
ALTER TABLE "expenses"
  ADD COLUMN "tax_amount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "supplier_tax_id" TEXT,
  ADD CONSTRAINT "expenses_tax_within_amount" CHECK ("tax_amount" >= 0 AND "tax_amount" <= "amount");

ALTER TABLE "payment_stages"
  ADD COLUMN "tax_amount" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "payment_stages_tax_not_negative" CHECK ("tax_amount" >= 0);
