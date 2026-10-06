import { Injectable, Logger } from '@nestjs/common';
import {
  SAFETY_CATEGORIES,
  SAFETY_OBSERVATION_TYPES,
  SAFETY_SEVERITIES,
  type SafetyCategory,
  type SafetyObservationType,
  type SafetySeverity,
  type SafetySuggestion,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { AiGateway } from './ai-gateway.service';

/**
 * A first read of a safety observation: is it an unsafe act, an unsafe condition or something done
 * well, which category, and how bad.
 *
 * Only a suggestion, like everything in this module. The caller has a keyword fallback
 * (`safetySuggestFromNote`) for when no key is configured or the vendor fails, and the person
 * reporting can change every field — the model never closes, assigns or escalates anything.
 */
@Injectable()
export class SafetyReader {
  private readonly logger = new Logger(SafetyReader.name);
  private readonly config = env();

  constructor(private readonly gateway: AiGateway) {}

  /** False when no key is configured, which is not an error — the rules take over. */

  /** Null when the model is off, fails, or answers outside the vocabulary; the caller falls back. */
  async classify(tenantId: string, note: string): Promise<SafetySuggestion | null> {
    // Off, or no key: null, and the keyword rules classify it instead.
    if (!(await this.gateway.isOn(tenantId, 'suggestions'))) return null;
    try {
      const client = await this.gateway.client(tenantId, 'suggestions');
      const response = await client.chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: note.slice(0, 2000) },
        ],
      });
      const raw = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
      const type = pick(raw.type, SAFETY_OBSERVATION_TYPES) as SafetyObservationType | null;
      const category = pick(raw.category, SAFETY_CATEGORIES) as SafetyCategory | null;
      const severity = pick(raw.severity, SAFETY_SEVERITIES) as SafetySeverity | null;
      if (!type || !category || !severity) {
        this.logger.warn({ raw }, 'Safety classification outside the vocabulary');
        return null;
      }
      return { type, category, severity };
    } catch (error) {
      // The vendor's own message can carry a key fragment; log ours.
      this.logger.warn({ err: (error as Error).name }, 'Safety classification failed at the vendor');
      return null;
    }
  }

}

function pick(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

const SYSTEM_PROMPT = `You classify a safety observation written or spoken on a construction site. The note may be in English, Hindi, Tamil, Arabic or a mix. Return JSON with exactly three keys and nothing else:
  type     - "unsafe_act" (something a person did or failed to do), "unsafe_condition" (something about the site, equipment or materials), or "positive" (good practice worth recognising).
  category - one of: ${SAFETY_CATEGORIES.join(', ')}.
  severity - "low", "medium", "high" or "critical". Critical means it could kill someone today: a fall from height without protection, an unshored deep trench, exposed live electrics, a suspended load over people. Positive observations are "low".
Choose "other" when no category fits. Do not explain.`;
