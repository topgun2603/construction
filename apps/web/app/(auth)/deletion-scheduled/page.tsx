import { redirect } from 'next/navigation';
import { CalendarX2 } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { currentAccessToken } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { CompanyDeletionStatus } from '@/lib/data-portability-types';
import { CancelDeletion } from './cancel-deletion';

export const metadata = { title: 'Deletion scheduled · BUILDR' };

/**
 * Where the owner of a company waiting to be deleted lands, instead of the dashboard: when it will
 * be deleted, and the button that takes it back. Everybody else in the company cannot sign in at all
 * — the sign-in page tells them the date — and the API refuses every other route to the owner too.
 */
export default async function DeletionScheduledPage() {
  if (!(await currentAccessToken())) redirect('/login');
  const t = await getT();

  let status: CompanyDeletionStatus | null = null;
  try {
    status = await serverFetch<CompanyDeletionStatus>('/company-deletion', { onUnauthenticated: 'throw' });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) redirect('/login');
    // Not the owner (or not allowed): nothing here they can do but leave.
    status = null;
  }
  // Not pending any more (cancelled from another tab, or by an operator): straight on.
  if (status && !status.pending) redirect('/');

  const when = status?.pending
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(status.pending.purge_after),
      )
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[560px] flex-col gap-6 rounded-sheet border border-line bg-surface p-6 shadow-panel sm:p-8">
        <div className="flex flex-col gap-2">
          <span className="flex size-11 items-center justify-center rounded-control bg-blocked-bg">
            <CalendarX2 className="size-5 text-blocked-fg" />
          </span>
          <h1 className="text-h1">{t('Scheduled for deletion')}</h1>
          {status && <span className="text-[13.5px] font-medium text-ink-soft">{status.company_name}</span>}
          {status?.pending ? (
            <p className="text-[14px] leading-relaxed text-ink-muted">
              {t('This company and everything in it — sites, workers, attendance, wages, photographs and documents — will be deleted permanently on')}{' '}
              <strong className="font-semibold text-ink">{when}</strong>.{' '}
              {t('Until then nobody else can sign in. You can cancel the deletion and everything comes back exactly as it was.')}
            </p>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-muted">
              {t('This company is scheduled for deletion. Only its owner can sign in, to cancel it.')}
            </p>
          )}
        </div>
        <CancelDeletion canCancel={Boolean(status?.pending)} />
      </div>
    </main>
  );
}
