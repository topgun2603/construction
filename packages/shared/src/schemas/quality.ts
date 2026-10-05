import { z } from 'zod';
import {
  QUALITY_INSPECTION_RESULTS,
  QUALITY_INSPECTION_STATUSES,
  QUALITY_ITEM_KINDS,
  QUALITY_ITEM_OUTCOMES,
  QUALITY_TEST_TYPES,
  SNAG_PHOTO_STAGES,
  SNAG_PRIORITIES,
  SNAG_STATUSES,
  type QualityInspectionResult,
  type QualityInspectionStatus,
  type QualityItemKind,
  type QualityItemOutcome,
  type QualitySignoffParty,
  type QualityTestResult,
  type QualityTestState,
  type QualityTestType,
  type SnagPhotoStage,
  type SnagPriority,
  type SnagSource,
  type SnagStatus,
} from '../quality';
import { isoDateSchema, uuidSchema } from './common';

/**
 * QA/QC (roadmap Phase 2, module 7): what the API accepts and what it hands back.
 *
 * Measurements travel as decimal strings with at most three places, like quantities, so nothing on
 * the wire is a float and "40.1 against 40 + 0.1" is judged exactly.
 */

/** A reading or limit: up to three decimals, negative allowed (a level 3 mm low is −3). */
export const qualityDecimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(z.string().regex(/^-?\d{1,9}(?:\.\d{1,3})?$/, 'expected a number with at most three decimals'));

/** A tolerance is a distance either side, so never negative. */
const qualityToleranceSchema = qualityDecimalSchema.refine((value) => !value.startsWith('-'), {
  message: 'a tolerance cannot be negative',
});

/** A photo already uploaded through `/uploads/presign`. The tenant prefix is what authorises it. */
const photoKeySchema = z.string().min(1).max(512);

// --- templates ---------------------------------------------------------------------------------

export const qualityChecklistItemSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    kind: z.enum(QUALITY_ITEM_KINDS),
    /** A required line must be answered (or marked not applicable) before the inspection is signed. */
    required: z.boolean().optional(),
    /** Any line can insist on a photo; a `photo` line always does. */
    photo_required: z.boolean().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    target_value: qualityDecimalSchema.nullable().optional(),
    tolerance_minus: qualityToleranceSchema.nullable().optional(),
    tolerance_plus: qualityToleranceSchema.nullable().optional(),
    /** How to check it, shown under the line on the runner. */
    guidance: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (item) => item.kind === 'number' || (item.target_value == null && item.tolerance_minus == null && item.tolerance_plus == null),
    { message: 'only a number line has a target and tolerance', path: ['target_value'] },
  )
  .refine(
    (item) => item.target_value != null || (item.tolerance_minus == null && item.tolerance_plus == null),
    { message: 'a tolerance needs a target to be measured from', path: ['target_value'] },
  );
export type QualityChecklistItemInput = z.infer<typeof qualityChecklistItemSchema>;

export const createQualityTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** The trade a failed line's snag is filed under: Concrete, Plumbing. */
  trade: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  items: z.array(qualityChecklistItemSchema).min(1).max(150),
});
export type CreateQualityTemplateInput = z.infer<typeof createQualityTemplateSchema>;

/**
 * Editing a template replaces its lines wholesale. Safe, because an inspection copies the lines it
 * was run with — changing the library never rewrites what somebody already signed.
 */
export const updateQualityTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    trade: z.string().trim().max(60).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    active: z.boolean().optional(),
    items: z.array(qualityChecklistItemSchema).min(1).max(150).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateQualityTemplateInput = z.infer<typeof updateQualityTemplateSchema>;

