import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { AiGateway } from '../ai/ai-gateway.service';

/**
 * Rewords a forecast's explanation into plain language — and nothing else.
 *
 * The figures are worked out in `forecastSite` and written into the template sentence first; the
 * model only gets that sentence back to say more naturally. Its answer is thrown away, and the
 * template kept, if it contains any number the template did not, so a model that invents "23%"
 * can never put it in front of an owner (roadmap design rule: every AI-made record must be
 * checkable against where it came from).
 *
 * Only flagged sites are sent, which keeps the cost to a handful of short calls a night.
 */
@Injectable()
export class ForecastExplainer {
  private readonly logger = new Logger(ForecastExplainer.name);
  private readonly config = env();

  constructor(private readonly gateway: AiGateway) {}

  /** The reworded sentence, or null to keep the template. */
  async reword(tenantId: string, siteName: string, template: string): Promise<string | null> {
    // Off for this company (or no key): the template sentence stands, and nothing is sent. This runs
    // in the nightly job, so this check is what keeps a switched-off company out of the vendor's logs.
    if (!(await this.gateway.isOn(tenantId, 'suggestions'))) return null;
    try {
      const client = await this.gateway.client(tenantId, 'suggestions');
      const response = await client.chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0.2,
        max_tokens: 160,
        messages: [
          {
            role: 'system',
            content:
              'You rewrite a construction cost warning for a busy site owner, in at most two short sentences. ' +
              'Use only the facts and numbers given, exactly as written. Do not add numbers, causes, advice or greetings.',
          },
          { role: 'user', content: `Site: ${siteName}\nFacts: ${template}` },
        ],
      });
      const text = response.choices[0]?.message?.content?.trim() ?? '';
      return acceptable(text, template) ? text : null;
    } catch (error) {
      // A warning without nicer wording is still a warning; never fail the forecast over this.
      this.logger.warn({ err: error }, 'Forecast explanation could not be reworded');
      return null;
    }
  }

}

/**
 * Short, and every number in it is one the template already had.
 *
 * Numbers are compared with their separators stripped, so "4.6M" in the template allows "4.6M"
 * back but not "4.7M", and "1,250" matches "1250".
 */
export function acceptable(text: string, template: string): boolean {
  if (text.length === 0 || text.length > 320) return false;
  const numbers = (value: string) =>
    new Set((value.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, '').replace(/,/g, '')));
  const allowed = numbers(template);
  return [...numbers(text)].every((n) => allowed.has(n));
}
