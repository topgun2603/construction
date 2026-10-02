import { Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { dprSpeechSchema, type DprSpeech } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * Turns a spoken site note into the fields a daily report needs.
 *
 * Two vendor calls behind two methods, for the same reason the bill reader is one file: which model
 * does the listening is a commercial decision that will change, and the rest of the product should
 * not know.
 *
 * The transcription step is the one that matters here, and it is the reason this exists at all. A
 * supervisor in Hosur speaks Tamil. Every form in this product is in English. Those two facts have
 * cost this industry a decade of unfiled reports, and the gap between them is closeable now by
 * about two hundred lines of code.
 *
 * Both calls are bounded the same way as everywhere else in this module: the model's answer is
 * validated into a shape or refused, it never writes, and it never does arithmetic that code can
 * do instead.
 */
@Injectable()
export class VoiceReader {
  private readonly logger = new Logger(VoiceReader.name);
  private readonly config = env();
  private client?: OpenAI;

  /** False when no key is configured, which is not an error — the feature is simply off. */
  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  /**
   * Audio in, the speaker's own words out.
   *
   * No `language` hint is sent. Pinning it to Tamil would be the obvious thing and the wrong one:
   * the same site has a Tamil supervisor, a Hindi-speaking foreman and an engineer who mixes
   * English into every third sentence, and a wrong hint makes a transcript worse than no hint at
   * all. `verbose_json` is asked for so the detected language comes back and the interface can say
   * which one it heard.
   */
  async transcribe(
    file: Buffer,
    contentType: string,
  ): Promise<{ text: string; language: string | null }> {
    if (!this.enabled) {
      throw ApiError.conflict('Voice notes are not configured on this deployment');
    }

    try {
      const upload = await toFile(file, `note.${extensionFor(contentType)}`, { type: contentType });
      const response = await this.openai().audio.transcriptions.create({
        file: upload,
        model: this.config.OPENAI_TRANSCRIBE_MODEL,
        response_format: 'verbose_json',
        temperature: 0,
        /*
         * A vocabulary hint, not an instruction.
         *
         * Transcribers spell what they do not know phonetically, and construction Tamil is full of
         * words no general model has heard in context: "centering", "kottanar", "RMC". Naming them
         * once here costs nothing per call and is the difference between "centring work finished"
         * and "sent ring work finished".
         */
        prompt:
          'A construction site note. Terms that may appear: slab, centering, shuttering, RMC, M20, M25, curing, plastering, mason, kottanar, carpenter, bar bender, helper, JCB, tractor load, brick, cement bags, steel rods, excavation, footing, column, beam, lintel, waterproofing.',
      });

      const text = response.text?.trim() ?? '';
      if (text.length < 4) {
        throw ApiError.conflict('Nothing was said in that recording. Try again, a little closer.');
      }
      // `verbose_json` carries it; a model that ignores the format should not break the feature.
      const language =
        'language' in response && typeof response.language === 'string' ? response.language : null;
      return { text, language };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // The vendor's own message can carry a key fragment or an account id; log ours, not theirs.
      this.logger.warn({ err: error }, 'Transcription failed at the vendor');
      throw ApiError.conflict('Could not make out that recording. Try again, or type the report.');
    }
  }

  /**
   * The transcript, read into report fields.
   *
   * `knownTrades` is what the site's own workers are registered as. It is passed in so the model
   * says "Mason" when the tenant's word is "Mason" rather than inventing "Masonry Worker" and
   * leaving somebody with two trades that mean one thing. Anything it names outside the list still
   * comes through — the caller flags it rather than dropping it.
   */
  async readSpeech(transcript: string, knownTrades: string[]): Promise<DprSpeech> {
    if (!this.enabled) {
      throw ApiError.conflict('Voice notes are not configured on this deployment');
    }

    let raw: string;
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(knownTrades) },
          { role: 'user', content: transcript },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.warn({ err: error }, 'Reading the note failed at the vendor');
      throw ApiError.conflict('Could not read that note into a report. Fill the form by hand.');
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.logger.warn('Voice note returned something that is not JSON');
      throw ApiError.conflict('Could not read that note into a report. Fill the form by hand.');
    }

    const parsed = dprSpeechSchema.safeParse(normalise(json));
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'Voice note returned an unusable shape');
      throw ApiError.conflict('Could not read that note into a report. Fill the form by hand.');
    }
    return parsed.data;
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}

