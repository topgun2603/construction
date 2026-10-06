import { z } from 'zod';
import {
  RFI_DISCIPLINES,
  RFI_PRIORITIES,
  RFI_STATUSES,
  SUBMITTAL_OUTCOMES,
  SUBMITTAL_REVIEWER_KINDS,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
} from '../rfis';
import { clientIdSchema, isoDateSchema, uuidSchema } from './common';

/**
 * RFIs and submittals (roadmap Phase 2, module 9).
 *
 * The people on the other end — the architect, the structural consultant, the MEP designer — are
 * usually not users of this product, so an RFI is addressed to a name, an email and a company, and
 * only optionally to somebody on the team as well.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalEmail = z
  .union([z.string().trim().email().max(200), z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

/** `?overdue=true` on a query string. */
const queryFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/**
 * A file on an RFI, a response or a submittal: one already in the document library, or an upload
 * (`/uploads/presign` with kind `rfi_attachment`, or the responder's own link). Exactly one.
 */
export const rfiFileSchema = z
  .object({
    document_id: uuidSchema.optional(),
    s3_key: z.string().trim().min(1).max(512).optional(),
    content_type: z.string().trim().max(120).optional(),
    filename: z.string().trim().max(200).optional(),
  })
  .refine((value) => (value.document_id ? !value.s3_key : Boolean(value.s3_key)), {
    message: 'give a library document or an uploaded file, not both',
  });
export type RfiFileInput = z.infer<typeof rfiFileSchema>;

// --- settings --------------------------------------------------------------------------------------

export const rfiSettingsSchema = z.object({
  rfi_due_days: z.number().int().min(1).max(90),
  submittal_review_days: z.number().int().min(1).max(120),
  reminder_days_before: z.number().int().min(0).max(14),
});
export type RfiSettingsInput = z.infer<typeof rfiSettingsSchema>;

// --- RFIs ------------------------------------------------------------------------------------------

const rfiTerms = {
  subject: text(200),
  question: text(8000),
  discipline: z.enum(RFI_DISCIPLINES).default('other'),
  priority: z.enum(RFI_PRIORITIES).default('normal'),
  location: optionalText(200),
  addressed_to_name: optionalText(120),
  addressed_to_email: optionalEmail,
  addressed_to_company: optionalText(160),
  /** E.164 without the plus, for the WhatsApp share. Free text is tolerated and cleaned by the API. */
  addressed_to_phone: optionalText(20),
  /** Somebody on the team who also owns it — the person chasing the answer. */
  assignee_id: uuidSchema.nullable().optional(),
  /** Defaults from the company setting when the RFI is opened. */
  due_on: isoDateSchema.nullable().optional(),
  cost_impact: z.boolean().optional(),
  schedule_impact: z.boolean().optional(),
  schedule_task_id: uuidSchema.nullable().optional(),
  /** Drawings and documents the question is about, by library id (a specific revision). */
  document_ids: z.array(uuidSchema).max(30).optional(),
};