export const listQualityTemplatesQuerySchema = z.object({
  /** Archived templates are hidden unless asked for; the editor shows them to restore. */
  include_archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListQualityTemplatesQuery = z.infer<typeof listQualityTemplatesQuerySchema>;

// --- inspections -------------------------------------------------------------------------------

export const createQualityInspectionSchema = z.object({
  project_id: uuidSchema,
  template_id: uuidSchema,
  /** Where on the site: "Block A, 3rd floor slab", "Flat 204 master bath". */
  location: z.string().trim().min(1).max(200),
  inspection_date: isoDateSchema.optional(),
  /** Defaults to whoever starts it. */
  inspector_id: uuidSchema.optional(),
  cost_code_id: uuidSchema.nullable().optional(),
  /** The stage of the site timeline this inspection belongs to. */
  milestone_id: uuidSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** Shown to the client in the portal once completed, for them to countersign. */
  share_with_client: z.boolean().optional(),
});
export type CreateQualityInspectionInput = z.infer<typeof createQualityInspectionSchema>;

export const updateQualityInspectionSchema = z
  .object({
    location: z.string().trim().min(1).max(200).optional(),
    inspection_date: isoDateSchema.optional(),
    inspector_id: uuidSchema.optional(),
    cost_code_id: uuidSchema.nullable().optional(),
    milestone_id: uuidSchema.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    share_with_client: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateQualityInspectionInput = z.infer<typeof updateQualityInspectionSchema>;

/** Answers for some or all lines. The runner saves as the inspector goes, line by line. */
export const recordQualityInspectionItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuidSchema,
        /** Pass, fail or not applicable. A number line's outcome is worked out from its reading. */
        outcome: z.enum(QUALITY_ITEM_OUTCOMES).nullable().optional(),
        number_value: qualityDecimalSchema.nullable().optional(),
        text_value: z.string().trim().max(2000).nullable().optional(),
        /** Replaces the line's photos. */
        photo_keys: z.array(photoKeySchema).max(12).optional(),
        comment: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .min(1)
    .max(150),
});
export type RecordQualityInspectionItemsInput = z.infer<typeof recordQualityInspectionItemsSchema>;

/** The inspector's signature, which completes the inspection and fixes its result. */
export const completeQualityInspectionSchema = z.object({
  /** Typed in full: the name that appears on the printed report. */
  signature_name: z.string().trim().min(2).max(120),
  /** Only to downgrade a clean pass; a failed line can never be signed as anything but a fail. */
  result: z.enum(QUALITY_INSPECTION_RESULTS).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** Raise snags for failed lines (the default). Off only when they are being tracked elsewhere. */
  raise_snags: z.boolean().optional(),
});
export type CompleteQualityInspectionInput = z.infer<typeof completeQualityInspectionSchema>;

/** A client's or consultant's countersignature on a completed inspection. */
export const signQualityInspectionSchema = z.object({
  signature_name: z.string().trim().min(2).max(120),
  /** False records that they looked and do not accept it — a signature either way is evidence. */
  accepted: z.boolean().default(true),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type SignQualityInspectionInput = z.infer<typeof signQualityInspectionSchema>;

export const listQualityInspectionsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(QUALITY_INSPECTION_STATUSES).optional(),
  result: z.enum(QUALITY_INSPECTION_RESULTS).optional(),
  template_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListQualityInspectionsQuery = z.infer<typeof listQualityInspectionsQuerySchema>;

// --- material tests ----------------------------------------------------------------------------

export const createQualityTestSchema = z
  .object({
    project_id: uuidSchema,
    test_type: z.enum(QUALITY_TEST_TYPES),
    /** What is being tested, for `other` and for anything the type does not say: "Fly ash bricks". */
    title: z.string().trim().max(160).nullable().optional(),
    /** The sample or cube set id written on the sample: "C-14", "S3/Block A". */
    sample_ref: z.string().trim().min(1).max(60),
    location: z.string().trim().max(200).nullable().optional(),
    cost_code_id: uuidSchema.nullable().optional(),
    /** M25, Fe 500D. */
    grade: z.string().trim().max(40).nullable().optional(),
    /** Date the concrete was cast (cubes) or the sample was taken. */
    cast_on: isoDateSchema.nullable().optional(),
    /**
     * Cube ages to crush, in days. One test row per age, all sharing the sample id; each is due on
     * the cast date plus its age. Defaults to 7 and 28 for a cube set; ignored for other types.
     */
    ages: z.array(z.number().int().min(1).max(365)).min(1).max(4).optional(),
    /** For a single test that is due on a known day (a lab booking). */
    due_on: isoDateSchema.nullable().optional(),
    /**
     * The specification. For a cube set, `spec_min` is the 28-day characteristic strength and the
     * earlier ages get the usual share of it; edit a row to change its own target.
     */
    spec_min: qualityDecimalSchema.nullable().optional(),
    spec_max: qualityDecimalSchema.nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    lab_name: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => value.test_type !== 'concrete_cube' || Boolean(value.cast_on), {
    message: 'a cube set needs the date it was cast',
    path: ['cast_on'],
  })
  .refine((value) => value.test_type !== 'other' || Boolean(value.title), {
    message: 'say what is being tested',
    path: ['title'],
  });
export type CreateQualityTestInput = z.infer<typeof createQualityTestSchema>;

export const updateQualityTestSchema = z
  .object({
    title: z.string().trim().max(160).nullable().optional(),
    sample_ref: z.string().trim().min(1).max(60).optional(),
    location: z.string().trim().max(200).nullable().optional(),
    cost_code_id: uuidSchema.nullable().optional(),
    grade: z.string().trim().max(40).nullable().optional(),
    due_on: isoDateSchema.nullable().optional(),
    spec_min: qualityDecimalSchema.nullable().optional(),
    spec_max: qualityDecimalSchema.nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    lab_name: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateQualityTestInput = z.infer<typeof updateQualityTestSchema>;

/** The lab's figure. Pass or fail is worked out from the specification, never typed. */
export const recordQualityTestResultSchema = z.object({
  result_value: qualityDecimalSchema,
  tested_on: isoDateSchema.optional(),
  lab_name: z.string().trim().max(120).nullable().optional(),
  /** The lab's report, uploaded first (kind `quality_report`). */
  report_s3_key: z.string().min(1).max(512).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** Raise a snag when it fails (the default) so somebody owns what happens next. */
  raise_snag: z.boolean().optional(),
});
export type RecordQualityTestResultInput = z.infer<typeof recordQualityTestResultSchema>;

export const QUALITY_TEST_FILTERS = ['pending', 'due', 'overdue', 'pass', 'fail'] as const;

export const listQualityTestsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  test_type: z.enum(QUALITY_TEST_TYPES).optional(),
  state: z.enum(QUALITY_TEST_FILTERS).optional(),
  sample_ref: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListQualityTestsQuery = z.infer<typeof listQualityTestsQuerySchema>;

// --- snags -------------------------------------------------------------------------------------

const snagFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  trade: z.string().trim().max(60).nullable().optional(),
  priority: z.enum(SNAG_PRIORITIES).optional(),
  /** Somebody in the team who should fix it… */
  assigned_user_id: uuidSchema.nullable().optional(),
  /** …or the contractor or subcontractor who should. Either, both or neither. */
  assigned_contractor_id: uuidSchema.nullable().optional(),
  due_on: isoDateSchema.nullable().optional(),
  /** On the handover punch list the client sees in the portal. */
  client_visible: z.boolean().optional(),
  cost_code_id: uuidSchema.nullable().optional(),
};

export const createSnagSchema = z.object({
  project_id: uuidSchema,
  ...snagFields,
  photo_keys: z.array(photoKeySchema).max(12).optional(),
});
export type CreateSnagInput = z.infer<typeof createSnagSchema>;

export const updateSnagSchema = z
  .object({
    title: snagFields.title.optional(),
    description: snagFields.description,
    location: snagFields.location,
    trade: snagFields.trade,
    priority: snagFields.priority,
    assigned_user_id: snagFields.assigned_user_id,
    assigned_contractor_id: snagFields.assigned_contractor_id,
    due_on: snagFields.due_on,
    client_visible: snagFields.client_visible,
    cost_code_id: snagFields.cost_code_id,
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSnagInput = z.infer<typeof updateSnagSchema>;

/**
 * A photo and a few words, or a voice note — what somebody walking a floor actually produces. It
 * becomes a draft snag; somebody confirms it before it is anybody's job.
 */
export const quickSnagSchema = z
  .object({
    project_id: uuidSchema,
    note: z.string().trim().max(2000).optional(),
    photo_keys: z.array(photoKeySchema).max(12).default([]),
    /** A recording uploaded with kind `dpr_voice`. Transcribed when the deployment can. */
    voice_s3_key: z.string().min(1).max(512).optional(),
    location: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Boolean(value.note) || Boolean(value.voice_s3_key) || value.photo_keys.length > 0, {
    message: 'a photo, a note or a voice note',
    path: ['note'],
  });
export type QuickSnagInput = z.infer<typeof quickSnagSchema>;

export const addSnagPhotosSchema = z.object({
  stage: z.enum(SNAG_PHOTO_STAGES).default('before'),
  photo_keys: z.array(photoKeySchema).min(1).max(12),
});
export type AddSnagPhotosInput = z.infer<typeof addSnagPhotosSchema>;

/** Marked fixed by whoever did the work, with the "after" photo that shows it. */
export const fixSnagSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
  photo_keys: z.array(photoKeySchema).min(1, 'an “after” photo shows it was fixed').max(12),
});
export type FixSnagInput = z.infer<typeof fixSnagSchema>;

export const verifySnagSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});
export type VerifySnagInput = z.infer<typeof verifySnagSchema>;

/** Not fixed after all. The reason is required: it is what the person fixing it reads next. */
export const reopenSnagSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type ReopenSnagInput = z.infer<typeof reopenSnagSchema>;

export const listSnagsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(SNAG_STATUSES).optional(),
  /** `active` is draft, open and fixed — everything not yet closed. */
  open_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  priority: z.enum(SNAG_PRIORITIES).optional(),
  trade: z.string().trim().max(60).optional(),
  assigned_user_id: uuidSchema.optional(),
  assigned_contractor_id: uuidSchema.optional(),
  inspection_id: uuidSchema.optional(),
  client_visible: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});
export type ListSnagsQuery = z.infer<typeof listSnagsQuerySchema>;

// --- reports -----------------------------------------------------------------------------------

export const qualityReportQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type QualityReportQuery = z.infer<typeof qualityReportQuerySchema>;

export const QUALITY_EXPORT_KINDS = ['snags', 'inspections', 'tests'] as const;
export type QualityExportKind = (typeof QUALITY_EXPORT_KINDS)[number];

// --- what comes back ---------------------------------------------------------------------------

export interface QualityPerson {
  id: string;
  name: string;
}

export interface QualityPhoto {
  s3_key: string;
  /** A short-lived signed URL; null when it could not be signed. */
  url: string | null;
}

export interface QualityChecklistItemView {
  id: string;
  position: number;
  label: string;
  kind: QualityItemKind;
  required: boolean;
  photo_required: boolean;
  unit: string | null;
  target_value: string | null;
  tolerance_minus: string | null;
  tolerance_plus: string | null;
  guidance: string | null;
}

export interface QualityTemplateView {
  id: string;
  name: string;
  trade: string | null;
  description: string | null;
  active: boolean;
  /** Copied from the standard library rather than written by the company. */
  standard: boolean;
  item_count: number;
  items: QualityChecklistItemView[];
  inspection_count: number;
  updated_at: string;
}

export interface QualityInspectionItemView extends QualityChecklistItemView {
  outcome: QualityItemOutcome | null;
  number_value: string | null;
  text_value: string | null;
  comment: string | null;
  photos: QualityPhoto[];
  /** The snag raised from this line when it failed. */
  snag: { id: string; number: number; status: SnagStatus } | null;
}

export interface QualitySignoffView {
  party: QualitySignoffParty;
  signature_name: string;
  accepted: boolean;
  note: string | null;
  signed_at: string;
  user: QualityPerson | null;
}

export interface QualityInspectionSummary {
  id: string;
  number: number;
  project: QualityPerson;
  template: { id: string; name: string } | null;
  title: string;
  trade: string | null;
  location: string;
  inspection_date: string;
  inspector: QualityPerson | null;
  status: QualityInspectionStatus;
  result: QualityInspectionResult | null;
  share_with_client: boolean;
  counts: { total: number; answered: number; failed: number };
  snag_count: number;
  signed_by: QualitySignoffParty[];
  completed_at: string | null;
}

export interface QualityInspectionView extends QualityInspectionSummary {
  notes: string | null;
  cost_code: { id: string; code: string; name: string } | null;
  milestone: { id: string; name: string } | null;
  items: QualityInspectionItemView[];
  signoffs: QualitySignoffView[];
  /** Why it cannot be signed yet; empty when it can. */
  problems: string[];
}

export interface QualityTestView {
  id: string;
  number: number;
  project: QualityPerson;
  test_type: QualityTestType;
  title: string | null;
  sample_ref: string;
  location: string | null;
  cost_code: { id: string; code: string; name: string } | null;
  grade: string | null;
  cast_on: string | null;
  age_days: number | null;
  due_on: string | null;
  tested_on: string | null;
  spec_min: string | null;
  spec_max: string | null;
  unit: string | null;
  result_value: string | null;
  result: QualityTestResult | null;
  state: QualityTestState;
  lab_name: string | null;
  report: QualityPhoto | null;
  notes: string | null;
  snag: { id: string; number: number; status: SnagStatus } | null;
  recorded_by: QualityPerson | null;
  created_at: string;
}

export interface SnagEventView {
  action: string;
  note: string | null;
  actor: QualityPerson | null;
  at: string;
}

export interface SnagView {
  id: string;
  number: number;
  project: QualityPerson;
  title: string;
  description: string | null;
  location: string | null;
  trade: string | null;
  priority: SnagPriority;
  status: SnagStatus;
  source: SnagSource;
  assigned_user: QualityPerson | null;
  assigned_contractor: QualityPerson | null;
  due_on: string | null;
  overdue: boolean;
  client_visible: boolean;
  cost_code: { id: string; code: string; name: string } | null;
  inspection: { id: string; number: number; title: string } | null;
  test: { id: string; number: number; sample_ref: string } | null;
  raised_by: QualityPerson | null;
  raised_at: string;
  fixed_at: string | null;
  closed_at: string | null;
  reopen_count: number;
  age_days: number;
  /** What a voice note said, kept beside the draft so it can be checked against the words. */
  transcript: string | null;
  /** Whether a model wrote the suggested title, trade and priority (otherwise keyword rules did). */
  ai_suggested: boolean;
  photos: Array<QualityPhoto & { stage: SnagPhotoStage }>;
  events?: SnagEventView[];
}

export interface QualitySummaryReport {
  snags: {
    open: number;
    fixed: number;
    overdue: number;
    closed: number;
    by_site: Array<{ project: QualityPerson; open: number; fixed: number; overdue: number }>;
    by_trade: Array<{ trade: string; open: number; fixed: number }>;
    by_assignee: Array<{ name: string; kind: 'user' | 'contractor' | 'none'; open: number; overdue: number }>;
    by_age: Array<{ bucket: string; label: string; count: number }>;
  };
  inspections: {
    completed: number;
    passed: number;
    passed_with_comments: number;
    failed: number;
    /** Basis points of completed inspections that did not fail; null with none completed. */
    pass_rate_bp: number | null;
    in_progress: number;
    by_template: Array<{ name: string; completed: number; failed: number; pass_rate_bp: number | null }>;
    by_site: Array<{ project: QualityPerson; completed: number; failed: number; pass_rate_bp: number | null }>;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    overdue: number;
    failures: QualityTestView[];
  };
}

/** What the client sees of the punch list: no internal assignment, no cost code. */
export interface PunchListItemView {
  id: string;
  number: number;
  title: string;
  description: string | null;
  location: string | null;
  trade: string | null;
  priority: SnagPriority;
  status: SnagStatus;
  due_on: string | null;
  fixed_at: string | null;
  closed_at: string | null;
  photos: Array<QualityPhoto & { stage: SnagPhotoStage }>;
}
