import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import { RFI_DISCIPLINES, type RfiAiDraft } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/** The only shape a model's reply may take. Anything else is thrown away, not trusted. */
const rfiReplySchema = z.object({
  subject: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(4000),
  discipline: z.enum(RFI_DISCIPLINES),
});

/**
 * Tidies a site engineer's rough question into a clear RFI (roadmap Phase 2, module 9: "RFIs drafted
 * from the drawing brain").
 *
 * The same rules as the other readers: one vendor call behind one method, the answer validated into a
 * shape or refused, and it never writes — the result pre-fills a draft that a person reads and sends.
 * The other half, "is this already answered in the drawings?", is `DocumentQaService`, which the RFI
 * service calls first. With no key configured this is simply off and the web hides the button.
 */
@Injectable()
export class RfiReader {
  private readonly logger = new Logger(RfiReader.name);
  private readonly config = env();
  private client?: OpenAI;

  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  async tidy(question: string, subject?: string): Promise<RfiAiDraft> {
    if (!this.enabled) throw ApiError.conflict('Drafting RFIs with AI is not configured on this deployment');

    let raw: string;
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You turn a construction site engineer\'s rough note into a request for information (RFI) to the design team.',
              'Reply with JSON only: {"subject": string, "question": string, "discipline": "architectural"|"structural"|"mep"|"civil"|"other"}.',
              'subject: under 80 characters, naming the element and the location if the note gives one.',
              'question: one clear, polite paragraph in English stating what is unclear or conflicting, where, and exactly what answer is needed. Keep every grid line, level, drawing number and dimension from the note unchanged.',
              'Never invent a drawing number, a dimension, a location or a person that the note does not mention.',
              'discipline: structural for concrete, steel, reinforcement and foundations; mep for electrical, plumbing, HVAC and fire; civil for roads, drainage and earthworks; architectural for finishes, doors, windows and layouts; otherwise other.',
            ].join('\n'),
          },
          { role: 'user', content: subject ? `Subject so far: ${subject}\n\n${question}` : question },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      // The vendor's own message can carry a key fragment or an account id; log ours, not theirs.
      this.logger.warn({ err: error }, 'Drafting an RFI failed at the vendor');
      throw ApiError.conflict('Could not draft that RFI');
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw ApiError.conflict('Could not draft that RFI');
    }
    const parsed = rfiReplySchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'RFI draft returned an unusable shape');
      throw ApiError.conflict('Could not draft that RFI');
    }
    return parsed.data;
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}
