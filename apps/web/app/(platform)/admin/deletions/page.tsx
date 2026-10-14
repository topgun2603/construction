import { platformFetch } from '@/lib/platform-session';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { DeletionControls } from './deletion-controls';

export const dynamic = 'force-dynamic';

interface DeletionsOverview {
  pending: Array<{
    tenant_id: string;
    tenant_name: string;
    plan: string;
    requested_at: string;
    purge_after: string;
  }>;
  certificates: Array<{
    id: string;
    company_id: string;
    name_hash: string;
    trigger: string;
    requested_at: string | null;
    deleted_at: string;
    rows: number;
    tables: number;
    objects: number;
  }>;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Company deletions: who is waiting out the thirty days, and the certificates of those already gone.
 *
 * An operator can cancel a deletion (the owner changed their mind and cannot get in to say so) or
 * carry it out now (the owner wants it done today). Neither can start one — only a company's owner
 * asks for that. Both are recorded in the console's audit log.
 */
export default async function DeletionsPage() {
  const t = await getT();
  const data = await platformFetch<DeletionsOverview>('/deletions');

  return (
    <FadeIn className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight">{t('Deletions')}</h1>
        <p className="text-[13.5px] text-ink-muted">
          {t('Companies whose owner asked for them to be deleted, and proof of the ones that were.')}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Scheduled')}</h2>
        {data.pending.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface p-4 text-[13.5px] text-ink-muted">
            {t('No company is waiting to be deleted.')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-panel border border-line bg-surface">
            {data.pending.map((row) => (
              <li key={row.tenant_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13.5px]">
                <a href={`/admin/tenants/${row.tenant_id}`} className="font-semibold underline-offset-4 hover:underline">
                  {row.tenant_name}
                </a>
                <span className="text-ink-muted">
                  {t('Asked')} {day.format(new Date(row.requested_at))} · {t('deleted on')}{' '}
                  {day.format(new Date(row.purge_after))}
                </span>
                <DeletionControls tenantId={row.tenant_id} tenantName={row.tenant_name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Deletion certificates')}
        </h2>
        <p className="max-w-3xl text-[13px] text-ink-muted">
          {t('What is kept after a company is deleted: its id, a hash of its name, when, and how many rows and files went. No personal data.')}
        </p>
        {data.certificates.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface p-4 text-[13.5px] text-ink-muted">
            {t('None yet.')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead className="text-start text-ink-muted">
                <tr className="border-b border-line-soft">
                  <th className="px-4 py-2.5 text-start font-medium">{t('Company id')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('Deleted')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('How')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('Rows')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('Files')}</th>
                </tr>
              </thead>
              <tbody>
                {data.certificates.map((row) => (
                  <tr key={row.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px]">{row.company_id}</td>
                    <td className="px-4 py-2.5">{day.format(new Date(row.deleted_at))}</td>
                    <td className="px-4 py-2.5">
                      {row.trigger === 'platform' ? t('Carried out by an operator') : t('Grace period ended')}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{row.rows}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{row.objects}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </FadeIn>
  );
}
