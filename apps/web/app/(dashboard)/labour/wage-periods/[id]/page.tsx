import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { WagePeriodDetail } from '@/lib/api-types';
import { money, shortDate } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { PeriodActions } from './period-actions';
import { LinesTable } from './lines-table';

const STATUS_TONE: Record<WagePeriodDetail['status'], Tone> = {
  open: 'neutral',
  finalised: 'pending',
  paid: 'done',
};

export default async function WagePeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let period: WagePeriodDetail;
  try {
    period = await serverFetch<WagePeriodDetail>(`/wage-periods/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const gross = period.lines.reduce((sum, line) => sum + BigInt(line.gross_amount), 0n);
  const advances = period.lines.reduce((sum, line) => sum + BigInt(line.advances_deducted), 0n);
  const net = period.lines.reduce((sum, line) => sum + BigInt(line.net_payable), 0n);
  const paid = period.lines.reduce((sum, line) => sum + BigInt(line.paid_amount), 0n);
  const outstanding = net - paid;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/labour/wage-periods"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3" /> Wage periods
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">{period.contractor_name}</h2>
            <Badge tone={STATUS_TONE[period.status]}>
              {period.status === 'open' ? 'Draft' : period.status === 'paid' ? 'Paid' : 'To pay'}
            </Badge>
            {/*
              Said on the screen the owner actually lands on. A sheet they do not remember
              creating should explain itself here, not leave them wondering who else has been
              in the account.
            */}
            {period.source === 'scheduled' && (
              <Badge tone="neutral" dot={false}>
                Drafted automatically
              </Badge>
            )}
          </div>
          <span className="font-mono text-[13px] text-ink-muted">
            {shortDate(period.period_start)} – {shortDate(period.period_end)} ·{' '}
            {period.lines.length} workers
          </span>
        </div>

        <PeriodActions period={period} outstanding={outstanding.toString()} />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Gross earned" value={money(gross.toString())} />
        <Summary label="Advances deducted" value={money(advances.toString())} muted />
        <Summary label="Net payable" value={money(net.toString())} />
        <Summary
          label="Outstanding"
          value={money(outstanding.toString())}
          tone={outstanding > 0n ? 'pending' : 'done'}
        />
      </div>

      {period.status !== 'open' && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
            This period is frozen. Attendance between {shortDate(period.period_start)} and{' '}
            {shortDate(period.period_end)} can no longer be edited — corrections go in the next
            period as a bonus or deduction.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/reports/wage-sheet/${period.id}`}>Open wage sheet</Link>
          </Button>
        </Card>
      )}

      <LinesTable lines={period.lines} />
    </FadeIn>
  );
}

function Summary({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'pending' | 'done';
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <span
        className={`font-mono text-[20px] font-bold ${
          muted ? 'text-ink-muted' : tone === 'pending' ? 'text-pending-fg' : ''
        }`}
      >
        {value}
      </span>
    </Card>
  );
}
