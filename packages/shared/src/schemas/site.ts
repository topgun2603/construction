import { z } from 'zod';
import { DPR_STATUSES, INDENT_STATUSES, SYNC_OPS, URGENCIES } from '../enums';
import { clientIdSchema, isoDateSchema, uuidSchema } from './common';

// --- daily progress reports ------------------------------------------------

const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .pipe(z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/, 'expected a number with up to 3 decimals'));

export const dprActivitySchema = z.object({
  activity: z.string().trim().min(1).max(500),
  quantity: quantitySchema.optional(),
  unit: z.string().trim().max(24).optional(),
});

export const dprManpowerSchema = z.object({
  trade: z.string().trim().min(1).max(80),
  count: z.number().int().min(0).max(10_000),
});

export const dprPhotoSchema = z.object({
  s3_key: z.string().min(1).max(512),
  caption: z.string().trim().max(280).optional(),
  taken_at: z.string().datetime().optional(),
});

export const createDprSchema = z.object({
  project_id: uuidSchema,
  report_date: isoDateSchema,
  weather: z.string().trim().max(120).optional(),
  work_done: z.string().trim().max(4000).optional(),
  issues: z.string().trim().max(4000).optional(),
  status: z.enum(DPR_STATUSES).default('draft'),
  activities: z.array(dprActivitySchema).max(100).default([]),
  manpower: z.array(dprManpowerSchema).max(100).default([]),
  photos: z.array(dprPhotoSchema).max(60).default([]),
  client_id: clientIdSchema.optional(),
});
export type CreateDprInput = z.infer<typeof createDprSchema>;

export const updateDprSchema = z
  .object({
    weather: z.string().trim().max(120).nullable().optional(),
    work_done: z.string().trim().max(4000).nullable().optional(),
    issues: z.string().trim().max(4000).nullable().optional(),
    /** Replaces the whole list when present — the mobile form always sends all rows. */
    activities: z.array(dprActivitySchema).max(100).optional(),
    manpower: z.array(dprManpowerSchema).max(100).optional(),
    photos: z.array(dprPhotoSchema).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type UpdateDprInput = z.infer<typeof updateDprSchema>;

export const listDprQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: z.enum(DPR_STATUSES).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDprQuery = z.infer<typeof listDprQuerySchema>;

// --- materials -------------------------------------------------------------

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1).max(160),
  unit: z.string().trim().min(1).max(24),
  category: z.string().trim().max(80).optional(),
});
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const listMaterialsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(80).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListMaterialsQuery = z.infer<typeof listMaterialsQuerySchema>;

// --- material indents ------------------------------------------------------

export const indentItemSchema = z.object({
  material_id: uuidSchema,
  quantity: quantitySchema,
});

export const createIndentSchema = z.object({
  project_id: uuidSchema,
  urgency: z.enum(URGENCIES).default('normal'),
  notes: z.string().trim().max(1000).optional(),
  required_by: isoDateSchema.optional(),
  items: z.array(indentItemSchema).min(1).max(100),
  client_id: clientIdSchema.optional(),
});
export type CreateIndentInput = z.infer<typeof createIndentSchema>;

/**
 * Status transition. `received` may carry per-item received quantities so a part
 * delivery can be recorded without inventing a second endpoint.
 */
export const updateIndentStatusSchema = z.object({
  status: z.enum(INDENT_STATUSES),
  note: z.string().trim().max(1000).optional(),
  received: z
    .array(z.object({ material_id: uuidSchema, received_quantity: quantitySchema }))
    .max(100)
    .optional(),
});
export type UpdateIndentStatusInput = z.infer<typeof updateIndentStatusSchema>;

export const listIndentsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(INDENT_STATUSES).optional(),
  urgency: z.enum(URGENCIES).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListIndentsQuery = z.infer<typeof listIndentsQuerySchema>;

// --- uploads ---------------------------------------------------------------

const UPLOAD_KINDS = [
  'dpr_photo',
  'worker_photo',
  'worker_id_proof',
  'bill',
  'document',
  /** Photos and videos of the site itself, as opposed to evidence from one day's report. */
  'site_media',
  /** A photo a client or the team attached to a message in the site conversation. */
  'message_attachment',
] as const;

