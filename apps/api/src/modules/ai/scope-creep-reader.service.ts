import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { AiGateway } from './ai-gateway.service';

/** What the model made of a sentence the keyword rules flagged. */
export interface ScopeCreepVerdict {
  /** `unknown` when no model was asked or it could not answer — the rules' finding then stands. */
  extraWork: 'yes' | 'no' | 'unknown';
  /** One line, in the site's own terms: "Extra window in the master bedroom". */
  summary: string | null;
}

/**
 * A second opinion on the scope-creep catcher's keyword hits (roadmap: change orders through the
 * scope-creep catcher).
 *
 * Only ever asked about text the keyword rules already flagged, never about every report: that
 * keeps the cost to a sentence now and then, and means the catcher works the same with no key at
 * all — the rules decide what is looked at, the model only weeds out the false alarms and names
 * the work. Any failure answers `unknown`, so a model outage costs a false alarm, never a miss.
 */
@Injectable()
export class ScopeCreepReader {
  private readonly logger = new Logger(ScopeCreepReader.name);
  private readonly config = env();

  constructor(private readonly gateway: AiGateway) {}


  async judge(tenantId: string, excerpt: string, context: string): Promise<ScopeCreepVerdict> {
    // Off, or no key: `unknown`, and the keyword finding stands as it always did without a model.
    if (!(await this.gateway.isOn(tenantId, 'suggestions'))) return { extraWork: 'unknown', summary: null };
    try {
      const client = await this.gateway.client(tenantId, 'suggestions');
      const response = await client.chat.completions.create(
        {
          model: this.config.OPENAI_ASK_MODEL,
          temperature: 0,
          max_tokens: 120,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You read notes from a building site for a contractor. Decide whether the flagged sentence describes work that is extra to, or different from, what was agreed with the client — something the contractor should raise a change order (variation) for.
Deliveries, routine progress, rework of the contractor's own mistakes and ordinary site problems are not.
Answer as JSON: {"extra_work": true|false, "summary": "<at most 10 words naming the extra work, or empty>"}`,
            },
            { role: 'user', content: `Flagged sentence: ${excerpt}\n\nWhole note:\n${context.slice(0, 2000)}` },
          ],
        },
        // A daily report waits on this; it does not wait long.
        { timeout: 8000, maxRetries: 0 },
      );
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as {
        extra_work?: unknown;
        summary?: unknown;
      };
      const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 160) : null;
      if (parsed.extra_work === true) return { extraWork: 'yes', summary };
      if (parsed.extra_work === false) return { extraWork: 'no', summary: null };
      return { extraWork: 'unknown', summary };
    } catch (error) {
      this.logger.warn({ err: error }, 'Scope-creep check failed at the model; keeping the keyword finding');
      return { extraWork: 'unknown', summary: null };
    }
  }
}
