/**
 * Data export and deletion per company (roadmap Phase 3, compliance).
 *
 * The vocabulary the API (which enforces) and the web app (which explains) share: what an export
 * can be doing, how long its link lives, how often a company may ask for one, how long a deletion
 * waits before it becomes irreversible, and which columns never leave the building.
 *
 * Exports are named `dataExport…` / `DATA_EXPORT_…` and deletion `deletion…` / `DELETION_…`, so
 * nothing here can collide with the modules beside it.
 */

/**
 * Where a full company export is.
 *
 * - `queued`  — asked for; waiting for the background worker.
 * - `running` — the worker is building the ZIP.
 * - `ready`   — the ZIP is in storage and can be downloaded until `expires_at`.
 * - `failed`  — something went wrong; the company may ask again straight away.
 * - `expired` — the link ran out and the file was removed.
 */
export const DATA_EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

/** Statuses that count as "an export is already under way" — only one at a time per company. */
export const DATA_EXPORT_ACTIVE_STATUSES: readonly DataExportStatus[] = ['queued', 'running'];

/** How long a finished export can be downloaded. */
export const DATA_EXPORT_LINK_DAYS = 7;

/**
 * One export per company per this many hours. A full export copies every photograph the company has
 * ever taken; a button that can be pressed again a minute later is a way to make the server do that
 * all afternoon. A failed export does not count, so a failure never locks a company out for a day.
 */
export const DATA_EXPORT_COOLDOWN_HOURS = 24;

/**
 * Column names whose values never appear in an export: session and refresh-token hashes, push
 * tokens, encrypted document numbers, passwords and one-time-code secrets.
 *
 * Deliberately the same pattern as the audit log's redaction (`audit_is_secret` in the
 * full_audit_log migration), so "what the audit log hides" and "what an export leaves out" cannot
 * drift apart. Matched on the column name, so a secret column added by a later module is left out
 * without anybody remembering to list it.
 */
export const DATA_EXPORT_SECRET_COLUMN = /(token|secret|password|passcode|cipher|hash|api_key|private_key|(^|_)t?otp(_|$))/i;

export function dataExportIsSecretColumn(column: string): boolean {
  return DATA_EXPORT_SECRET_COLUMN.test(column);
}

/** When an export asked for at `now` may next be asked for, given the last one counted. */
export function dataExportNextAllowedAt(lastRequestedAt: Date): Date {
  return new Date(lastRequestedAt.getTime() + DATA_EXPORT_COOLDOWN_HOURS * 3_600_000);
}

/**
 * Days between asking to delete a company and the deletion becoming permanent. Long enough that an
 * owner who was not the one who asked — or who asked in anger — notices and cancels; short enough
 * that "delete our data" is honoured within the month data-protection rules usually allow.
 */
export const DELETION_GRACE_DAYS = 30;

/**
 * Deleting a company needs a sign-in this recent. A session left open on an office computer should
 * not be enough to schedule the end of the company: the owner proves they are at the keyboard now.
 */
export const DELETION_REAUTH_MINUTES = 10;

/** When a deletion asked for at `requestedAt` becomes permanent. */
export function deletionPurgeAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000);
}

/** Whether a session started at `startedAt` is recent enough to delete the company at `now`. */
export function deletionReauthFresh(startedAt: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - startedAt.getTime();
  return age >= -60_000 && age <= DELETION_REAUTH_MINUTES * 60_000;
}

/**
 * Where a deletion request is.
 *
 * - `pending`   — waiting out the grace period; the company is signed out and can be restored.
 * - `cancelled` — the owner (or an operator) called it off and the company is back.
 *
 * There is no `done`: once the deletion runs, the request row goes with the company. What is left
 * is a deletion certificate, which holds no personal data.
 */
export const DELETION_REQUEST_STATUSES = ['pending', 'cancelled'] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

/** Kinds of person whose data an owner can export or anonymise. */
export const DATA_EXPORT_PERSON_KINDS = ['worker', 'user'] as const;
export type DataExportPersonKind = (typeof DATA_EXPORT_PERSON_KINDS)[number];

/** The legal documents a company accepts. Only the data processing agreement today. */
export const DATA_EXPORT_LEGAL_DOCUMENTS = ['dpa'] as const;
export type DataExportLegalDocument = (typeof DATA_EXPORT_LEGAL_DOCUMENTS)[number];
