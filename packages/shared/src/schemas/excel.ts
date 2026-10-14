import { z } from 'zod';
import { IMPORT_MAX_BYTES } from '../excel';
import { IMPORT_KINDS, type ImportIssue, type ImportKind } from '../import-kinds';
import { uuidSchema } from './common';

/**
 * Excel export and import on the wire (roadmap Phase 3, item 4).
 */

/** `?format=` on an export. xlsx unless the caller asks for the CSV it always had. */
export const excelExportQuerySchema = z
  .object({
    format: z.enum(['xlsx', 'csv']).default('xlsx'),
    /** The reader's interface language: `ar` turns the sheet right to left. */
    lang: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
  })
  .passthrough();
export type ExcelExportQuery = z.infer<typeof excelExportQuerySchema>;

export const importKindSchema = z.enum(IMPORT_KINDS);

/**
 * An upload, as base64 in JSON — the same way the BOQ import travels — through a route handler on
 * the web side, so the server action's 1 MB cap never applies.
 */
export const importFileSchema = z.object({
  kind: importKindSchema,
  file_name: z
    .string()
    .trim()
    .max(200)
    .regex(/\.(xlsx|csv)$/i, 'upload an .xlsx or .csv file'),
  content_base64: z
    .string()
    .max(Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 4, 'the file is larger than 5 MB')
    .regex(/^[A-Za-z0-9+/=\s]*$/, 'expected base64'),
  /** Which worksheet of an .xlsx; the first when left out. */
  sheet: z.string().trim().max(100).optional(),
  /** 0-based row holding the headers. Found automatically when left out. */
  header_row: z.number().int().min(0).max(50).optional(),
  /** Field key → 0-based column, or null to ignore the field. Guessed from the headers when left out. */
  mapping: z.record(z.string().max(40), z.number().int().min(0).max(199).nullable()).optional(),
  /** The site an import is into (cost codes), or the default site for rows that name none (opening stock). */
  project_id: uuidSchema.optional(),
});
export type ImportFileInput = z.infer<typeof importFileSchema>;

export const importCommitSchema = importFileSchema.extend({
  /** `all`: every row or nothing. `valid_only`: the rows that pass, and a report of the rest. */
  mode: z.enum(['all', 'valid_only']).default('all'),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export interface ImportPreviewRow {
  /** The row number in the sheet, as Excel shows it. */
  row: number;
  status: 'ok' | 'error' | 'skipped';
  /** Each mapped field's cell, as text. */
  values: Record<string, string>;
  issues: ImportIssue[];
}

export interface ImportPreview {
  kind: ImportKind;
  file_name: string;
  /** Worksheets in the file, for the picker; empty for a CSV. */
  sheets: string[];
  sheet: string | null;
  header_row: number;
  headers: string[];
  /** Field key → column, as used (guessed or as sent). */
  mapping: Record<string, number | null>;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  skipped_rows: number;
  /** The first rows, for the screen; every row with an error is in `errors`. */
  rows: ImportPreviewRow[];
  errors: Array<{ row: number; field: string | null; message: string }>;
}

export interface ImportResult {
  kind: ImportKind;
  mode: 'all' | 'valid_only';
  total_rows: number;
  imported: number;
  /** Rows not imported because they had errors (valid_only), or every row when an all-or-nothing import failed. */
  failed: number;
  /** The example row and blank rows. */
  skipped: number;
  errors: Array<{ row: number; field: string | null; message: string }>;
}
