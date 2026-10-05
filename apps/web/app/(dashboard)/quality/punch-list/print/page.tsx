import { notFound } from 'next/navigation';
import {
  SNAG_PRIORITY_LABELS,
  SNAG_STATUS_LABELS,
  type PunchListItemView,
  type QualityPhoto,
  type SnagPhotoStage,
} from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { ProjectSummary } from '@/lib/api-types';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { PrintButton } from '../../../reports/wage-sheet/[id]/print-button';

export const metadata = { title: 'Punch list · BUILDR' };

/**
 * The handover punch list as paper: what the client is shown, item by item with its before and
 * after photographs, and where each one stands. It prints the client-visible list on purpose — the
 * same thing for the builder and the client to walk the building with and sign at handover.
 */
export default async function PunchListPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>;
}) {
  const t = await getT();
  const { longDate, shortDate, instantDate, todayIso } = await getFormat();
  const { project_id: projectId } = await searchParams;
  if (!projectId) notFound();
  const me = await requireSelf();

  let project: ProjectSummary;
  let items: PunchListItemView[];
  try {
    [project, { items }] = await Promise.all([
      serverFetch<ProjectSummary>(`/projects/${projectId}`),
      serverFetch<{ items: PunchListItemView[] }>(`/projects/${projectId}/punch-list`),
    ]);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }
  const outstanding = items.filter((item) => item.status !== 'closed').length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">{t('Punch list')}</h2>
          <p className="text-[13.5px] text-ink-muted">{project.name}</p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{me.tenant.name}</div>
            <div className="text-[13.5px] text-ink-muted">
              {t('Punch list')} · {project.name}
            </div>
            {project.client_name && <div className="mt-1 text-[13px]">{project.client_name}</div>}
            {project.address && <div className="text-[12.5px] text-ink-muted">{project.address}</div>}
          </div>
          <div className="text-end text-[13px]">
            <div className="font-mono">{longDate(todayIso())}</div>
            <div className="mt-1 font-semibold">
              {outstanding} {t('outstanding')} · {items.length - outstanding} {t('closed')}
            </div>
          </div>
        </header>

        {items.length === 0 ? (
          <p className="py-6 text-center text-[13.5px] text-ink-muted">{t('Nothing on the punch list.')}</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <Th>#</Th>
                <Th>{t('Item')}</Th>
                <Th>{t('Before')}</Th>
                <Th>{t('After')}</Th>
                <Th>{t('Status')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="break-inside-avoid border-b border-line-soft">
                  <Td className="font-mono text-ink-muted">{item.number}</Td>
                  <Td>
                    <div className="font-medium">{item.title}</div>
                    {item.description && <div className="text-ink-muted">{item.description}</div>}
                    <div className="text-[11.5px] text-ink-muted">
                      {[item.location, item.trade, t(SNAG_PRIORITY_LABELS[item.priority])].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td>
                    <Photos photos={item.photos} stage="before" />
                  </Td>
                  <Td>
                    <Photos photos={item.photos} stage="after" />
                  </Td>
                  <Td>
                    <div className="font-semibold">{t(SNAG_STATUS_LABELS[item.status])}</div>
                    {item.closed_at ? (
                      <div className="font-mono text-[11.5px]">{instantDate(item.closed_at)}</div>
                    ) : item.due_on ? (
                      <div className="text-[11.5px] text-ink-muted">
                        {t('Due')} <span className="font-mono">{shortDate(item.due_on)}</span>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="mt-10 flex justify-between gap-8 text-[12.5px] text-ink-muted">
          <div className="border-t border-line pt-2">{t('For the builder')}</div>
          <div className="border-t border-line pt-2">{t('For the client')}</div>
          <div className="border-t border-line pt-2">{t('Date')}</div>
        </footer>
      </div>
    </div>
  );
}

function Photos({
  photos,
  stage,
}: {
  photos: Array<QualityPhoto & { stage: SnagPhotoStage }>;
  stage: SnagPhotoStage;
}) {
  const list = photos.filter((photo) => photo.stage === stage && photo.url).slice(0, 2);
  if (list.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <div className="flex gap-1.5">
      {list.map((photo) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={photo.s3_key} src={photo.url!} alt="" className="size-[84px] rounded-[6px] border border-line object-cover" />
      ))}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] ${className || 'text-start'}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 align-top ${className}`}>{children}</td>;
}
