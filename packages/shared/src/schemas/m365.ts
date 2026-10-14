import { z } from 'zod';
import { MEETING_ACTION_STATUSES } from '../m365';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Microsoft 365 connection, "send by email", and site meetings. See `../m365.ts` for the why.
 */

const emailSchema = z.string().trim().toLowerCase().email().max(254);

// --- the connection --------------------------------------------------------------------------------

/** `POST /integrations/m365/connect` — which mailbox to suggest on Microsoft's sign-in page. */
export const m365ConnectSchema = z.object({
  login_hint: emailSchema.optional(),
});
export type M365ConnectInput = z.infer<typeof m365ConnectSchema>;

/**
 * `POST /integrations/m365/callback` — what Microsoft sent the browser back with, posted by the web
 * page at the redirect URI *with the session of the person who started*. The API matches `state`
 * to a request that person made, so a connect link cannot be finished by somebody else.
 */
export const m365CallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(16).max(256),
});
export type M365CallbackInput = z.infer<typeof m365CallbackSchema>;

/** `PUT /integrations/m365/settings`. */
export const m365SettingsSchema = z.object({
  /** Put site milestones and open RFIs' due dates in the connected calendar, and keep them current. */
  calendar_sync: z.boolean(),
});
export type M365SettingsInput = z.infer<typeof m365SettingsSchema>;

/**
 * `POST …/email` on an RFI, a submittal or a change order. With no `to`, the record's own addressee
 * (the RFI's designer, the submittal's reviewer, the site's client users). `note` is a line from the
 * sender put above the standard text.
 */
export const m365SendEmailSchema = z.object({
  to: z.array(emailSchema).min(1).max(10).optional(),
  cc: z.array(emailSchema).max(10).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type M365SendEmailInput = z.infer<typeof m365SendEmailSchema>;

// --- meetings --------------------------------------------------------------------------------------

/** Somebody on the team (by id; their address is read from their profile), or anybody by address. */
export const meetingAttendeeSchema = z.union([
  z.object({ user_id: uuidSchema }).strict(),
  z.object({ email: emailSchema, name: z.string().trim().max(200).optional() }).strict(),
]);
export type MeetingAttendeeInput = z.infer<typeof meetingAttendeeSchema>;

/** An ISO instant with its offset — `2026-10-07T10:00:00+05:30` or `…Z`. */
const instantSchema = z.string().datetime({ offset: true });

/** Twelve hours: a site meeting, not a conference. Also stops a typo'd year from booking a decade. */
const MEETING_MAX_MS = 12 * 60 * 60 * 1000;

const meetingFields = {
  title: z.string().trim().min(1).max(200),
  starts_at: instantSchema,
  ends_at: instantSchema,
  location: z.string().trim().max(300).nullable().optional(),
  agenda: z.string().trim().max(10_000).nullable().optional(),
  attendees: z.array(meetingAttendeeSchema).max(50).optional(),
};

function endsAfterStart(value: { starts_at?: string; ends_at?: string }, ctx: z.RefinementCtx): void {
  if (!value.starts_at || !value.ends_at) return;
  const span = Date.parse(value.ends_at) - Date.parse(value.starts_at);
  if (span <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'must be after the start' });
  else if (span > MEETING_MAX_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'a meeting is at most 12 hours' });
  }
}

export const meetingCreateSchema = z
  .object({ project_id: uuidSchema, ...meetingFields })
  .superRefine(endsAfterStart);
export type MeetingCreateInput = z.infer<typeof meetingCreateSchema>;

/** Omitted keeps what is stored. `attendees`, given, replaces the list. Times move together. */
export const meetingUpdateSchema = z
  .object({
    title: meetingFields.title.optional(),
    starts_at: instantSchema.optional(),
    ends_at: instantSchema.optional(),
    location: meetingFields.location,
    agenda: meetingFields.agenda,
    attendees: meetingFields.attendees,
    /** What was said and decided. Writing it marks a scheduled meeting held. */
    minutes: z.string().trim().max(50_000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.starts_at === undefined) !== (value.ends_at === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'send the start and the end together' });
    }
    endsAfterStart(value, ctx);
  });
export type MeetingUpdateInput = z.infer<typeof meetingUpdateSchema>;

export const meetingListQuerySchema = z.object({
  project_id: uuidSchema.optional(),
});
export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>;

export const meetingActionItemSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  /** Somebody on the team… */
  owner_user_id: uuidSchema.nullable().optional(),
  /** …or a name, for the consultant who took the action away. */
  owner_name: z.string().trim().max(200).nullable().optional(),
  due_on: isoDateSchema.nullable().optional(),
});
export type MeetingActionItemInput = z.infer<typeof meetingActionItemSchema>;

export const meetingActionItemUpdateSchema = meetingActionItemSchema.partial().extend({
  status: z.enum(MEETING_ACTION_STATUSES).optional(),
});
export type MeetingActionItemUpdateInput = z.infer<typeof meetingActionItemUpdateSchema>;

/** `POST /meetings/:id/minutes/send` — a line above the minutes, optional. */
export const meetingSendMinutesSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type MeetingSendMinutesInput = z.infer<typeof meetingSendMinutesSchema>;