/**
 * Upload ceilings, in bytes.
 *
 * Video gets its own, far larger limit. A minute of phone video is tens of megabytes and a single
 * cap generous enough for it would also let somebody push a 200 MB "photo" — so the two are bounded
 * separately rather than by whichever is more permissive.
 */
export const MAX_UPLOAD_BYTES = { image: 25 * 1024 * 1024, video: 200 * 1024 * 1024 } as const;

export const presignSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  content_type: z
    .string()
    .regex(/^(image|application|video)\/[\w.+-]+$/, 'unsupported content type'),
  /** Bytes. Bounded so a presigned URL cannot be used to upload something huge. */
  content_length: z.number().int().positive().max(MAX_UPLOAD_BYTES.video),
  project_id: uuidSchema.optional(),
  filename: z.string().trim().max(200).optional(),
})
  .refine(
    (value) =>
      value.content_type.startsWith('video/')
        ? value.content_length <= MAX_UPLOAD_BYTES.video
        : value.content_length <= MAX_UPLOAD_BYTES.image,
    {
      message: 'file is larger than this type allows',
      path: ['content_length'],
    },
  );
export type PresignInput = z.infer<typeof presignSchema>;

// --- sync ------------------------------------------------------------------

const SYNC_ENTITIES = [
  'daily_reports',
  'attendance',
  'workers',
  'worker_projects',
  'labour_payments',
  'material_indents',
] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const outboxEntrySchema = z.object({
  outbox_id: z.string().min(1).max(64),
  entity: z.enum(SYNC_ENTITIES),
  op: z.enum(SYNC_OPS),
  /** The device's own record id — the idempotency key for this entity. */
  client_id: clientIdSchema,
  /** When the device last touched the row; drives last-write-wins. */
  updated_at: z.string().datetime(),
  payload: z.record(z.unknown()),
});
export type OutboxEntry = z.infer<typeof outboxEntrySchema>;

export const syncPushSchema = z.object({
  device_id: z.string().min(1).max(128),
  /** Spec §15: one request carries up to 500 outbox entries. */
  entries: z.array(outboxEntrySchema).min(1).max(500),
});
export type SyncPushInput = z.infer<typeof syncPushSchema>;

export const syncPullQuerySchema = z.object({
  device_id: z.string().min(1).max(128),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export type SyncResultStatus = 'ok' | 'conflict' | 'error';

export interface SyncResult {
  outbox_id: string;
  status: SyncResultStatus;
  server_id?: string;
  server_record?: unknown;
  code?: string;
  message?: string;
}

/**
 * A short-lived URL to *read* one object back.
 *
 * Uploading and viewing are separate grants. A key alone proves nothing — the caller has to still be
 * in the tenant whose prefix it starts with, which is checked server-side rather than assumed from
 * the fact they knew the key.
 */
export const viewObjectSchema = z.object({
  s3_key: z.string().trim().min(1).max(500),
});
export type ViewObjectInput = z.infer<typeof viewObjectSchema>;

// --- site media ------------------------------------------------------------

export const addProjectMediaSchema = z.object({
  kind: z.enum(['photo', 'video']),
  s3_key: z.string().trim().min(1).max(500),
  content_type: z.string().regex(/^(image|video)\/[\w.+-]+$/, 'photos and videos only'),
  size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES.video),
  caption: z.string().trim().max(200).optional(),
  /** When it was taken, which on a site is often days before it was uploaded. */
  taken_at: z.string().datetime().optional(),
  client_id: clientIdSchema.optional(),
});
export type AddProjectMediaInput = z.infer<typeof addProjectMediaSchema>;

export const updateProjectMediaSchema = z
  .object({
    caption: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdateProjectMediaInput = z.infer<typeof updateProjectMediaSchema>;

/**
 * The new order of a site's photos and videos, first to last.
 *
 * A partial list is allowed: the ids sent take the front in the order given, and anything not
 * mentioned keeps its relative order behind them. That is what makes "make this the main image"
 * a one-element request rather than the client having to send the whole album back.
 */
export const reorderProjectMediaSchema = z.object({
  media_ids: z.array(z.string().uuid()).min(1).max(200),
});
export type ReorderProjectMediaInput = z.infer<typeof reorderProjectMediaSchema>;
