import { apiFetch } from '@/lib/api';
import { money, shortDate, titleCase } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your work and pay' };

interface WorkerSummary {
  company: { name: string; logo_url: string | null };
  worker: {
    name: string;
    trade: string | null;
    contractor: string | null;
    daily_wage: string;
    status: string;
  };
  totals: {
    since: string;
    days_present: number;
    half_days: number;
    earned: string;
    drawn: string;
    balance: string;
  };
  days: {
    date: string;
    status: string;
    site: string;
    overtime_hours: string;
    earned: string;
  }[];
  payments: { date: string; type: string; mode: string; amount: string }[];
}

/**
 * A worker's own record, opened from a link somebody sent them (spec §3 item 15).
 *
 * Outside the dashboard shell entirely: no navigation, no sign-in, no mention of the product. The
 * person reading this is a mason standing in a site office being shown a phone, and the only
 * question they have is whether the number they are about to be paid matches the days they
 * remember working.
 *
 * So the page is a total, then the days that make it up. Big type, one column, no colour that
 * carries meaning on its own — it will be read on a cracked screen in daylight.
 */
export default async function WorkerLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let summary: WorkerSummary;
  try {
    summary = await apiFetch<WorkerSummary>(
      `/worker-portal/summary?token=${encodeURIComponent(token)}`,
    );
  } catch {
    // Every failure reads the same to the person holding the phone — expired, withdrawn, or
    // mistyped — because there is nothing they could do differently with a more specific answer,
    // and a page that distinguishes them tells a stranger which links are real.
    return (
      <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center gap-3 px-6 text-center">
        <h1 className="text-[20px] font-semibold">This link has stopped working</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Links last thirty days. Ask the site office to send you a new one.
        </p>
      </main>
    );
  }

  const { company, worker, totals, days, payments } = summary;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col gap-5 px-5 py-7">
      <header className="flex flex-col gap-1">
        <span className="text-[12.5px] uppercase tracking-[0.1em] text-ink-muted">
          {company.name}
        </span>
        <h1 className="text-[26px] font-semibold leading-tight">{worker.name}</h1>
        <p className="text-[14px] text-ink-muted">
          {[worker.trade, worker.contractor].filter(Boolean).join(' · ') || 'On the books'}
        </p>
      </header>

      {/*
        The balance first and largest, because it is the only number anybody opened this to see.
        Earned and drawn sit under it as the working, so the total is never just asserted.
      */}
      <section className="rounded-panel border border-line bg-surface px-5 py-5">
        <span className="text-[13px] text-ink-muted">Still owed to you</span>
        <p className="mt-1 font-mono text-[34px] font-bold leading-none">
          {money(totals.balance)}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
          <div className="flex flex-col">
            <dt className="text-ink-muted">Earned</dt>
            <dd className="font-mono font-semibold">{money(totals.earned)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-ink-muted">Already paid</dt>
            <dd className="font-mono font-semibold">{money(totals.drawn)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-ink-muted">Full days</dt>
            <dd className="font-semibold">{totals.days_present}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-ink-muted">Half days</dt>
            <dd className="font-semibold">{totals.half_days}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[12.5px] text-ink-faint">
          Since {shortDate(totals.since)}. Your daily wage is {money(worker.daily_wage)}.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Days you were marked
        </h2>
        <div className="overflow-hidden rounded-panel border border-line bg-surface">
          {days.length === 0 ? (
            <p className="px-4 py-5 text-[14px] text-ink-muted">
              Nothing recorded in the last three months.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {days.map((day) => (
                <li key={`${day.date}-${day.site}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-medium">{shortDate(day.date)}</span>
                    <span className="truncate text-[12.5px] text-ink-muted">
                      {titleCase(day.status)}
                      {Number(day.overtime_hours) > 0 ? ` · ${day.overtime_hours}h extra` : ''} ·{' '}
                      {day.site}
                    </span>
                  </div>
                  <span className="ml-auto font-mono text-[14px] font-semibold">
                    {money(day.earned)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {payments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Money you have taken
          </h2>
          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <ul className="divide-y divide-line-soft">
              {payments.map((payment) => (
                <li
                  key={`${payment.date}-${payment.amount}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-medium">{shortDate(payment.date)}</span>
                    <span className="text-[12.5px] text-ink-muted">
                      {titleCase(payment.type)} · {titleCase(payment.mode)}
                    </span>
                  </div>
                  <span className="ml-auto font-mono text-[14px] font-semibold">
                    {money(payment.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <p className="pb-6 text-center text-[12.5px] leading-relaxed text-ink-faint">
        If a day is missing or wrong, tell your supervisor. This page is read-only and updates
        whenever your site office records something.
      </p>
    </main>
  );
}
