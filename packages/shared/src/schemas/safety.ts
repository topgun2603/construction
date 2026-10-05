import { z } from 'zod';
import {
  SAFETY_ACTION_KINDS,
  SAFETY_ACTION_STATUSES,
  SAFETY_CATEGORIES,
  SAFETY_INCIDENT_STATUSES,
  SAFETY_INCIDENT_TYPES,
  SAFETY_LOCAL_DATETIME,
  SAFETY_OBSERVATION_STATUSES,
  SAFETY_OBSERVATION_TYPES,
  SAFETY_PERMIT_APPROVALS,
  SAFETY_PERMIT_STATUSES,
  SAFETY_PERMIT_TYPES,
  SAFETY_PERSON_ROLES,
  SAFETY_PHOTO_PURPOSES,
  SAFETY_SEVERITIES,
} from '../safety';
import { clientIdSchema, isoDateSchema, uuidSchema } from './common';

/**
 * Safety (HSE), roadmap Phase 2, module 8. Times a person types — when an incident happened, when a
 * permit runs from and to — travel as wall-clock times on the company's clock (`2026-10-06T14:30`),
 * and the API turns them into instants in the company's time zone.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** `2026-10-06T14:30`, on the company's clock. */
export const safetyLocalDateTimeSchema = z
  .string()
  .regex(SAFETY_LOCAL_DATETIME, 'expected a date and time like 2026-10-06T14:30');

/** A photo uploaded through `/uploads/presign` under the `safety_photo` kind. */
const s3KeySchema = z.string().min(1).max(512);

const listRange = {
  project_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
};

// --- incidents ---------------------------------------------------------------------------------------

export const safetyIncidentPersonSchema = z
  .object({
    /** A worker on the roster. Leave out for a visitor, a driver, a member of the public. */
    worker_id: uuidSchema.nullable().optional(),
    /** Required when there is no worker; taken from the roster when there is. */
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(SAFETY_PERSON_ROLES).default('involved'),
    /** "Left hand", "lower back". */
    body_part: optionalText(120),
    /** "Laceration", "fracture", "burn". */
    injury_nature: optionalText(200),
    /** What a witness said, in their words. A photo of a signed statement goes in as a photo. */
    statement: optionalText(4000),
  })
  .refine((value) => Boolean(value.worker_id) || Boolean(value.name), {
    message: 'pick a worker or type a name',
    path: ['name'],
  });
export type SafetyIncidentPersonInput = z.infer<typeof safetyIncidentPersonSchema>;

const incidentFields = {
  occurred_at: safetyLocalDateTimeSchema,
  type: z.enum(SAFETY_INCIDENT_TYPES),
  severity: z.enum(SAFETY_SEVERITIES).optional(),
  title: text(200),
  description: optionalText(4000),
  location: optionalText(200),
  immediate_action: optionalText(2000),
  /** Working days lost, once known. Informational; LTIFR counts injuries, not days. */
  lost_days: z.number().int().min(0).max(10_000).nullable().optional(),
  people: z.array(safetyIncidentPersonSchema).max(50).optional(),
};

export const createSafetyIncidentSchema = z.object({
  project_id: uuidSchema,
  ...incidentFields,
  /** The device's id for this report, so a retried submit on a bad connection files it once. */
  client_id: clientIdSchema.optional(),
  /** Photos already uploaded, attached as evidence. */
  photo_keys: z.array(s3KeySchema).max(20).optional(),
});
export type CreateSafetyIncidentInput = z.infer<typeof createSafetyIncidentSchema>;

/** Five whys: up to five answers, in order. Empty strings are dropped. */
const whysSchema = z.array(z.string().trim().max(500)).max(5);

