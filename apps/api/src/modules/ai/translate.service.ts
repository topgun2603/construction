import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { languageName, type TranslateInput, type TranslateResult } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * Translation, behind one method.
 *
 * Two vendors, because of what is actually installed. Google's Cloud Translation API is the right
 * answer — it is cheap, it is fast, and its Tamil is better than a general model's — but it has to
 * be switched on in a Google Cloud project and given its own key. So this prefers it when a key is
 * configured and falls back to the model that is already working, which means the feature is useful
 * on the day it ships rather than on the day somebody remembers to enable an API.
 *
 * Behind one method, so nothing else in the product knows or cares which one answered.
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
    return Boolean(this.config.GOOGLE_TRANSLATE_API_KEY || this.config.OPENAI_API_KEY);
  }

  async translate(input: TranslateInput): Promise<TranslateResult> {
    if (!this.enabled) {
      throw ApiError.conflict('Translation is not configured on this deployment');
    }

    const key = cacheKey(input);
    const hit = this.recent.get(key);
    if (hit) return hit;

    const result = this.config.GOOGLE_TRANSLATE_API_KEY
      ? await this.viaGoogle(input)
      : await this.viaModel(input);

    // Oldest out first. A Map iterates in insertion order, which is the only reason this is five
    // lines rather than an LRU library.
    if (this.recent.size >= TranslateService.CACHE_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest) this.recent.delete(oldest);
    }
    this.recent.set(key, result);
    return result;
  }

  /** Google Cloud Translation v2. One POST, an API key, no SDK. */
  private async viaGoogle(input: TranslateInput): Promise<TranslateResult> {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(
      this.config.GOOGLE_TRANSLATE_API_KEY!,
    )}`;

    let payload: GoogleResponse;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: input.text,
          target: input.to,
          ...(input.from ? { source: input.from } : {}),
          // Plain text, not HTML: a site note is prose, and asking for HTML means getting `&#39;`
          // back in the middle of somebody's sentence.
          format: 'text',
        }),
      });
      if (!response.ok) {
        // The body carries the reason that matters — "API has not been used in project ... before
        // or it is disabled" is the one somebody can act on.
        const body = await response.text();
        this.logger.warn({ status: response.status, body: body.slice(0, 300) }, 'Translate refused');
        throw ApiError.conflict('Could not translate that just now.');
      }
      payload = (await response.json()) as GoogleResponse;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.logger.warn({ err: error }, 'Translate failed at the vendor');
      throw ApiError.conflict('Could not translate that just now.');
    }

    const first = payload.data?.translations?.[0];
    if (!first?.translatedText) throw ApiError.conflict('Could not translate that just now.');
    return {
      text: decodeEntities(first.translatedText),
      detected: first.detectedSourceLanguage ?? input.from ?? null,
    };
  }

  /**
   * The fallback: the model that is already configured.
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
 * Not a nice-to-have. The first real pass translated "column" as "கோலம்" — which is the pattern
 * drawn on a doorstep at dawn, not a structural member — and "sand" as "மண்", soil. Both are
 * plausible dictionary matches and both are wrong on a site, and a note saying "the soil did not
 * arrive" is a note somebody acts on incorrectly.
 *
 * Only the terms that appear in site notes constantly, and only where the general answer is
 * misleading rather than merely formal. This is also the clearest argument for configuring the
 * Cloud Translation API, whose construction Tamil needs none of this.
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

interface GoogleResponse {
  data?: {
    translations?: { translatedText?: string; detectedSourceLanguage?: string }[];
  };
}

function cacheKey(input: TranslateInput): string {
  return createHash('sha1')
    .update(`${input.to}|${input.from ?? ''}|${input.text}`)
    .digest('base64url');
}

/**
 * Google returns `&#39;` and `&amp;` even with `format: 'text'`.
 *
 * Only the five that appear. A full HTML entity decoder here would be a dependency earning its
 * keep on a problem that is five characters wide.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
