import { serverFetch } from '@/lib/server-api';
import type { Contractor, Page, WagePeriod } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { moneyShort } from '@/lib/format';
import { GeneratePeriodDialog } from './generate-dialog';
import { PeriodsTable } from './periods-table';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Wage periods · BUILDR' };

export default async function WagePeriodsPage() {
  const t = await getT();
  const [periods, contractors] = await Promise.all([
    serverFetch<Page<WagePeriod>>('/wage-periods?limit=100'),
    serverFetch<Page<Contractor>>('/contractors?limit=200'),
  ]);

  const open = periods.items.filter((period) => period.status === 'open');
  const awaitingPayment = periods.items.filter((period) => period.status === 'finalised');
  const outstanding = awaitingPayment.reduce(
    (sum, period) => sum + (BigInt(period.total_earned) - BigInt(period.total_paid)),
    0n,
  );

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile label={t('Open drafts')} value={String(open.length)} animate note={t('Still recomputing from attendance')} />
        <StatTile
          label={t('Awaiting payment')}
          value={String(awaitingPayment.length)}
          animate
          note={awaitingPayment.length > 0 ? 'Finalised and ready to pay' : t('Nothing pending')}
          noteTone={awaitingPayment.length > 0 ? 'pending' : 'done'}
        />
        <StatTile
          label={t('Outstanding to labour')}
          value={moneyShort(outstanding.toString())}
          note={t('Across finalised periods')}
        />
      </div>

      <div className="flex justify-end">
        <GeneratePeriodDialog contractors={contractors.items} />
      </div>

      <PeriodsTable periods={periods.items} />
    </FadeIn>
  );
}
