import { Injectable, Logger } from '@nestjs/common';
import { currencyMinorDigits, presetFor } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';
import type { BillCompany } from './bill-reader.service';
import { AiGateway } from './ai-gateway.service';

/** What a meter photo said, before anybody confirms it. */
export interface MeterReadingDraft {
  reading: string | null;
  unit: 'hours' | 'km' | null;
}

/** What a fuel bill said, as printed. The service turns the amount into minor units. */
export interface FuelBillDraft {
  litres: string | null;
  amount: string | null;
  date_printed: string | null;
  vendor: string | null;
}

/**
 * Reads the two photographs equipment runs on: a machine's hour meter or odometer, and the slip
 * from the diesel pump (roadmap: "equipment hours from photos of meters and fuel bills").
 *
 * The same three rules as `BillReader`, for the same reason — a model is a guess and a hire bill is
 * not: it never writes (the person confirms the reading on the form), it never does arithmetic (the
 * reading comes back as the digits on the dial, the amount as printed), and its answer is validated,
 * not trusted — anything that does not fit becomes null and the form asks for it.
 *
 * Off when no key is configured; the log form is then typed by hand, which is how it always works
 * in tests.
 */
@Injectable()
export class EquipmentReader {
  private readonly logger = new Logger(EquipmentReader.name);
  private readonly config = env();

  constructor(private readonly gateway: AiGateway) {}


  async readMeter(tenantId: string, file: Buffer, contentType: string): Promise<MeterReadingDraft> {
    const raw = await this.ask(
      tenantId,
      file,
      contentType,
      `You read photographs of the hour meter or odometer on construction machinery and vehicles, and return JSON.

Return exactly these keys:
  reading - the number shown on the meter, digits with at most one decimal (the tenths wheel, often a different colour, is the decimal). No units, no separators.
  unit    - "hours" for an engine hour meter (often marked h or with an hourglass), "km" for an odometer, null if you cannot tell.

Use null for anything you cannot read with confidence. Do not guess a digit that is blurred or hidden; a null is useful, a wrong reading is not.`,
      'Read this meter.',
    );
    const input = (raw ?? {}) as Record<string, unknown>;
    const reading = typeof input['reading'] === 'string' || typeof input['reading'] === 'number'
      ? String(input['reading']).replace(/[^\d.]/g, '')
      : '';
    const unit = input['unit'];
    return {
      reading: /^\d{1,8}(\.\d)?$/.test(reading) ? reading : null,
      unit: unit === 'hours' || unit === 'km' ? unit : null,
    };
  }

  async readFuelBill(tenantId: string, file: Buffer, contentType: string, company: BillCompany): Promise<FuelBillDraft> {
    const country = presetFor(company.country)?.name ?? company.country;
    const digits = currencyMinorDigits(company.currency);
    const raw = await this.ask(
      tenantId,
      file,
      contentType,
      `You read photographs of fuel pump slips and diesel bills for a construction company in ${country}, and return JSON.

Return exactly these keys:
  litres       - the quantity of fuel in litres as printed, digits with at most two decimals, no units.
  amount       - the total paid as printed, digits with at most ${digits} decimals, no symbols or separators.
  date_printed - the slip's own date copied exactly as printed, character for character. Do not convert it.
  vendor       - the fuel station or supplier name as printed.

Use null for anything you cannot read with confidence. Do not calculate litres from a rate or a total from litres.`,
      'Read this fuel bill.',
    );
    const input = (raw ?? {}) as Record<string, unknown>;
    const field = (name: string): string | null => {
      const value = input[name];
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const trimmed = String(value).trim();
      return trimmed === '' || /^(n\/?a|null|unknown)$/i.test(trimmed) ? null : trimmed;
    };
    const litres = field('litres')?.replace(/[^\d.]/g, '') ?? null;
    const amount = field('amount')?.replace(/[^\d.]/g, '') ?? null;
    const money = new RegExp(`^\\d{1,9}(\\.\\d{1,${digits}})?$`);
    return {
      litres: litres && /^\d{1,7}(\.\d{1,2})?$/.test(litres) ? litres : null,
      amount: amount && money.test(amount) ? amount : null,
      date_printed: field('date_printed'),
      vendor: field('vendor')?.slice(0, 120) ?? null,
    };
  }

  /** One vision call returning parsed JSON, or a conflict the form turns into "enter it by hand". */
  private async ask(tenantId: string, file: Buffer, contentType: string, system: string, prompt: string): Promise<unknown> {
    await this.gateway.assertEnabled(
      tenantId,
      'reading',
      'Reading photos is not configured on this deployment. Enter it by hand.',
    );
    if (!contentType.startsWith('image/')) {
      throw ApiError.validationFailed({ s3_key: 'not a photo' }, 'That file is not a photograph.');
    }
    // A data URL rather than a signed link: the bucket is private and stays so.
    const dataUrl = `data:${contentType};base64,${file.toString('base64')}`;
    let raw: string;
    try {
      const client = await this.gateway.client(tenantId, 'reading');
      const response = await client.chat.completions.create({
        model: this.config.OPENAI_VISION_MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.warn({ err: error }, 'Equipment photo read failed at the vendor');
      throw ApiError.conflict('Could not read that photo. Enter it by hand.');
    }
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn('Equipment photo read returned something that is not JSON');
      throw ApiError.conflict('Could not read that photo. Enter it by hand.');
    }
  }
}
