import { serverFetch } from '@/lib/server-api';
import type { Contractor, LabourPayment, Page, Worker } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { money } from '@/lib/format';
import { RecordPaymentDialog } from './record-payment-dialog';
import { PaymentsTable } from './payments-table';

export const metadata = { title: 'Labour payments · BUILDR' };

export default async function PaymentsPage() {
  const [payments, workers, contractors] = await Promise.all([
    serverFetch<Page<LabourPayment>>('/labour-payments?limit=200'),
    serverFetch<Page<Worker>>('/workers?limit=500&status=active'),
    serverFetch<Page<Contractor>>('/contractors?limit=200'),
  ]);

  const sum = (type: LabourPayment['type']) =>
    payments.items
      .filter((payment) => payment.type === type)
      .reduce((total, payment) => total + BigInt(payment.amount), 0n);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Wages paid" value={money(sum('wage').toString())} note="Through wage periods" />
        <StatTile
          label="Advances out"
          value={money(sum('advance').toString())}
          note="Deducted from the next period"
          noteTone="pending"
        />
        <StatTile label="Bonus" value={money(sum('bonus').toString())} note="Added to what is owed" />
        <StatTile
          label="Deductions"
          value={money(sum('deduction').toString())}
          note="Reduces what is owed"
        />
      </div>

      <div className="flex justify-end">
        <RecordPaymentDialog workers={workers.items} contractors={contractors.items} />
      </div>

      <PaymentsTable payments={payments.items} />
    </FadeIn>
  );
}
