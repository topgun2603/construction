import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { billDraftSchema, EXPENSE_CATEGORIES, type BillDraft } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * Reads a photographed bill into the fields an expense form needs.
 *
 * One vendor call behind one method, on purpose. Which model reads the picture is a commercial
 * decision that will change — the rest of the product should not know who is doing the reading, and
 * swapping providers should be this file and nothing else.
 *
 * Three rules this service keeps, because a model is a guess and a ledger is not:
 *
 * 1. **It never writes.** The result is a draft that pre-fills a form somebody submits. A misread
 *    ₹12.50 for ₹1,250 is then a typo a person catches rather than a wrong number in the accounts.
 * 2. **It never does arithmetic.** The model returns the amount as the characters printed on the
 *    bill; converting rupees to integer paise is done here, in code that is tested.
 * 3. **Its answer is validated, not trusted.** The reply is parsed against a zod schema and
 *    anything that does not fit becomes null — an unreadable field says so instead of arriving as
 *    a confident invention.
 */
@Injectable()
export class BillReader {
  private readonly logger = new Logger(BillReader.name);
  private readonly config = env();
  private client?: OpenAI;

  /** False when no key is configured, which is not an error — the feature is simply off. */
  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  async read(image: Buffer, contentType: string): Promise<BillDraft> {
    if (!this.enabled) {
      throw ApiError.conflict('Bill scanning is not configured on this deployment');
    }

    // A data URL rather than a public link: the bucket is private, and handing a vendor a signed
    // URL would put somebody's invoice behind a credential we do not control the lifetime of.
    const dataUrl = `data:${contentType};base64,${image.toString('base64')}`;

    let raw: string;
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_VISION_MODEL,
        // Low: a bill is text on paper, and the answer does not improve with invention.
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this bill.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      // The vendor's own message can carry a key fragment or an account id; log ours, not theirs.
      this.logger.warn({ err: error }, 'Bill scan failed at the vendor');
      throw ApiError.conflict('Could not read that bill. Enter it by hand.');
    }

    return this.parse(raw);
  }

  /**
   * Validates the reply. A model that answers in prose, or with a category nobody defined, or with
   * an amount containing a currency symbol, must not take the form down with it.
   */
  private parse(raw: string): BillDraft {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.logger.warn('Bill scan returned something that is not JSON');
      throw ApiError.conflict('Could not read that bill. Enter it by hand.');
    }

    const parsed = billDraftSchema.safeParse(normalise(json));
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'Bill scan returned an unusable shape');
      throw ApiError.conflict('Could not read that bill. Enter it by hand.');
    }
    return parsed.data;
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}

/**
 * Anything the model offered that we cannot use becomes null rather than a validation failure.
 *
 * The difference matters: a bill with a readable total and an unreadable GSTIN should fill in the
 * total. Refusing the whole reply because one field came back as "N/A" would throw away the part
 * that worked, which is most of the value.
 */
function normalise(value: unknown): Record<string, unknown> {
  const input = (value ?? {}) as Record<string, unknown>;
  const field = (name: string): string | null => {
    const raw = input[name];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed === '' || /^(n\/?a|null|unknown|not visible)$/i.test(trimmed)) return null;
    return trimmed;
  };

  // The amount arrives as printed — "₹1,250.00", "Rs 1250/-" — and the symbols and separators are
  // the vendor's formatting, not the number.
  const amount = field('amount')?.replace(/[^\d.]/g, '') ?? null;
  const category = field('category');

  return {
    amount: amount && /^\d{1,9}(\.\d{1,2})?$/.test(amount) ? amount : null,
    vendor: field('vendor'),
    spent_on: field('spent_on'),
    category:
      category && (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? category : null,
    gstin: field('gstin')?.toUpperCase() ?? null,
    summary: field('summary'),
  };
}

const SYSTEM_PROMPT = `You read photographs of Indian supplier bills, invoices and cash receipts for a construction company, and return JSON.

Return exactly these keys, and nothing else:
  amount    - the final payable total as printed, digits and at most two decimals, no symbols. Not a subtotal, not a line item.
  vendor    - the supplier's name as printed.
  spent_on  - the bill's own date as YYYY-MM-DD. Indian bills are usually DD/MM/YYYY or DD-MM-YY; read them that way.
  category  - one of: ${EXPENSE_CATEGORIES.join(', ')}.
  gstin     - the 15-character GSTIN if one is printed.
  summary   - up to 15 words on what was bought, in the bill's own words.

Use null for anything you cannot read with confidence. Do not guess, do not infer a date from the photograph, and do not calculate a total that is not printed. A null is useful; a wrong number is not.`;
