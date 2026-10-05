import { z } from 'zod';
import { BOQ_IMPORT_FIELDS, BOQ_ITEM_KINDS } from '../boq';
import { clientIdSchema, isoDateSchema, positivePaiseSchema, uuidSchema } from './common';
import { workQuantitySchema } from './subcontracts';

/**
 * Bill of quantities (roadmap Phase 2, module 5). Quantities travel as decimal strings with at most
 * three places, money as minor-unit strings, percentages as basis points — nothing on the wire is a
 * float.
 */

const bpSchema = (max: number) => z.number().int().min(0).max(max);

/** The BOQ's header: what it is called and the client's billing terms. */
export const boqTermsSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    /** Held back by the client from every bill: 5% is 500. At most 20%. */
    retention_bp: bpSchema(2000).optional(),
    /** Mobilisation advance the client paid, minor units. Won back from the bills. */
    advance_amount: positivePaiseSchema.optional(),
    advance_recovery_bp: bpSchema(10_000).optional(),
    /**
     * GST or VAT on each bill. Defaults to the regime's standard rate where it has one (5% in the
     * UAE); India's GST on works contracts depends on the work, so it must be given there.
     */
    tax_rate_bp: bpSchema(5000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type BoqTermsInput = z.infer<typeof boqTermsSchema>;

// --- import ---------------------------------------------------------------------------------------

/**
 * Base64 of the file. 1.4 MB of spreadsheet fits the API's 2 MB body; a priced BOQ of a few thousand
 * items is a fraction of that as .xlsx.
 */
export const BOQ_IMPORT_MAX_BYTES = 1_400_000;

const mappingSchema = z
  .object(
    Object.fromEntries(BOQ_IMPORT_FIELDS.map((field) => [field, z.number().int().min(0).max(199).optional()])) as Record<
      (typeof BOQ_IMPORT_FIELDS)[number],
      z.ZodOptional<z.ZodNumber>
    >,
  )
  .refine(
    (value) => {
      const columns = Object.values(value).filter((column) => column !== undefined);
      return new Set(columns).size === columns.length;
    },
    { message: 'two fields are mapped to the same column' },
  );

export const boqImportFileSchema = z.object({
  file_name: z
    .string()
    .trim()
    .max(200)
    .regex(/\.(xlsx|csv)$/i, 'upload an .xlsx or .csv file'),
  content_base64: z
    .string()
    .max(Math.ceil((BOQ_IMPORT_MAX_BYTES * 4) / 3) + 4, 'the file is too large to import in one go')
    .regex(/^[A-Za-z0-9+/=\s]*$/, 'expected base64'),
  /** Which worksheet of an .xlsx; the first when left out. */
  sheet: z.string().trim().max(100).optional(),
  /** 0-based row holding the headings, −1 for none. Found automatically when left out. */
  header_row: z.number().int().min(-1).max(200).optional(),
  /** Which column each field is in. Guessed from the headings when left out. */
  mapping: mappingSchema.optional(),
});
export type BoqImportFileInput = z.infer<typeof boqImportFileSchema>;

export const boqImportSchema = boqImportFileSchema.extend({
  /**
   * `replace` swaps the whole BOQ (refused once anything is measured or billed against it);
   * `append` adds the sheet's items to what is there.
   */
  mode: z.enum(['replace', 'append']).default('replace'),
});
export type BoqImportInput = z.infer<typeof boqImportSchema>;

// --- items ----------------------------------------------------------------------------------------

const positiveQuantity = workQuantitySchema.refine((value) => Number.parseFloat(value) > 0, 'quantity must be more than zero');

export const createBoqItemSchema = z
  .object({
    kind: z.enum(BOQ_ITEM_KINDS).default('item'),
    item_no: z.string().trim().min(1).max(30),
    description: z.string().trim().min(1).max(1000),
    /** The section it sits under; top level when left out. */
    parent_id: uuidSchema.nullable().optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantity: positiveQuantity.optional(),
    /** Minor units per unit. */
    rate: positivePaiseSchema.optional(),
    cost_code_id: uuidSchema.nullable().optional(),
  })
  .refine((value) => value.kind === 'section' || (value.unit && value.quantity && value.rate !== undefined), {
    message: 'an item needs a unit, a quantity and a rate',
    path: ['quantity'],
  });
export type CreateBoqItemInput = z.infer<typeof createBoqItemSchema>;

export const updateBoqItemSchema = z
  .object({
    item_no: z.string().trim().min(1).max(30).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantity: positiveQuantity.optional(),
    rate: positivePaiseSchema.optional(),
    cost_code_id: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateBoqItemInput = z.infer<typeof updateBoqItemSchema>;

export const boqAutoMapSchema = z.object({
  /** False only proposes; true writes the proposals. */
  apply: z.boolean().default(false),
  /** Re-map items that already have a code. */
  overwrite: z.boolean().default(false),
});
export type BoqAutoMapInput = z.infer<typeof boqAutoMapSchema>;

// --- measurement ----------------------------------------------------------------------------------

export const boqMeasurementSchema = z
  .object({
    measured_on: isoDateSchema,
    /** Where on site: "Block B, 2nd floor slab, grid C–D". */
    location: z.string().trim().max(300).optional(),
    /** Nos. — and the multiplier on any dimensions. */
    count: positiveQuantity.optional(),
    length: positiveQuantity.optional(),
    breadth: positiveQuantity.optional(),
    height: positiveQuantity.optional(),
    /** An opening or a part measured twice: taken off rather than added. */
    deduction: z.boolean().default(false),
    note: z.string().trim().max(1000).optional(),
    /** Keys from `/uploads/presign`, in this company's storage. */
    photo_keys: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
    client_id: clientIdSchema.optional(),
  })
  .refine((value) => value.count || value.length || value.breadth || value.height, {
    message: 'give a number or at least one dimension',
    path: ['count'],
  });
export type BoqMeasurementInput = z.infer<typeof boqMeasurementSchema>;

// --- client bills ---------------------------------------------------------------------------------

const billQuantity = z.object({
  item_id: uuidSchema,
  /** To date — cumulative, not this period's. */
  quantity_to_date: workQuantitySchema,
});

export const createBoqBillSchema = z
  .object({
    period_from: isoDateSchema.optional(),
    period_to: isoDateSchema,
    bill_date: isoDateSchema.optional(),
    /** Items left out are claimed at what is measured to date. */
    lines: z.array(billQuantity).max(5000).default([]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => !value.period_from || value.period_from <= value.period_to, {
    message: 'the period cannot end before it starts',
    path: ['period_to'],
  });
export type CreateBoqBillInput = z.infer<typeof createBoqBillSchema>;

export const updateBoqBillSchema = z
  .object({
    period_from: isoDateSchema.nullable().optional(),
    period_to: isoDateSchema.optional(),
    bill_date: isoDateSchema.optional(),
    lines: z.array(billQuantity).max(5000).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateBoqBillInput = z.infer<typeof updateBoqBillSchema>;

export const certifyBoqBillSchema = z.object({
  /** What the client certified to date per item; an item left out is certified as claimed. */
  lines: z
    .array(z.object({ item_id: uuidSchema, certified_quantity_to_date: workQuantitySchema }))
    .max(5000)
    .default([]),
  /** The client's certificate number or the engineer's remark. */
  note: z.string().trim().max(1000).optional(),
});
export type CertifyBoqBillInput = z.infer<typeof certifyBoqBillSchema>;

export const returnBoqBillSchema = z.object({ note: z.string().trim().min(1).max(1000) });
export type ReturnBoqBillInput = z.infer<typeof returnBoqBillSchema>;

export const invoiceBoqBillSchema = z.object({
  /** When the client should pay; the instalment shows overdue after it. */
  due_date: isoDateSchema.optional(),
});
export type InvoiceBoqBillInput = z.infer<typeof invoiceBoqBillSchema>;

export const boqExportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  /** The full item list, or the abstract by section. */
  report: z.enum(['items', 'abstract']).default('items'),
});
export type BoqExportQuery = z.infer<typeof boqExportQuerySchema>;
