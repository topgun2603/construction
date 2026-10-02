import { Card } from '@/components/ui/card';
import { moneyShort } from '@/lib/format';
import { getT } from '@/lib/i18n-server';

/**
 * This month's spend against what the sites are committed to.
 *
 * The KPI tile above says what was spent; this says what that spend *is* — a tenth of the way
 * through the committed budget, or most of the way. The tile alone never answers the question an
 * owner is actually asking, which is whether the number is big.
 *
 * Labour and materials are split because they behave differently: labour is a weekly rhythm
 * somebody can slow down, materials arrive in lumps that were ordered a month ago.
 */
export async function SpendBar({
  spendMonth,
  labourMonth,
  expensesMonth,
  budgetCommitted,
}: {
  spendMonth: string;
  labourMonth: string;
  expensesMonth: string;
  budgetCommitted: string;
}) {
  const t = await getT();
  const spend = BigInt(spendMonth);
  const labour = BigInt(labourMonth);
  const expenses = BigInt(expensesMonth);
  const budget = BigInt(budgetCommitted);

  // Integer percentages from integer paise: a float here is a rounding error in a money figure.
  const pct = (part: bigint, whole: bigint) =>
    whole > 0n ? Number((part * 1000n) / whole) / 10 : 0;

  const usedPct = pct(spend, budget);
  const labourPct = pct(labour, budget);
  const expensesPct = pct(expenses, budget);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('This month against budget')}
        </span>
        {budget > 0n && (
          <span className="font-mono text-[13px] text-ink-muted">
            {usedPct < 0.1 && spend > 0n ? '<0.1' : usedPct.toFixed(1)}% used
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[26px] font-bold leading-none">{moneyShort(spendMonth)}</span>
        {budget > 0n && (
          <span className="text-[13px] text-ink-muted">of {moneyShort(budgetCommitted)}</span>
        )}
      </div>

      {budget > 0n ? (
        <>
          {/* Two segments in one track: the split is the point, and two bars would read as two
              unrelated measures. */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-track">
            <span
              className="h-full bg-accent"
              style={{ width: `${Math.min(labourPct, 100)}%` }}
              aria-hidden
            />
            <span
              className="h-full bg-pending"
              style={{ width: `${Math.min(expensesPct, Math.max(0, 100 - labourPct))}%` }}
              aria-hidden
            />
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
              <span aria-hidden className="size-2 rounded-full bg-accent" />
              {t('Labour')} {moneyShort(labourMonth)}
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
              <span aria-hidden className="size-2 rounded-full bg-pending" />
              {t('Materials and expenses')} {moneyShort(expensesMonth)}
            </span>
          </div>
        </>
      ) : (
        // No budgets set is a real and common state, and it should read as a prompt rather than
        // as a chart that failed to draw.
        <p className="text-[12.5px] text-ink-muted">
          {t('Set a budget on each site and this becomes a burn rate.')}
        </p>
      )}
    </Card>
  );
}
