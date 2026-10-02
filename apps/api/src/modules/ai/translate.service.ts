import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { languageName, type TranslateInput, type TranslateResult } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * Translation, behind one method.
 *
 * OpenAI, on price. Google's Cloud Translation API was the obvious choice and turned out to be the
 * expensive one: it bills $20 per million characters of input, where `gpt-4o-mini` does the same
 * million for about 65 cents — roughly thirty times less. At one builder that is $30 a month
 * against $1.30, which is nothing either way; at fifty tenants it is the difference between a line
 * item and a rounding error.
 *
 * What Google would have bought is latency — 100-300ms against the 1-3s measured here — and Tamil
 * that needs no glossary. Neither is worth thirty times the price for a panel that appears under a
 * field rather than blocking anything, so `TAMIL_GLOSSARY` below closes the quality gap instead.
 *
 * Still behind one method. If that trade changes, this file is the only thing that changes.
 */
@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);
  private readonly config = env();
  private client?: OpenAI;

  /**
   * Repeats are free.
   *
   * This is called while somebody types, debounced — and a debounce still fires again when they
   * pause, retype the same word and pause again. The same sentence translated twice is the same
   * answer and a second charge, so recent ones are kept. Bounded, and in memory on purpose: a
   * translation is not worth a Redis round trip, and nothing here is worth persisting.
   */
  private readonly recent = new Map<string, TranslateResult>();
  private static readonly CACHE_LIMIT = 500;

  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  async translate(input: TranslateInput): Promise<TranslateResult> {
    if (!this.enabled) {
      throw ApiError.conflict('Translation is not configured on this deployment');
    }

    const key = cacheKey(input);
    const hit = this.recent.get(key);
    if (hit) return hit;

    const result = await this.viaModel(input);

    // Oldest out first. A Map iterates in insertion order, which is the only reason this is five
    // lines rather than an LRU library.
    if (this.recent.size >= TranslateService.CACHE_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest) this.recent.delete(oldest);
    }
    this.recent.set(key, result);
    return result;
  }

  /**
   * The translation itself.
   *
   * Prompted hard to return the translation and nothing else — no preamble, no transliteration, no
   * explanation of what it did. A chat model's instinct here is to be helpful, and "Here is the
   * Tamil translation:" pasted into a site note is worse than no translation.
   */
  private async viaModel(input: TranslateInput): Promise<TranslateResult> {
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: `Translate the user's text into ${languageName(input.to)} and return only the translation.

Return the translation and nothing else: no quotes, no preamble, no notes, no romanisation, no explanation.
Keep numbers, measurements, dimensions and codes exactly as they are: 150mm, M25, C7, 10 @ 150 c/c.
Keep names of people, sites and suppliers in their original spelling.
This is a construction site note, so use the words a site actually uses rather than literary forms.
If the text is already in ${languageName(input.to)}, return it unchanged.
${input.to === 'ta' ? TAMIL_GLOSSARY : ''}`,
          },
          { role: 'user', content: input.text },
        ],
      });
      const text = response.choices[0]?.message?.content?.trim() ?? '';
      if (!text) throw ApiError.conflict('Could not translate that just now.');
      // No detection from this path. Null is honest; a guess would make the interface hide the
      // "translate" button on text it had not actually identified.
      return { text, detected: input.from ?? null };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.logger.warn({ err: error }, 'Translate failed at the model');
      throw ApiError.conflict('Could not translate that just now.');
    }
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}

/**
 * The words a general model gets wrong, pinned.
 *
 * Load-bearing, not a nice-to-have — this is what stands in for a dedicated translation service.
 * The first real pass rendered "column" as "கோலம்", the pattern drawn on a doorstep at dawn rather
 * than a structural member, and "sand" as "மண்", soil. Both are plausible dictionary matches and
 * both are wrong on a site: "the soil did not arrive" is a note somebody acts on incorrectly.
 *
 * Only the terms that appear in site notes constantly, and only where the general answer is
 * misleading rather than merely formal. Anything added here is paid for on every Tamil call, so
 * the bar is "a site would misread this", not "a purist would phrase it differently".
 */
const TAMIL_GLOSSARY = `
Use these words, which are what a Tamil site actually says:
  column -> தூண் (never கோலம்)
  sand -> மணல் (never மண், which is soil)
  slab -> ஸ்லாப்
  cement -> சிமெண்ட்
  steel / rods -> கம்பி
  shuttering / centering -> செண்டரிங்
  curing -> தண்ணீர் ஊற்றுதல்
  mason -> கொத்தனார்
  helper / labourer -> ஹெல்பர்
  foreman -> மேஸ்திரி
  plastering -> பூசு வேலை
  load (a lorry load) -> லோடு
  brick -> செங்கல்
  beam -> பீம்
  footing -> அடித்தளம்`;

function cacheKey(input: TranslateInput): string {
  return createHash('sha1')
    .update(`${input.to}|${input.from ?? ''}|${input.text}`)
    .digest('base64url');
}
