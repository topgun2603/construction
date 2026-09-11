import { z } from 'zod';
import { clientIdSchema, uuidSchema } from './common';

/**
 * The site conversation, and the documents attached to a job.
 *
 * Both exist for the same reason: everything a client asks and everything they are sent currently
 * happens on WhatsApp, where it leaves no record against the site. Six months later, when somebody
 * asks who approved the granite, the answer is in a chat thread on a phone that has been replaced.
 */

/**
 * Who a message is for.
 *
 * `team` is there because a supervisor noting that a client has changed their mind twice, or a
 * project manager asking accounts whether this client pays late, is a normal part of running a job
 * — and a portal with nowhere to say it sends those conversations back to WhatsApp, taking the
 * useful ones with them.
 *
 * `direct` is the same argument one step further. The most ordinary thing anybody does on a site is
 * ask one named person something, and a thread that can only broadcast cannot carry that. It names
 * a recipient and is visible to exactly two people — the author and them — whichever side of the
 * client/team line either of them is on.
 */
export const MESSAGE_AUDIENCES = ['everyone', 'team', 'direct'] as const;
export type MessageAudience = (typeof MESSAGE_AUDIENCES)[number];

export const messageAttachmentSchema = z.object({
  s3_key: z.string().trim().min(1).max(512),
  content_type: z.string().regex(/^(image|video|application)\/[\w.+-]+$/, 'not a file we store'),
  size_bytes: z.number().int().positive(),
  /**
   * What the file was called. A photograph needs none; a PDF is all name — "quote-revised-2.pdf"
   * is the only thing distinguishing it from the four others somebody sent the same afternoon.
   */
  filename: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(280).optional(),
});

export const postMessageSchema = z
  .object({
    body: z.string().trim().max(4000),
    audience: z.enum(MESSAGE_AUDIENCES).default('everyone'),
    /** Required for `direct`, and refused for anything else. */
    recipient_id: uuidSchema.optional(),
    attachments: z.array(messageAttachmentSchema).max(10).default([]),
    client_id: clientIdSchema.optional(),
  })
  .refine((value) => value.body.length > 0 || value.attachments.length > 0, {
    // A photo with no words is a perfectly good message. Nothing at all is not.
    message: 'write something, or attach something',
    path: ['body'],
  })
  .refine((value) => (value.audience === 'direct') === (value.recipient_id !== undefined), {
    /*
     * Both halves, so neither mistake can happen.
     *
     * A `direct` with nobody named has no one to deliver to. A recipient on a broadcast is worse:
     * somebody meant it for one person and it went to the whole job, which for a team note about a
     * client is exactly the leak this feature must not have.
     */
    message: 'a direct message names one person, and only a direct message may name one',
    path: ['recipient_id'],
  });
export type PostMessageInput = z.infer<typeof postMessageSchema>;

/**
 * How long somebody has to take back what they wrote.
 *
 * Thirty minutes is the length of a mistake: the wrong site, the wrong person, a half-finished
 * sentence sent by a thumb. Past that, somebody has almost certainly read it, and letting a message
 * disappear from a job's record hours later is how a thread stops being evidence of what was
 * actually said — which is the whole reason this exists instead of WhatsApp.
 *
 * The window binds everybody, moderators included. `projects.manage` decides *whose* message
 * somebody may take down, never *how long* they have to do it: a record that a senior enough person
 * can still edit a week later is not a record, and the client on the other side of the thread has
 * no way of knowing it happened.
 */
export const MESSAGE_DELETE_WINDOW_MINUTES = 30;

/** Whether the author may still take this back. */
export function withinDeleteWindow(createdAt: string | Date, now: Date = new Date()): boolean {
  const posted = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(posted.getTime())) return false;
  return now.getTime() - posted.getTime() <= MESSAGE_DELETE_WINDOW_MINUTES * 60_000;
}

/**
 * How far somebody has read one site's conversation.
 *
 * A watermark, not a list of message ids: "seen" is a question about a point in time, and a phone
 * that scrolled through forty messages should say so once rather than forty times.
 */
export const markMessagesReadSchema = z.object({
  /** Defaults to now. Never moves backwards, and never past the present. */
  up_to: z.string().datetime().optional(),
});
export type MarkMessagesReadInput = z.infer<typeof markMessagesReadSchema>;

export const listMessagesQuerySchema = z.object({
  /** Oldest message to return, for paging back through a long thread. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/**
 * What a document is, in the words a builder uses.
 *
 * Not a free-text label: the category is what makes "show me the approvals" possible, and a list
 * where one person typed "Drawing" and another "drawings" answers that question wrongly.
 */
export const DOCUMENT_CATEGORIES = [
  'drawing',
  'contract',
  'approval',
  'permit',
  'invoice',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const createDocumentSchema = z.object({
  /** Null for something that belongs to the company rather than one job. */
  project_id: uuidSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default('other'),
  s3_key: z.string().trim().min(1).max(512),
  content_type: z.string().trim().min(1).max(160),
  size_bytes: z.number().int().positive(),
  /**
   * Whether the client can open it. Off by default: a contract or an internal costing becoming
   * visible because somebody forgot to untick a box is not a mistake you get to take back.
   */
  visible_to_client: z.boolean().default(false),
  /**
   * Set to file this as a new revision of an existing document. The title and category come from
   * the document being revised, so revision 4 of a slab drawing cannot quietly become a contract.
   */
  supersedes_id: uuidSchema.optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    visible_to_client: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const listDocumentsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  /** Include superseded revisions. Off by default: the current drawing is what people want. */
  include_history: z.coerce.boolean().default(false),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
