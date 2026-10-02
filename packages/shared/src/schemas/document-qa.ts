import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Asking a question of the drawings.
 *
 * The answer to "what is the slab thickness on the third floor" is already written down. It is on
 * page 14 of a 60-page structural set that nobody is going to scroll through standing on a site
 * with one hand free — so in practice it is unknown, and somebody rings the consultant, or guesses.
 *
 * This is retrieval, not recall. The document's own text is indexed when it is uploaded; a question
 * finds the pages that match it; the model is shown **only those pages** and asked to answer from
 * them, with the page it used. Everything that makes this safe follows from that:
 *
 * - It cannot answer about a document the asker is not allowed to see, because the search runs
 *   under their own project scope before the model is involved.
 * - It cannot invent a figure that is not in the drawings, because the only text it is given is the
 *   text that was retrieved — and it is required to say when the answer is not in there.
 * - Every answer carries a document, a page and the words it came from, so the person can check it
 *   against the drawing in ten seconds. An answer nobody can check is not an answer on a site where
 *   being wrong costs a slab.
 */

export const askDocumentsSchema = z.object({
  question: z.string().trim().min(5).max(400),
  /** Narrow to one site's documents. Omitted means everything the asker can see. */
  project_id: uuidSchema.optional(),
  /** Narrow to one document — "ask this drawing" rather than "ask the register". */
  document_id: uuidSchema.optional(),
});
export type AskDocumentsInput = z.infer<typeof askDocumentsSchema>;

/** Where an answer came from. Shown with every answer, never summarised away. */
export interface DocumentCitation {
  document_id: string;
  title: string;
  /** The site it belongs to, or null for a company-wide document. */
  project_name: string | null;
  /** 1-based, as a PDF viewer counts them, so it can be opened and checked. */
  page: number;
  /** The words the answer was drawn from, trimmed to something readable. */
  snippet: string;
}

export interface AskDocumentsResult {
  /** The answer, or a plain statement that the documents do not contain one. */
  answer: string;
  /** True when the model reported the answer is not in the retrieved text. Nothing is guessed. */
  answered: boolean;
  sources: DocumentCitation[];
  /**
   * Said out loud: documents still being read, or a register with no readable text at all.
   *
   * A scanned blueprint has no text layer and never will. Telling somebody that their drawings are
   * images is more useful than an answer of "not found" that implies the drawings were searched.
   */
  caveat: string | null;
}
