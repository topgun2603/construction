import Link from 'next/link';
import { Scale } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Indent, Material, Page, ProjectSummary } from '@/lib/api-types';
import type { RfqSummary } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { RFQ_STATUS } from '../status';
import { NewRfqDialog } from './new-rfq-dialog';

export const metadata = { title: 'Quotes · BUILDR' };

/** Requests for quotation: what is being priced, and how many suppliers have answered. */
export default async function RfqsPage() {
  const t = await getT();
  const { shortDate } = await getFormat();
  const me = await requireSelf();
  const canManage = me.permissions.includes('procurement.manage');

  const [rfqs, projects, materials, indents] = await Promise.all([
    serverFetch<RfqSummary[]>('/rfqs'),
    canManage ? serverFetch<Page<ProjectSummary>>('/projects?limit=200') : Promise.resolve(null),
    canManage ? serverFetch<Page<Material>>('/materials?limit=500') : Promise.resolve(null),
    canManage && me.enabled_modules.includes('indents')
      ? serverFetch<Page<Indent>>('/indents?status=approved&limit=200').catch(() => null)
      : Promise.resolve(null),
  ]);

  const create =
    canManage && projects && projects.items.length > 0 ? (
      <NewRfqDialog projects={projects.items} materials={materials?.items ?? []} indents={indents?.items ?? []} />
    ) : null;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex justify-end">{create}</div>
      {rfqs.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={t('No requests for quotation yet')}
          body={t(
            'Ask several suppliers to price the same list — from an approved indent or typed in — and compare them line by line before you order.',
          )}
          action={create ?? undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2.5 text-start font-semibold">{t('RFQ')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Title')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Site')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Status')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Items')}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t('Quotes')}</th>
                <th className="px-4 py-2.5 text-end font-semibold">{t('Needed by')}</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr key={rfq.id} className="border-b border-line-soft last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5">
                    <Link href={`/procurement/rfqs/${rfq.id}`} className="font-mono font-semibold hover:underline">
                      {rfq.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{rfq.title}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{rfq.project_name}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={RFQ_STATUS[rfq.status].tone}>{t(RFQ_STATUS[rfq.status].label)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono">{rfq.item_count}</td>
                  <td className="px-3 py-2.5 text-end font-mono">{rfq.quote_count}</td>
                  <td className="px-4 py-2.5 text-end text-ink-muted">{shortDate(rfq.required_by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
