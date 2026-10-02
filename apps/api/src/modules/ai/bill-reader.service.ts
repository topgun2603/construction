import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  billDraftSchema,
  EXPENSE_CATEGORIES,
  isValidGstin,
  type BillDraft,
} from '@sitebook/shared';
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

  async read(file: Buffer, contentType: string): Promise<BillDraft> {
    if (!this.enabled) {
      throw ApiError.conflict('Bill scanning is not configured on this deployment');
    }

    /*
     * A PDF becomes a picture of a PDF.
     *
     * Half the bills a builder receives are emailed as PDFs — a supplier's accounting package
     * prints them — and refusing those sent the person who most wanted this feature back to typing.
     * Rendering the page here rather than handing the file to the vendor keeps the model's input
     * one shape, so the prompt, the validation and the next vendor all stay as they are.
     *
     * The first page only. An invoice's total is on page one; later pages are terms and conditions,
     * and sending them is paying to read the small print.
     */
    const image =
      contentType === 'application/pdf' ? await this.firstPageAsImage(file) : file;
    const imageType = contentType === 'application/pdf' ? 'image/png' : contentType;

    // A data URL rather than a public link: the bucket is private, and handing a vendor a signed
    // URL would put somebody's invoice behind a credential we do not control the lifetime of.
    const dataUrl = `data:${imageType};base64,${image.toString('base64')}`;

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

  /**
   * The first page of a PDF, rendered to a PNG.
   *
   * Scale 2 rather than 1: a bill printed at A4 and rendered at 72 dpi has line items a model
   * squints at, and the difference between reading 2,70,314.40 and 2,70,314.49 is the difference
   * between this feature working and being a liability.
   *
   * `pdf-to-img` is imported where it is used, not at the top of the file. It pulls in pdfjs and a
   * canvas binding — several megabytes of module graph — and an API that never scans a PDF should
   * not pay for them at boot.
   */
  private async firstPageAsImage(file: Buffer): Promise<Buffer> {
    try {
      const { pdf } = await import('pdf-to-img');
      const document = await pdf(file, { scale: 2 });
      const first = await document.getPage(1);
      return Buffer.from(first);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not render the PDF');
      throw ApiError.conflict(
        'Could not read that PDF. It may be a scan with no page we can render — try a photograph.',
      );
    }
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
    date_printed: field('date_printed'),
    category:
      category && (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? category : null,
    /*
     * Checked, not just shaped.
     *
     * A GSTIN's last character is a check digit over the other fourteen, which makes this one of
     * the few fields on a bill that can be verified rather than merely pattern-matched. It earned
     * its place immediately: the first real scan returned fifteen plausible characters that were
     * nobody's GSTIN — an `S` read as a `J` — and the shape alone could not tell. A failed
     * checksum becomes null, so the form asks rather than files a wrong number against a supplier.
     */
    gstin: gstinOrNull(field('gstin')),
    summary: field('summary'),
  };
}

function gstinOrNull(candidate: string | null): string | null {
  if (!candidate) return null;
  const gstin = candidate.toUpperCase().replace(/\s+/g, '');
  return isValidGstin(gstin) ? gstin : null;
}

const SYSTEM_PROMPT = `You read photographs of Indian supplier bills, invoices and cash receipts for a construction company, and return JSON.

Return exactly these keys, and nothing else:
  amount    - the final payable total as printed, digits and at most two decimals, no symbols. Not a subtotal, not a line item.
  vendor    - the supplier's name as printed.
  date_printed - the bill's own date copied exactly as it is printed, character for character: "25/09/2026", "25 Sep 2026". Do not convert it to another format and do not reorder it.
  category  - one of: ${EXPENSE_CATEGORIES.join(', ')}.
  gstin     - the 15-character GSTIN if one is printed.
  summary   - up to 15 words on what was bought, in the bill's own words.

Use null for anything you cannot read with confidence. Do not guess, do not infer a date from the photograph, and do not calculate a total that is not printed. A null is useful; a wrong number is not.`;
