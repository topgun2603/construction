import { z } from 'zod';
import { isIsoDate } from '../dates';

export const uuidSchema = z.string().uuid();

/** `YYYY-MM-DD`, validated as a real calendar date. */
export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'expected a YYYY-MM-DD calendar date' });

/**
 * An Indian mobile number as stored: E.164 without the plus, `91` + 10 digits.
 * Returns null when the input is not one.
 *
 * The country code is only stripped when what remains is still a full 10-digit
 * subscriber number. Stripping a leading "91" unconditionally corrupts every
 * number that *begins* with 91 — 9120196797 is a real mobile — and the damage is
 * invisible until login: the invite stores the mangled form while sign-in
 * normalises the true one, so that person can never get in.
 */
export function toE164Indian(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  const subscriber =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 10
          ? digits
          : null;

  if (subscriber === null || !/^[6-9]\d{9}$/.test(subscriber)) return null;
  return `91${subscriber}`;
}

/** Indian mobile number, stored E.164 without the `+`. */
export const phoneSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (toE164Indian(value) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expected a 10-digit Indian mobile number',
      });
    }
  })
  // Safe: superRefine has already rejected anything that would return null.
  .transform((value) => toE164Indian(value) as string);

/** Money on the wire: an integer string of paise, so JSON never sees a float. */
export const paiseSchema = z
  .union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()])
  .transform((value) => BigInt(value));

/** Non-negative money. */
export const positivePaiseSchema = paiseSchema.refine((value) => value >= 0n, {
  message: 'amount cannot be negative',
});

/** `numeric(4,1)` on the wire — at most one decimal place, 0..999.9. */
export const oneDecimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(1) : value.trim()))
  .pipe(z.string().regex(/^\d{1,3}(?:\.\d)?$/, 'expected a number with at most one decimal'));

export const cursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Client-generated idempotency key for anything created offline (spec §7). */
export const clientIdSchema = uuidSchema;

export const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