/**
 * Anything unusable becomes null or is dropped from a list, rather than failing the whole reply.
 *
 * A note that mentions a headcount and nothing else should still fill the headcount. Refusing the
 * reply because `weather` came back as "not mentioned" would throw away the part that worked.
 */
function normalise(value: unknown): Record<string, unknown> {
  const input = (value ?? {}) as Record<string, unknown>;

  const text = (name: string): string | null => {
    const raw = input[name];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed === '' || /^(n\/?a|null|none|unknown|not mentioned|not stated)$/i.test(trimmed)) {
      return null;
    }
    return trimmed.slice(0, 2000);
  };

  const rows = (name: string): unknown[] => (Array.isArray(input[name]) ? (input[name] as unknown[]) : []);

  const manpower = rows('manpower')
    .map((row) => {
      const entry = (row ?? {}) as Record<string, unknown>;
      const trade = typeof entry.trade === 'string' ? entry.trade.trim().slice(0, 80) : '';
      // "twelve" arrives as a word about as often as a number; the model is asked for digits, and
      // anything that is not one is a row we cannot use rather than a count to guess at.
      const count = Number(entry.count);
      return { trade, count };
    })
    .filter((row) => row.trade !== '' && Number.isInteger(row.count) && row.count >= 0);

  const activities = rows('activities')
    .map((row) => {
      const entry = (row ?? {}) as Record<string, unknown>;
      const activity =
        typeof entry.activity === 'string' ? entry.activity.trim().slice(0, 500) : '';
      const quantity =
        entry.quantity === null || entry.quantity === undefined
          ? undefined
          : String(entry.quantity).replace(/[^\d.]/g, '');
      const unit = typeof entry.unit === 'string' ? entry.unit.trim().slice(0, 24) : undefined;
      return {
        activity,
        // The schema wants up to eleven digits and three decimals; anything else is left blank for
        // somebody to fill rather than rounded into the report.
        ...(quantity && /^\d{1,11}(\.\d{1,3})?$/.test(quantity) ? { quantity } : {}),
        ...(unit ? { unit } : {}),
      };
    })
    .filter((row) => row.activity !== '');

  return {
    work_done: text('work_done'),
    issues: text('issues'),
    weather: text('weather'),
    manpower,
    activities,
  };
}

/** The extension the transcriber uses to pick a decoder; the content type is the real answer. */
function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  return map[contentType] ?? 'webm';
}

function systemPrompt(knownTrades: string[]): string {
  return `You read a construction site supervisor's spoken note into a daily progress report. The note may be in Tamil, Hindi, Telugu, Kannada, Malayalam, English, or a mix. Return JSON and nothing else.

Keys:
  work_done  - what was done today, in English, in the supervisor's own order and detail. Null if they did not say.
  issues     - anything that went wrong, was short, or is holding work up. Null if they said nothing was wrong.
  weather    - only if they mentioned it, in English, e.g. "heavy rain after 3pm". Null otherwise.
  manpower   - [{ "trade": string, "count": integer }] for every headcount they gave.
  activities - [{ "activity": string, "quantity": number, "unit": string }] for measured work only, e.g. 120 cubic metres of concrete, 400 square feet of plastering. Omit quantity and unit when they gave none.

Rules:
  Translate into English. Do not transliterate Tamil or Hindi words into Latin letters — "kottanar" is "mason", "thozhilali" is "labourer", "mestri" is "foreman".
  Never invent a number. If they did not say how many masons, do not list masons at all.
  Never invent an issue. "No problems today" means issues is null, not "no problems".
  Only report what they said. Do not add what a site usually does.${
    knownTrades.length > 0
      ? `\n  Use these trade names when the trade they named is one of them: ${knownTrades.join(', ')}.`
      : ''
  }`;
}
