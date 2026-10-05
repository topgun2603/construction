import { ShieldCheck } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import type { SiteCheck } from '@/lib/api-types';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { CheckList } from '@/components/check-list';
import { RunChecksButton } from './run-checks-button';

export const metadata = { title: 'Checks · BUILDR' };

/**
 * Leak and fraud checks (roadmap: AI agent 3).
 *
 * Every night the company's last month of roll calls, site reports, expenses and payments is
 * checked for the patterns money leaks through. What is found waits here for a person to confirm
 * or dismiss; the checks never change a record on their own.
 */
export default async function ChecksPage() {
  const t = await getT();
  const [open, decided, me] = await Promise.all([
    serverFetch<SiteCheck[]>('/checks'),
    serverFetch<SiteCheck[]>('/checks?status=decided'),
    requireSelf(),
  ]);
  const canDecide = me.permissions.includes('expenses.approve');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Checks')}</h2>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            {t(
              'Every night the last month of roll calls, site reports, expenses and payments is checked for workers paid twice, rolls with no day off, bills entered twice and expenses far above the usual. Nothing is changed — each one waits for you to confirm or dismiss.',
            )}
          </p>
        </div>
        {canDecide && <RunChecksButton />}
      </div>

      <Card className="p-4">
        {open.length === 0 ? (
          <div className="flex items-center gap-3 py-2 text-[14px] text-ink-muted">
            <ShieldCheck className="size-5 text-done-fg" />
            {t('Nothing to look at right now.')}
          </div>
        ) : (
          <CheckList checks={open} canDecide={canDecide} />
        )}
      </Card>

      {decided.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Already decided')}
          </span>
          <Card className="p-4">
            <CheckList checks={decided} canDecide={false} />
          </Card>
        </section>
      )}
    </FadeIn>
  );
}
