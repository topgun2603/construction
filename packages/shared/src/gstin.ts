/**
 * GSTIN validation.
 *
 * A GSTIN is fifteen characters and the last one is a check digit computed from the other
 * fourteen, which makes it one of the few fields on an Indian bill that can be *verified* rather
 * than merely pattern-matched. That matters wherever a GSTIN is read by a machine — from a
 * photograph, say — because the failure is otherwise silent: a misread `S` for a `J` still looks
 * like a GSTIN, and nothing downstream can tell.
 *
 * Shape: two digits of state code, ten characters of PAN, one entity digit, a literal `Z`, then
 * the check digit. The `Z` is fixed by the specification and is a free extra check.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 01-38 are the states and union territories; 97 is "other territory" and 99 is a centralised id. */
function isKnownStateCode(code: number): boolean {
  return (code >= 1 && code <= 38) || code === 97 || code === 99;
}

/**
 * The check digit for the first fourteen characters.
 *
 * Each character's value is multiplied by 1 or 2 alternately; the product's quotient and remainder
 * over 36 are summed. The digit is whatever brings that total to a multiple of 36.
 */
export function gstinCheckDigit(first14: string): string | null {
  let total = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = ALPHABET.indexOf(first14[index] ?? '');
    if (value < 0) return null;
    const product = value * (index % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36] ?? null;
}

/** Whether a string is a GSTIN that could actually have been issued. */
export function isValidGstin(candidate: string): boolean {
  const gstin = candidate.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  if (!isKnownStateCode(Number(gstin.slice(0, 2)))) return false;
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}
