import { taxRule } from '@sitebook/shared';
import type { SelfResponse } from '@/lib/session';

/**
 * Whether this person gets the tax report at all.
 *
 * It needs a regime with a tax to report on, and the same gate as the API's `/reports/tax` —
 * the expenses module and `expenses.view` — because input tax is read straight off the expenses.
 * Kept out of the nav component so server pages can ask it and pass the answer down.
 */
export function canSeeTaxReport(self: SelfResponse): boolean {
  return (
    taxRule(self.tenant.tax_regime).taxName !== null &&
    self.enabled_modules.includes('expenses') &&
    self.permissions.includes('expenses.view')
  );
}
