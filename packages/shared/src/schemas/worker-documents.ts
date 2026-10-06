import { z } from 'zod';
import { isoDateSchema } from './common';

/**
 * Identity and work-permit papers held for a worker (roadmap Phase 1, item 3).
 *
 * In the Gulf a crew cannot legally work without a valid residence visa, Emirates ID or Iqama and
 * labour card, and a lapsed one is a fine for the employer — so what matters most here is the
 * expiry date, and the alert before it.
 *
 * Numbers are encrypted at rest by the API and shown masked; see WorkerDocumentsService.
 */
export const WORKER_DOCUMENT_KINDS = [
  'passport',
  'residence_visa',
  'emirates_id',
  'labour_card',
  'iqama',
  /** A Saudi citizen's national ID — what a Saudi payroll file carries for them instead of an Iqama. */
  'national_id',
  'work_permit',
  'other',
] as const;
export type WorkerDocumentKind = (typeof WORKER_DOCUMENT_KINDS)[number];

export const WORKER_DOCUMENT_LABELS: Readonly<Record<WorkerDocumentKind, string>> = Object.freeze({
  passport: 'Passport',
  residence_visa: 'Residence visa',
  emirates_id: 'Emirates ID',
  labour_card: 'Labour card',
  iqama: 'Iqama',
  national_id: 'Saudi national ID',
  work_permit: 'Work permit',
  other: 'Other document',
});

/**
 * The papers worth offering in a company's country, most-needed first.
 *
 * India deliberately offers no Aadhaar: the Aadhaar Act restricts who may store the number, and a
 * construction company's database is not one of them.
 */
export function documentKindsFor(country: string | undefined): WorkerDocumentKind[] {
  switch (country) {
    case 'AE':
      return ['emirates_id', 'residence_visa', 'labour_card', 'passport', 'other'];
    case 'SA':
      return ['iqama', 'national_id', 'work_permit', 'passport', 'other'];
    case 'QA':
    case 'KW':
    case 'OM':
    case 'BH':
      return ['residence_visa', 'work_permit', 'passport', 'other'];
    default:
      return ['passport', 'other'];
  }
}

/** Days before expiry that a document is flagged, on the overview and to the owners. */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;

export const createWorkerDocumentSchema = z
  .object({
    kind: z.enum(WORKER_DOCUMENT_KINDS),
    number: z.string().trim().min(3).max(40),
    issued_on: isoDateSchema.optional(),
    expires_on: isoDateSchema.optional(),
    /** A scan, uploaded first through the presign route with kind `worker_document`. */
    s3_key: z.string().max(512).optional(),
  })
  .refine((value) => !value.issued_on || !value.expires_on || value.issued_on < value.expires_on, {
    message: 'the expiry date must be after the issue date',
    path: ['expires_on'],
  });
export type CreateWorkerDocumentInput = z.infer<typeof createWorkerDocumentSchema>;

export const updateWorkerDocumentSchema = z
  .object({
    number: z.string().trim().min(3).max(40).optional(),
    issued_on: isoDateSchema.nullable().optional(),
    expires_on: isoDateSchema.nullable().optional(),
    s3_key: z.string().max(512).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateWorkerDocumentInput = z.infer<typeof updateWorkerDocumentSchema>;
