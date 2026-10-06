import { z } from 'zod';
import { AI_FEATURES, AI_REGIONS } from '../ai';

/**
 * `PUT /ai/settings`: the master switch, one switch per feature, and the region.
 *
 * Features are sent as a full map rather than a list of the ones that are off, so a screen that was
 * opened before a new feature existed cannot switch the new one off by leaving it out — it is
 * simply absent from the map and keeps its stored value (on, unless somebody turned it off).
 */
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  features: z.record(z.enum(AI_FEATURES), z.boolean()).default({}),
  region: z.enum(AI_REGIONS).default('default'),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

/**
 * `POST /ai/data/delete`. A typed confirmation in the body, so a stray click or a replayed request
 * cannot empty the document index — re-reading every drawing takes a while.
 */
export const aiDeleteDataSchema = z.object({
  confirm: z.literal('DELETE'),
});
export type AiDeleteDataInput = z.infer<typeof aiDeleteDataSchema>;
