import { z } from 'zod';
import {
  PURCHASE_INVOICE_STATUSES,
  PURCHASE_ORDER_STATUSES,
  RFQ_STATUSES,
} from '../procurement';
import { isoDateSchema, phoneSchema, positivePaiseSchema, uuidSchema } from './common';

/**
 * Procurement (roadmap Phase 2, module 2): suppliers, requests for quotation, purchase orders,
 * goods received against them, and the supplier's invoice matched to both.
 */

/** A quantity on the wire: a string with at most three decimals, more than zero. */
export const procurementQuantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d{1,11}(?:\.\d{1,3})?$/, 'expected a quantity with at most three decimals')
      .refine((value) => Number.parseFloat(value) > 0, 'quantity must be more than zero'),
  );

/** Basis points: 500 is 5%. Up to 100%, which no real tax reaches. */
export const taxRateBpSchema = z.coerce.number().int().min(0).max(10_000);

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// --- suppliers ---------------------------------------------------------------------------------

export const createVendorSchema = z.object({
  name: text(160),
  contact_name: optionalText(120),
  phone: phoneSchema.nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  address: optionalText(500),
  /** Checked against the company's tax regime: a GSTIN in India, a TRN in the UAE. */
  tax_id: z.string().trim().max(30).nullable().optional(),
  /** Days after the invoice the supplier expects to be paid. Null when nobody agreed any. */
  payment_terms_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  notes: optionalText(1000),
  active: z.boolean().optional(),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema
  .partial()
  .extend({ name: text(160).optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const listVendorsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** `true` for the active ones only (the picker), omitted for all. */
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

// --- requests for quotation --------------------------------------------------------------------

const rfqItemSchema = z.object({
  material_id: uuidSchema.nullable().optional(),
  /** Defaults to the material's name. Required when there is no material. */
  description: z.string().trim().max(300).optional(),
  unit: z.string().trim().max(20).optional(),
  quantity: procurementQuantitySchema,
  cost_code_id: uuidSchema.nullable().optional(),
});

export const createRfqSchema = z
  .object({
    project_id: uuidSchema,
    title: text(160),
    notes: optionalText(2000),
    required_by: isoDateSchema.nullable().optional(),
    /** Start from an approved material indent: its lines become the items unless items are given. */
    indent_id: uuidSchema.optional(),
    items: z.array(rfqItemSchema).max(200).optional(),
  })
  .refine((value) => value.indent_id || (value.items && value.items.length > 0), {
    message: 'give the items to quote for, or the indent to take them from',
    path: ['items'],
  });
export type CreateRfqInput = z.infer<typeof createRfqSchema>;

export const listRfqsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(RFQ_STATUSES).optional(),
});
export type ListRfqsQuery = z.infer<typeof listRfqsQuerySchema>;

export const upsertQuoteSchema = z.object({
  vendor_id: uuidSchema,
  delivery_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  valid_until: isoDateSchema.nullable().optional(),
  notes: optionalText(2000),
  /** One per item the vendor priced. An item left out is one they did not quote for. */
  lines: z
    .array(
      z.object({
        rfq_item_id: uuidSchema,
        unit_rate: positivePaiseSchema,
        tax_rate_bp: taxRateBpSchema,
      }),
    )
    .min(1)
    .max(200),
});
export type UpsertQuoteInput = z.infer<typeof upsertQuoteSchema>;

export const awardRfqSchema = z.object({
  quote_id: uuidSchema,
  notes: optionalText(2000),
  expected_on: isoDateSchema.nullable().optional(),
});
export type AwardRfqInput = z.infer<typeof awardRfqSchema>;

// --- purchase orders ---------------------------------------------------------------------------

export const purchaseOrderLineSchema = z.object({
  material_id: uuidSchema.nullable().optional(),
  description: z.string().trim().max(300).optional(),
  unit: z.string().trim().max(20).optional(),
  quantity: procurementQuantitySchema,
  unit_rate: positivePaiseSchema,
  tax_rate_bp: taxRateBpSchema,
  /** The site's work breakdown line this spend commits against. Must be one of the site's own. */
  cost_code_id: uuidSchema.nullable().optional(),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

export const createPurchaseOrderSchema = z.object({
  project_id: uuidSchema,
  vendor_id: uuidSchema,
  notes: optionalText(2000),
  delivery_address: optionalText(500),
  expected_on: isoDateSchema.nullable().optional(),
  indent_id: uuidSchema.optional(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(200),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/** A draft only. Lines, when given, replace the order's lines wholesale. */
export const updatePurchaseOrderSchema = z
  .object({
    vendor_id: uuidSchema.optional(),
    notes: optionalText(2000),
    delivery_address: optionalText(500),
    expected_on: isoDateSchema.nullable().optional(),
    lines: z.array(purchaseOrderLineSchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  vendor_id: uuidSchema.optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  /** Orders waiting for somebody with this caller's limit — "my approvals". */
  awaiting_me: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

export const decidePurchaseOrderSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type DecidePurchaseOrderInput = z.infer<typeof decidePurchaseOrderSchema>;

export const rejectPurchaseOrderSchema = z.object({
  /** Why — it goes back to whoever raised it, and "rejected" alone tells them nothing. */
  note: text(1000),
});
export type RejectPurchaseOrderInput = z.infer<typeof rejectPurchaseOrderSchema>;

// --- goods received ----------------------------------------------------------------------------

export const receiveGoodsSchema = z.object({
  received_on: isoDateSchema,
  /** The delivery challan or note number. */
  ref: z.string().trim().max(80).optional(),
  note: z.string().trim().max(1000).optional(),
  lines: z
    .array(z.object({ po_line_id: uuidSchema, quantity: procurementQuantitySchema }))
    .min(1)
    .max(200),
});
export type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;

// --- supplier invoices -------------------------------------------------------------------------

export const recordPurchaseInvoiceSchema = z.object({
  invoice_number: text(60),
  invoice_date: isoDateSchema,
  due_date: isoDateSchema.nullable().optional(),
  /** The scanned invoice, uploaded through the usual presigned upload. */
  attachment_s3_key: z.string().max(512).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        po_line_id: uuidSchema,
        quantity: procurementQuantitySchema,
        /** The rate on the invoice, before tax. */
        unit_rate: positivePaiseSchema,
        /** The tax the invoice charges on this line. */
        tax_amount: positivePaiseSchema,
      }),
    )
    .min(1)
    .max(200),
});
export type RecordPurchaseInvoiceInput = z.infer<typeof recordPurchaseInvoiceSchema>;

export const listPurchaseInvoicesQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  purchase_order_id: uuidSchema.optional(),
  status: z.enum(PURCHASE_INVOICE_STATUSES).optional(),
});
export type ListPurchaseInvoicesQuery = z.infer<typeof listPurchaseInvoicesQuerySchema>;

export const approvePurchaseInvoiceSchema = z
  .object({
    /** Required to approve an invoice the match flagged: somebody has to own the difference. */
    accept_variance: z.boolean().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((value) => !value.accept_variance || (value.note && value.note.length > 0), {
    message: 'say why the difference is accepted',
    path: ['note'],
  });
export type ApprovePurchaseInvoiceInput = z.infer<typeof approvePurchaseInvoiceSchema>;

export const rejectPurchaseInvoiceSchema = z.object({ note: text(1000) });
export type RejectPurchaseInvoiceInput = z.infer<typeof rejectPurchaseInvoiceSchema>;

// --- company settings --------------------------------------------------------------------------

export const procurementSettingsSchema = z
  .object({
    /** How far an invoice may differ from the order and the delivery before it is flagged. */
    match_tolerance_bp: z.coerce.number().int().min(0).max(2_000).optional(),
    /**
     * The approval limits, replacing the current list. Each names a role or a person, never both;
     * `max_amount` null is unlimited. Anybody not covered may approve nothing — the owner signs.
     */
    limits: z
      .array(
        z
          .object({
            role_id: uuidSchema.nullable().optional(),
            user_id: uuidSchema.nullable().optional(),
            max_amount: positivePaiseSchema.nullable(),
          })
          .refine((value) => Boolean(value.role_id) !== Boolean(value.user_id), {
            message: 'a limit is for a role or for a person',
          }),
      )
      .max(200)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type ProcurementSettingsInput = z.infer<typeof procurementSettingsSchema>;
