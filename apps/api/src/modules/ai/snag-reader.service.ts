import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { SNAG_PRIORITIES, type SnagSuggestion } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';
import { AiGateway } from './ai-gateway.service';

/** The only shape a model's reply may take. Anything else is thrown away, not trusted. */
const snagReplySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  trade: z.string().trim().max(60).nullable().optional(),
  priority: z.enum(SNAG_PRIORITIES),
});

export interface SnagReading extends SnagSuggestion {
  description: string | null;
}

/**
 * Reads a site note ("water coming through the ceiling of 204, near the AC drain") into a snag's
 * title, trade and priority (QA/QC, roadmap Phase 2, module 7).
 *
 * The same rules as the bill and voice readers: one vendor call behind one method, the answer
 * validated into a shape or refused, and it never writes — the result pre-fills a *draft* snag
 * that a person confirms before it is anybody's job. When no key is configured this is simply off,
 * and the caller falls back to `suggestSnagFromNote`, the keyword rules in @sitebook/shared.
 */
@Injectable()
export class SnagReader {
  private readonly logger = new Logger(SnagReader.name);
  private readonly config = env();

  constructor(private readonly gateway: AiGateway) {}

  /** False when no key is configured, which is not an error — the feature is simply off. */

  /**
   * `trades` are the company's own words for trades (from its snags so far plus the standard
   * list), passed so the model says "Plumbing" rather than inventing "Sanitary works" and leaving
   * the report with two rows that mean one thing.
   */
  async read(tenantId: string, note: string, trades: readonly string[]): Promise<SnagReading> {
    const client = await this.gateway.client(
      tenantId,
      'suggestions',
      'Snag suggestions are not configured on this deployment',
    );

    let raw: string;
    try {
      const response = await client.chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You turn a construction site note into a defect (snag) record.',
              'Reply with JSON only: {"title": string, "description": string|null, "trade": string|null, "priority": "low"|"medium"|"high"|"critical"}.',
              'title: under 80 characters, in English, saying what is wrong and where if the note says where.',
              'description: the note restated clearly in English, or null if the title says it all.',
              `trade: one of ${trades.join(', ')} — or null if the note does not say.`,
              'priority: critical for anything structural or a safety hazard (exposed live wires, unsafe edges); high for leaks, cracks and anything that blocks other work; low for cosmetic touch-ups; otherwise medium.',
              'Never invent a location, a measurement or a person that the note does not mention.',
            ].join('\n'),
          },
          { role: 'user', content: note },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      // The vendor's own message can carry a key fragment or an account id; log ours, not theirs.
      this.logger.warn({ err: error }, 'Reading a snag note failed at the vendor');
      throw ApiError.conflict('Could not read that note into a snag');
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw ApiError.conflict('Could not read that note into a snag');
    }
    const parsed = snagReplySchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'Snag note returned an unusable shape');
      throw ApiError.conflict('Could not read that note into a snag');
    }
    return {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      trade: parsed.data.trade ?? null,
      priority: parsed.data.priority,
    };
  }

}
