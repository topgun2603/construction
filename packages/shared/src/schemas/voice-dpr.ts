import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common';
import { dprActivitySchema, dprManpowerSchema } from './site';

/**
 * Speaking a daily report instead of typing one.
 *
 * A site supervisor at six in the evening has a phone, dusty hands and twenty minutes of light
 * left. Typing a report into a form is the reason reports do not get filed — and an unfiled report
 * is a day of a project with no record of what happened on it. Saying two sentences out loud is
 * something somebody will actually do.
 *
 * Two model calls, each with one job, and the same division of labour as everything else here:
 *
 * 1. **Transcribe.** Audio in, the speaker's own words out, in whatever language they spoke. Tamil
 *    is the one this was built for; Hindi, Telugu, Kannada and English all work the same way.
 * 2. **Structure.** The transcript becomes a draft: work done, issues, headcount by trade. The
 *    model fills fields; it does not file anything.
 *
 * Nothing is saved. What comes back pre-fills the report form, and a person reads it, corrects it
 * and submits it. That is not a limitation to be designed away later — a spoken "twelve masons"
 * heard as "twenty masons" has to be somebody's typo to catch, not a number that walked into the
 * wage bill on its own.
 */

/** A voice note already uploaded through `/uploads/presign` under the `dpr_voice` kind. */
export const transcribeDprSchema = z.object({
  s3_key: z.string().min(1).max(512),
  /** The site it is about, so trades can be matched against the people who actually work there. */
  project_id: uuidSchema,
  /** The day being reported on. Defaults to today; a note recorded late at night is about today. */
  report_date: isoDateSchema.optional(),
});
export type TranscribeDprInput = z.infer<typeof transcribeDprSchema>;

/**
 * What the structuring model is asked for, and the only shape the API will pass on.
 *
 * Every text field is nullable, and the lists may be empty. A supervisor who says only "slab
 * poured, no issues" should get a draft with one field filled and the rest left alone — a model
 * made to answer every question will invent a headcount, and an invented headcount in a report
 * that feeds the wage bill is worse than a blank one.
 */
export const dprSpeechSchema = z.object({
  work_done: z.string().trim().max(2000).nullable(),
  issues: z.string().trim().max(2000).nullable(),
  /** "Heavy rain from 3pm" — mentioned often, and the reason half the issues exist. */
  weather: z.string().trim().max(120).nullable(),
  manpower: z.array(dprManpowerSchema).max(20),
  activities: z.array(dprActivitySchema).max(20),
});
export type DprSpeech = z.infer<typeof dprSpeechSchema>;

/** What the endpoint returns: the words that were said, and the draft they became. */
export interface VoiceDprResult {
  /**
   * The transcript, verbatim, in the language it was spoken.
   *
   * Shown above the draft rather than thrown away. It is the only part of this a supervisor can
   * check against their own memory — if the draft says "ten carpenters" and the transcript says
   * "ten plumbers", the mistake is visible in one glance instead of being filed.
   */
  transcript: string;
  /** What the transcriber heard it as: `ta`, `hi`, `en`. Null when the model does not report one. */
  language: string | null;
  /**
   * The draft, in English.
   *
   * Not the speaker's language, deliberately. Trades, materials and site names in this product are
   * stored in one language, the office reads reports in that language, and a ledger half in Tamil
   * script and half in English is one nobody can total. The transcript keeps the original words;
   * the record stays consistent. A Tamil-speaking supervisor sees both.
   */
  draft: {
    report_date: string;
    weather: string | null;
    work_done: string | null;
    issues: string | null;
    manpower: { trade: string; count: number }[];
    activities: { activity: string; quantity?: string; unit?: string }[];
  };
  /** Said out loud when a trade was named that nobody on this site has. Never silently dropped. */
  caveats: string[];
}
