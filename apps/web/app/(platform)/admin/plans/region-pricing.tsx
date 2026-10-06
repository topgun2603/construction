'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  PLAN_REGION_CURRENCIES,
  planPriceFromMinor,
  planPriceProblem,
  planPriceToMinor,
  type PlanView,
} from '@sitebook/shared';
import { setPlanPrices } from '@/lib/platform-billing-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';

const REGION_LABEL: Record<(typeof PLAN_REGION_CURRENCIES)[number], string> = {
  LKR: 'Sri Lanka (LKR)',
  BDT: 'Bangladesh (BDT)',
  NPR: 'Nepal (NPR)',
  USD: 'US dollars — fallback',
};

/**
 * Region pricing: every plan against the South Asian currencies and the US-dollar fallback, in one
 * grid, so a price list can be set in a sitting rather than a plan at a time.
 *
 * Amounts are typed in major units (14,999 rupees) and stored in minor units with each currency's
 * own exponent. Saving a row sends the plan's whole price map — these columns as edited, every
 * other currency (AED, SAR…) as it was — because the API replaces the map rather than merging it.
 * A blank cell removes that currency: a company paying in it falls back to dollars, or to "contact
 * us".
 */
export function RegionPricing({ plans, canManage }: { plans: PlanView[]; canManage: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      plans.map((plan) => [
        plan.id,
        Object.fromEntries(
          PLAN_REGION_CURRENCIES.map((currency) => [
            currency,
            plan.prices[currency] ? planPriceFromMinor(plan.prices[currency]!, currency) : '',
          ]),
        ),
      ]),
    ),
  );

  function save(plan: PlanView) {
    const next: Record<string, string> = { ...plan.prices };
    for (const currency of PLAN_REGION_CURRENCIES) {
      const typed = (drafts[plan.id]?.[currency] ?? '').trim();
      if (!typed) {
        delete next[currency];
        continue;
      }
      const minor = planPriceToMinor(typed, currency);
      const problem = minor === null ? 'not an amount' : planPriceProblem(currency, minor);
      if (problem || minor === null) {
        toast.error(`${plan.name}, ${currency}: ${t(problem ?? 'not an amount')}`);
        return;
      }
      next[currency] = minor;
    }
    start(async () => {
      const result = await setPlanPrices(plan.id, next);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save'));
        return;
      }
      toast.success(`${plan.name}: ${t('regional prices saved')}`);
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <Globe2 className="size-3.5" />
          {t('Region pricing')}
        </span>
        <span className="text-[13px] text-ink-muted">
          {t(
            'Lower prices for South Asia. A company is quoted in its own currency, else in US dollars, else asked to contact us — never converted.',
          )}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="text-start text-[12px] text-ink-muted">
              <th className="py-2 pe-3 text-start font-medium">{t('Plan')}</th>
              {PLAN_REGION_CURRENCIES.map((currency) => (
                <th key={currency} className="px-2 py-2 text-start font-medium">
                  {t(REGION_LABEL[currency])}
                </th>
              ))}
              <th className="py-2 ps-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td className="py-2 pe-3 font-medium">
                  {plan.name}
                  {!plan.is_active && (
                    <span className="ms-1.5 text-[12px] text-ink-muted">({t('retired')})</span>
                  )}
                </td>
                {PLAN_REGION_CURRENCIES.map((currency) => (
                  <td key={currency} className="px-2 py-2">
                    <Input
                      aria-label={`${plan.name} ${currency}`}
                      inputMode="decimal"
                      dir="ltr"
                      className="h-9 font-mono"
                      placeholder="—"
                      value={drafts[plan.id]?.[currency] ?? ''}
                      disabled={!canManage || pending}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [plan.id]: { ...current[plan.id], [currency]: event.target.value },
                        }))
                      }
                    />
                  </td>
                ))}
                <td className="py-2 ps-3 text-end">
                  {canManage && (
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => save(plan)}>
                      {t('Save')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canManage && (
        <p className="text-[12.5px] text-ink-muted">
          {t('Only an operator named in the deployment config can change prices.')}
        </p>
      )}
    </Card>
  );
}
