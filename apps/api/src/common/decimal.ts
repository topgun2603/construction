/**
 * `numeric(4,1)` columns — days present, overtime hours — cross the wire as
 * one-decimal strings.
 *
 * Prisma's `Decimal.toString()` drops a trailing zero, so 2.0 days serialises as
 * `"2"` while 1.5 stays `"1.5"`. That inconsistency lands on every client: the wage
 * sheet has to right-align a column where some cells have a decimal point and some
 * do not, and anything comparing the string form gets it wrong. Fixing the shape
 * once, here, keeps `decimalToTenths` in `@sitebook/shared` able to parse it too.
 */
export function oneDecimal(value: { toFixed(digits: number): string } | string | number): string {
  if (typeof value === 'string') return Number.parseFloat(value).toFixed(1);
  if (typeof value === 'number') return value.toFixed(1);
  return value.toFixed(1);
}
