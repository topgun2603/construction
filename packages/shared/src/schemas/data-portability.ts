import { z } from 'zod';

/**
 * `POST /company-deletion`: the company's own name, typed. A checkbox can be clicked without
 * reading; typing "ARK Constructions" means the owner has looked at which company they are in.
 * Compared trimmed, because a name copied off the page brings whitespace with it.
 */
export const deletionRequestSchema = z.object({
  confirm_name: z.string().trim().min(1).max(200),
});
export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>;

/**
 * `POST /people-data/{workers|users}/:id/anonymise`. A typed confirmation, like deleting stored AI
 * data: replacing a person's name and numbers cannot be undone.
 */
export const dataExportAnonymiseSchema = z.object({
  confirm: z.literal('ANONYMISE'),
});
export type DataExportAnonymiseInput = z.infer<typeof dataExportAnonymiseSchema>;

/** `GET /people-data/search?q=`: who to export or anonymise. */
export const dataExportPersonSearchSchema = z.object({
  q: z.string().trim().max(100).default(''),
});
export type DataExportPersonSearchInput = z.infer<typeof dataExportPersonSearchSchema>;

/**
 * `POST /legal/accept`: the version on screen when the owner pressed accept. Sent rather than
 * assumed, so a page opened before the version changed cannot record acceptance of a newer text the
 * owner never saw — the API refuses a version that is not the current one.
 */
export const dataExportLegalAcceptSchema = z.object({
  document: z.literal('dpa').default('dpa'),
  version: z.string().trim().min(1).max(100),
});
export type DataExportLegalAcceptInput = z.infer<typeof dataExportLegalAcceptSchema>;