export const createRfiSchema = z.object({
  project_id: uuidSchema,
  ...rfiTerms,
  attachments: z.array(rfiFileSchema).max(20).optional(),
  /** Open it straight away instead of saving a draft. */
  open: z.boolean().optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateRfiInput = z.input<typeof createRfiSchema>;
export type CreateRfiParsed = z.output<typeof createRfiSchema>;

export const updateRfiSchema = z
  .object({
    subject: rfiTerms.subject.optional(),
    question: rfiTerms.question.optional(),
    discipline: z.enum(RFI_DISCIPLINES).optional(),
    priority: z.enum(RFI_PRIORITIES).optional(),
    location: rfiTerms.location,
    addressed_to_name: rfiTerms.addressed_to_name,
    addressed_to_email: rfiTerms.addressed_to_email,
    addressed_to_company: rfiTerms.addressed_to_company,
    addressed_to_phone: rfiTerms.addressed_to_phone,
    assignee_id: rfiTerms.assignee_id,
    due_on: rfiTerms.due_on,
    cost_impact: rfiTerms.cost_impact,
    schedule_impact: rfiTerms.schedule_impact,
    schedule_task_id: rfiTerms.schedule_task_id,
    document_ids: rfiTerms.document_ids,
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateRfiInput = z.input<typeof updateRfiSchema>;

export const listRfisQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(RFI_STATUSES).optional(),
  discipline: z.enum(RFI_DISCIPLINES).optional(),
  overdue: queryFlag,
  /** Matches the addressee's name or company. */
  party: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListRfisQuery = z.infer<typeof listRfisQuerySchema>;

export const rfiResponseSchema = z.object({
  body: text(8000),
  /** Mark this as the official answer, which moves an open RFI to answered. */
  official: z.boolean().optional(),
  /** Who actually gave the answer when it is being recorded for somebody else (a phone call). */
  on_behalf_of: optionalText(120),
  attachments: z.array(rfiFileSchema).max(20).optional(),
});
export type RfiResponseInput = z.infer<typeof rfiResponseSchema>;

export const rfiNoteSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type RfiNoteInput = z.infer<typeof rfiNoteSchema>;

export const rfiVoidSchema = z.object({
  reason: text(1000),
});
export type RfiVoidInput = z.infer<typeof rfiVoidSchema>;

export const rfiAttachmentsSchema = z.object({
  attachments: z.array(rfiFileSchema).min(1).max(20),
});
export type RfiAttachmentsInput = z.infer<typeof rfiAttachmentsSchema>;

/** "Draft with AI": check the site's documents first, then tidy the question. */
export const rfiDraftAiSchema = z.object({
  project_id: uuidSchema,
  question: z.string().trim().min(5).max(4000),
  subject: z.string().trim().max(200).optional(),
});
export type RfiDraftAiInput = z.infer<typeof rfiDraftAiSchema>;

export interface RfiAiDraft {
  subject: string;
  question: string;
  discipline: (typeof RFI_DISCIPLINES)[number];
}

// --- submittals ------------------------------------------------------------------------------------

const submittalTerms = {
  title: text(200),
  type: z.enum(SUBMITTAL_TYPES).default('shop_drawing'),
  spec_section: optionalText(60),
  cost_code_id: uuidSchema.nullable().optional(),
  /** Who prepared it: somebody on the team, a subcontractor (contractor) or a supplier (vendor). */
  submitted_by_user_id: uuidSchema.nullable().optional(),
  contractor_id: uuidSchema.nullable().optional(),
  vendor_id: uuidSchema.nullable().optional(),
  reviewer_kind: z.enum(SUBMITTAL_REVIEWER_KINDS).default('external'),
  reviewer_name: optionalText(120),
  reviewer_email: optionalEmail,
  reviewer_company: optionalText(160),
  reviewer_phone: optionalText(20),
  description: optionalText(4000),
};

export const createSubmittalSchema = z.object({
  project_id: uuidSchema,
  ...submittalTerms,
  files: z.array(rfiFileSchema).max(30).optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateSubmittalInput = z.input<typeof createSubmittalSchema>;

export const updateSubmittalSchema = z
  .object({
    title: submittalTerms.title.optional(),
    type: z.enum(SUBMITTAL_TYPES).optional(),
    spec_section: submittalTerms.spec_section,
    cost_code_id: submittalTerms.cost_code_id,
    submitted_by_user_id: submittalTerms.submitted_by_user_id,
    contractor_id: submittalTerms.contractor_id,
    vendor_id: submittalTerms.vendor_id,
    reviewer_kind: z.enum(SUBMITTAL_REVIEWER_KINDS).optional(),
    reviewer_name: submittalTerms.reviewer_name,
    reviewer_email: submittalTerms.reviewer_email,
    reviewer_company: submittalTerms.reviewer_company,
    reviewer_phone: submittalTerms.reviewer_phone,
    description: submittalTerms.description,
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSubmittalInput = z.input<typeof updateSubmittalSchema>;

export const listSubmittalsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(SUBMITTAL_STATUSES).optional(),
  type: z.enum(SUBMITTAL_TYPES).optional(),
  overdue: queryFlag,
  party: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListSubmittalsQuery = z.infer<typeof listSubmittalsQuerySchema>;

export const submittalFilesSchema = z.object({
  files: z.array(rfiFileSchema).min(1).max(30),
});
export type SubmittalFilesInput = z.infer<typeof submittalFilesSchema>;

export const submitSubmittalSchema = z.object({
  /** Defaults from the company setting. */
  due_on: isoDateSchema.optional(),
  /** The cover note on the transmittal. */
  note: optionalText(2000),
});
export type SubmitSubmittalInput = z.infer<typeof submitSubmittalSchema>;

export const reviewSubmittalSchema = z.object({
  outcome: z.enum(SUBMITTAL_OUTCOMES),
  comments: optionalText(8000),
  /** Who reviewed, when an internal user is recording a review that arrived by email or by hand. */
  reviewer_name: optionalText(120),
  /** The marked-up drawing or stamped sheet that came back. */
  markups: z.array(rfiFileSchema).max(20).optional(),
});
export type ReviewSubmittalInput = z.infer<typeof reviewSubmittalSchema>;

export const resubmitSubmittalSchema = z.object({
  /** Carry the previous revision's files forward, to replace the ones that changed. */
  copy_files: z.boolean().default(false),
});
export type ResubmitSubmittalInput = z.input<typeof resubmitSubmittalSchema>;

// --- the responder's link (no account) -------------------------------------------------------------

export const rfiLinkTokenSchema = z.object({ token: z.string().min(20).max(2000) });

/** A file the responder uploaded through their own link's presign. */
export const rfiExternalFileSchema = z.object({
  s3_key: z.string().trim().min(1).max(512),
  content_type: z.string().trim().max(120).optional(),
  filename: z.string().trim().max(200).optional(),
});

export const rfiExternalPresignSchema = z.object({
  token: z.string().min(20).max(2000),
  content_type: z.string().regex(/^(image|application)\/[\w.+-]+$/, 'unsupported content type'),
  content_length: z.number().int().positive().max(25 * 1024 * 1024),
  filename: z.string().trim().max(200).optional(),
});
export type RfiExternalPresignInput = z.infer<typeof rfiExternalPresignSchema>;

export const rfiExternalAnswerSchema = z.object({
  token: z.string().min(20).max(2000),
  name: text(120),
  email: optionalEmail,
  body: text(8000),
  attachments: z.array(rfiExternalFileSchema).max(10).optional(),
});
export type RfiExternalAnswerInput = z.infer<typeof rfiExternalAnswerSchema>;

export const submittalExternalReviewSchema = z.object({
  token: z.string().min(20).max(2000),
  name: text(120),
  email: optionalEmail,
  outcome: z.enum(SUBMITTAL_OUTCOMES),
  comments: optionalText(8000),
  markups: z.array(rfiExternalFileSchema).max(10).optional(),
});
export type SubmittalExternalReviewInput = z.infer<typeof submittalExternalReviewSchema>;
