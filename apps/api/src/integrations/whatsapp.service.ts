import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

/**
 * WhatsApp Cloud API client (spec §11).
 *
 * Only pre-approved templates can be sent to a number that has not messaged the
 * business first, so every send here is a template send. The template names and
 * their parameter order must match what is approved in the Meta console — the
 * constants below are that contract.
 *
 * With no token configured the client logs what it would have sent and reports
 * success. That keeps local development and the e2e suite from needing Meta
 * credentials, and makes the summary job inspectable without a phone.
 */

export const TEMPLATES = {
  dailySiteSummary: 'daily_site_summary',
  dprReminder: 'dpr_reminder',
  indentStatus: 'indent_status',
  wageSheetSummary: 'wage_sheet_summary',
} as const;

export type TemplateName = (typeof TEMPLATES)[keyof typeof TEMPLATES];

export interface TemplateMessage {
  /** E.164 without the plus, as stored on users.phone. */
  to: string;
  template: TemplateName;
  /** Positional body parameters, in the order the approved template declares. */
  params: string[];
  languageCode?: string;
}

export interface SendResult {
  ok: boolean;
  delivered: number;
  dryRun: boolean;
  error?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly config = env();

  get configured(): boolean {
    return Boolean(this.config.WHATSAPP_TOKEN && this.config.WHATSAPP_PHONE_ID);
  }

  async send(message: TemplateMessage): Promise<SendResult> {
    if (!this.configured) {
      this.logger.log(
        { to: message.to, template: message.template, params: message.params },
        'WhatsApp dry run - no WHATSAPP_TOKEN configured',
      );
      return { ok: true, delivered: 0, dryRun: true };
    }

    const base = `https://graph.facebook.com/${this.config.WHATSAPP_API_VERSION}`;
    const url = `${base}/${this.config.WHATSAPP_PHONE_ID}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: message.template,
            language: { code: message.languageCode ?? 'en' },
            components: [
              {
                type: 'body',
                parameters: message.params.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
        // A hung Meta request must not hold a worker slot open indefinitely.
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(
          { status: response.status, to: message.to, template: message.template, body },
          'WhatsApp send rejected',
        );
        return { ok: false, delivered: 0, dryRun: false, error: `${response.status}: ${body}` };
      }

      return { ok: true, delivered: 1, dryRun: false };
    } catch (error) {
      this.logger.warn({ err: error, to: message.to }, 'WhatsApp send failed');
      return { ok: false, delivered: 0, dryRun: false, error: (error as Error).message };
    }
  }

  /** Sends to many numbers. One bad number never fails the whole batch. */
  async sendMany(messages: TemplateMessage[]): Promise<SendResult> {
    const results = await Promise.all(messages.map((message) => this.send(message)));
    const delivered = results.reduce((sum, result) => sum + result.delivered, 0);
    const failed = results.filter((result) => !result.ok);
    return {
      ok: failed.length === 0,
      delivered,
      dryRun: results.length > 0 && results.every((result) => result.dryRun),
      ...(failed.length > 0 ? { error: `${failed.length} of ${messages.length} failed` } : {}),
    };
  }
}