export const updateSafetyIncidentSchema = z
  .object({
    ...incidentFields,
    occurred_at: safetyLocalDateTimeSchema.optional(),
    type: z.enum(SAFETY_INCIDENT_TYPES).optional(),
    title: text(200).optional(),
    root_cause_whys: whysSchema.optional(),
    root_cause: optionalText(2000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSafetyIncidentInput = z.infer<typeof updateSafetyIncidentSchema>;

export const safetyIncidentStatusSchema = z.object({
  status: z.enum(SAFETY_INCIDENT_STATUSES),
  note: z.string().trim().max(2000).optional(),
});
export type SafetyIncidentStatusInput = z.infer<typeof safetyIncidentStatusSchema>;

export const listSafetyIncidentsQuerySchema = z.object({
  ...listRange,
  status: z.enum(SAFETY_INCIDENT_STATUSES).optional(),
  type: z.enum(SAFETY_INCIDENT_TYPES).optional(),
});
export type ListSafetyIncidentsQuery = z.infer<typeof listSafetyIncidentsQuerySchema>;

// --- corrective and preventive actions ---------------------------------------------------------------

export const createSafetyActionSchema = z.object({
  kind: z.enum(SAFETY_ACTION_KINDS).default('corrective'),
  description: text(1000),
  /** A member of the team. Null leaves it with whoever manages safety. */
  assignee_id: uuidSchema.nullable().optional(),
  due_on: isoDateSchema.nullable().optional(),
});
export type CreateSafetyActionInput = z.infer<typeof createSafetyActionSchema>;

export const updateSafetyActionSchema = z
  .object({
    description: text(1000),
    assignee_id: uuidSchema.nullable(),
    due_on: isoDateSchema.nullable(),
    status: z.enum(SAFETY_ACTION_STATUSES),
    /** What was done, when closing it. */
    note: z.string().trim().max(2000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSafetyActionInput = z.infer<typeof updateSafetyActionSchema>;

// --- photos ------------------------------------------------------------------------------------------

export const addSafetyPhotoSchema = z
  .object({
    incident_id: uuidSchema.optional(),
    observation_id: uuidSchema.optional(),
    permit_id: uuidSchema.optional(),
    toolbox_talk_id: uuidSchema.optional(),
    s3_key: s3KeySchema,
    purpose: z.enum(SAFETY_PHOTO_PURPOSES).default('evidence'),
    caption: z.string().trim().max(300).optional(),
  })
  .refine(
    (value) =>
      [value.incident_id, value.observation_id, value.permit_id, value.toolbox_talk_id].filter(Boolean)
        .length === 1,
    { message: 'attach the photo to exactly one record', path: ['incident_id'] },
  );
export type AddSafetyPhotoInput = z.infer<typeof addSafetyPhotoSchema>;

// --- permits to work ---------------------------------------------------------------------------------

const checklistSchema = z
  .array(z.object({ item: text(300), checked: z.boolean() }))
  .min(1)
  .max(40);

export const createSafetyPermitSchema = z.object({
  project_id: uuidSchema,
  type: z.enum(SAFETY_PERMIT_TYPES),
  /** What is being done: "Welding handrail brackets, level 4". */
  description: text(1000),
  area: text(200),
  valid_from: safetyLocalDateTimeSchema,
  valid_to: safetyLocalDateTimeSchema,
  /** Defaults to the type's checklist, unticked. */
  checklist: checklistSchema.optional(),
  /** The workers doing the job. */
  crew: z.array(uuidSchema).max(100).optional(),
  /** Gas readings, isolation points, anything the type needs written down. */
  precautions: optionalText(2000),
});
export type CreateSafetyPermitInput = z.infer<typeof createSafetyPermitSchema>;

export const updateSafetyPermitSchema = z
  .object({
    description: text(1000),
    area: text(200),
    valid_from: safetyLocalDateTimeSchema,
    valid_to: safetyLocalDateTimeSchema,
    checklist: checklistSchema,
    crew: z.array(uuidSchema).max(100),
    precautions: optionalText(2000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSafetyPermitInput = z.infer<typeof updateSafetyPermitSchema>;

export const approveSafetyPermitSchema = z.object({
  /** Which signature this is: the permit issuer, or the authority for the area the work is in. */
  as: z.enum(SAFETY_PERMIT_APPROVALS),
});
export type ApproveSafetyPermitInput = z.infer<typeof approveSafetyPermitSchema>;

export const safetyPermitNoteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});
export type SafetyPermitNoteInput = z.infer<typeof safetyPermitNoteSchema>;

export const listSafetyPermitsQuerySchema = z.object({
  ...listRange,
  status: z.enum(SAFETY_PERMIT_STATUSES).optional(),
  type: z.enum(SAFETY_PERMIT_TYPES).optional(),
  /** Only active permits whose time has run out. */
  expired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListSafetyPermitsQuery = z.infer<typeof listSafetyPermitsQuerySchema>;

// --- toolbox talks -----------------------------------------------------------------------------------

export const createSafetyToolboxTalkSchema = z
  .object({
    project_id: uuidSchema,
    talk_date: isoDateSchema,
    /** A topic from the library, or leave out and type one. */
    topic_key: z.string().trim().min(1).max(60).optional(),
    topic: text(200).optional(),
    notes: optionalText(2000),
    /** The person giving the talk. Defaults to whoever records it. */
    presenter_id: uuidSchema.optional(),
    duration_minutes: z.number().int().min(1).max(240).default(15),
    /** Workers on that day's roll who attended, and whether each has signed. */
    attendees: z
      .array(z.object({ worker_id: uuidSchema, signed: z.boolean().default(true) }))
      .max(500)
      .default([]),
    photo_keys: z.array(s3KeySchema).max(10).optional(),
  })
  .refine((value) => Boolean(value.topic_key) || Boolean(value.topic), {
    message: 'pick a topic or type one',
    path: ['topic'],
  });
export type CreateSafetyToolboxTalkInput = z.infer<typeof createSafetyToolboxTalkSchema>;

export const listSafetyToolboxTalksQuerySchema = z.object(listRange);
export type ListSafetyToolboxTalksQuery = z.infer<typeof listSafetyToolboxTalksQuerySchema>;

export const safetyRollQuerySchema = z.object({
  project_id: uuidSchema,
  date: isoDateSchema,
});
export type SafetyRollQuery = z.infer<typeof safetyRollQuerySchema>;

export const safetyCoverageQuerySchema = z.object({
  /** Any day in the week wanted; defaults to today on the company's clock. */
  week_of: isoDateSchema.optional(),
  project_id: uuidSchema.optional(),
});
export type SafetyCoverageQuery = z.infer<typeof safetyCoverageQuerySchema>;

// --- observations ------------------------------------------------------------------------------------

const observationFields = {
  type: z.enum(SAFETY_OBSERVATION_TYPES),
  category: z.enum(SAFETY_CATEGORIES),
  severity: z.enum(SAFETY_SEVERITIES).default('medium'),
  description: text(2000),
  location: optionalText(200),
  /** Defaults to now. */
  observed_at: safetyLocalDateTimeSchema.optional(),
};

export const createSafetyObservationSchema = z.object({
  project_id: uuidSchema,
  ...observationFields,
  client_id: clientIdSchema.optional(),
  photo_keys: z.array(s3KeySchema).max(10).optional(),
  /** Raise the corrective action with it. */
  action: createSafetyActionSchema.optional(),
});
export type CreateSafetyObservationInput = z.infer<typeof createSafetyObservationSchema>;

/**
 * Quick capture: a photo and a few words, or a voice note, from somebody walking the site. Anything
 * not given is suggested — by the AI module when a key is configured, by keyword rules when not —
 * and can be corrected afterwards.
 */
export const quickSafetyObservationSchema = z
  .object({
    project_id: uuidSchema,
    note: z.string().trim().max(2000).optional(),
    /** A recording uploaded under the `dpr_voice` kind; transcribed only when AI is configured. */
    voice_s3_key: s3KeySchema.optional(),
    photo_key: s3KeySchema.optional(),
    location: optionalText(200),
    type: z.enum(SAFETY_OBSERVATION_TYPES).optional(),
    category: z.enum(SAFETY_CATEGORIES).optional(),
    severity: z.enum(SAFETY_SEVERITIES).optional(),
    client_id: clientIdSchema.optional(),
  })
  .refine((value) => Boolean(value.note) || Boolean(value.voice_s3_key), {
    message: 'say or type what you saw',
    path: ['note'],
  });
export type QuickSafetyObservationInput = z.infer<typeof quickSafetyObservationSchema>;

export const suggestSafetyObservationSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type SuggestSafetyObservationInput = z.infer<typeof suggestSafetyObservationSchema>;

export const closeSafetyObservationSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  /** A photo of the fixed condition. */
  closeout_photo_key: s3KeySchema.optional(),
});
export type CloseSafetyObservationInput = z.infer<typeof closeSafetyObservationSchema>;

export const listSafetyObservationsQuerySchema = z.object({
  ...listRange,
  status: z.enum(SAFETY_OBSERVATION_STATUSES).optional(),
  type: z.enum(SAFETY_OBSERVATION_TYPES).optional(),
  category: z.enum(SAFETY_CATEGORIES).optional(),
});
export type ListSafetyObservationsQuery = z.infer<typeof listSafetyObservationsQuerySchema>;

// --- KPIs and export ---------------------------------------------------------------------------------

export const safetyKpiQuerySchema = z
  .object({
    project_id: uuidSchema.optional(),
    /** Inclusive, company clock. Defaults to the first of January this year. */
    from: isoDateSchema.optional(),
    /** Inclusive. Defaults to today. */
    to: isoDateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
    path: ['to'],
  });
export type SafetyKpiQuery = z.infer<typeof safetyKpiQuerySchema>;

export const SAFETY_EXPORT_KINDS = ['incidents', 'observations', 'actions', 'permits', 'toolbox_talks', 'sites'] as const;
export type SafetyExportKind = (typeof SAFETY_EXPORT_KINDS)[number];

export const safetyExportQuerySchema = z.object({
  kind: z.enum(SAFETY_EXPORT_KINDS),
  project_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type SafetyExportQuery = z.infer<typeof safetyExportQuerySchema>;
