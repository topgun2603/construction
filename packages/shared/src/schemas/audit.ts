import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common';

/**
 * The audit log (roadmap Phase 3): every create, update and delete, plus the business events
 * services record by name (`expense.approved`, `wage_period.finalised`).
 */

/** What the trigger writes. Anything else in `action` is a named business event. */
export const AUDIT_ROW_ACTIONS = ['create', 'update', 'delete'] as const;
export type AuditRowAction = (typeof AUDIT_ROW_ACTIONS)[number];

/** `api_key`: a write made through the public API, recorded as the key (its name is shown). */
export const AUDIT_ACTOR_TYPES = ['user', 'system', 'platform', 'api_key'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const auditQuerySchema = z
  .object({
    /** Inclusive days in the company's time zone. */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    actor_id: uuidSchema.optional(),
    /** Table name, e.g. `workers`. */
    entity: z
      .string()
      .regex(/^[a-z_]{1,64}$/)
      .optional(),
    entity_id: uuidSchema.optional(),
    /** `create` | `update` | `delete` | `event` (any named business event) | an exact event name. */
    action: z
      .string()
      .regex(/^[a-z_.]{1,64}$/)
      .optional(),
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
    path: ['to'],
  });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditEntry {
  id: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  /** The row's name or title when it was written, if it has one. */
  entity_label: string | null;
  actor_type: AuditActorType;
  actor: { id: string; name: string } | null;
  /** For an update, which fields changed. */
  changed_fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
}
