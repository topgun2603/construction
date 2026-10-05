import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './expenses';

/**
 * Reading a photographed bill into the fields an expense needs.
 *
 * The scan never saves anything. It returns a *draft* that pre-fills the form a person then
 * corrects and submits, which is the whole safety model: a model misreading ₹1,250 as ₹12.50 is a
 * typo somebody catches, not a wrong number in the ledger.
 */
export const scanBillSchema = z.object({
  /** A key already uploaded through `/uploads/presign`. The tenant prefix is what authorises it. */
  s3_key: z.string().min(1).max(512),
});
export type ScanBillInput = z.infer<typeof scanBillSchema>;

/**
 * What the model is asked for, and the only shape the API will pass on.
 *
 * Every field is nullable because a bill photographed in a site office at dusk may genuinely not
 * show a date, and a model that is made to answer always will invent one. Null means "you read
 * this yourself"; it is a better answer than a confident guess.
 */
export const billDraftSchema = z.object({
  /** Whole rupees as a decimal string, exactly as printed. Converted to paise by the server. */
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'an amount as it is printed on the bill')
    .nullable(),
  vendor: z.string().trim().max(120).nullable(),
  /**
   * The bill's date **exactly as printed** — "25/09/2026", "25 Sep 2026" — not an interpretation
   * of it.
   *
   * Asking for ISO got one wrong in the first week: an invoice printed 25/09/2026 came back as
   * 2026-08-25, which would have put the expense in the wrong month with nothing to show for it.
   * The model transcribes; `parseBillDate` decides what it means, in code with tests.
   */
  date_printed: z.string().trim().max(40).nullable(),
  category: z.enum(EXPENSE_CATEGORIES).nullable(),
  /**
   * The supplier's tax registration number in the company's regime — a GSTIN, a UAE TRN, a Saudi
   * VAT number — already checked against that regime's rule (`validTaxIdOrNull`).
   */
  tax_id: z
    .string()
    .trim()
    .regex(/^[0-9A-Z]{8,20}$/, 'a tax registration number is letters and digits')
    .nullable(),
  /** What was bought, in the bill's own words. Becomes the expense note. */
  summary: z.string().trim().max(300).nullable(),
});
export type BillDraft = z.infer<typeof billDraftSchema>;

/** What the endpoint returns: the draft in the units the form uses, plus what could not be read. */
export interface ScanBillResult {
  /** Amount in paise, as a string, like every other amount on the wire. Null if unreadable. */
  amount: string | null;
  vendor: string | null;
  spent_on: string | null;
  category: string | null;
  /** The supplier's tax number in the company's regime, checked. Null if unread or not valid. */
  tax_id: string | null;
  /** What that number is called — GSTIN, TRN, VAT number — for the form's label. */
  tax_id_label: string | null;
  /** `tax_id` for an Indian company, kept so clients built before `tax_id` keep working. */
  gstin: string | null;
  summary: string | null;
  /** Field names the scan could not fill, so the form can say so rather than look complete. */
  unread: string[];
}
