import { notFound } from 'next/navigation';
import {
  QUALITY_INSPECTION_RESULT_LABELS,
  qualityToleranceLabel,
  type QualityInspectionItemView,
  type QualityInspectionView,
  type QualitySignoffParty,
} from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { PrintButton } from '../../../../reports/wage-sheet/[id]/print-button';

export const metadata = { title: 'Inspection report · BUILDR' };

const PARTIES: Array<{ party: QualitySignoffParty; label: string }> = [
  { party: 'inspector', label: 'Inspected by' },
  { party: 'client', label: 'Client' },
  { party: 'consultant', label: 'Consultant' },
];

/**
 * The inspection as paper: every line with its answer, reading against tolerance and comment, the
 * photographs, and the signature blocks — the sheet that goes in the quality file and is shown to
 * the client or the consultant. Plain black on white like the RA bill, with `print:` rules that
 * drop the app chrome.
 */
export default async function InspectionPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { longDate, instantDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let inspection: QualityInspectionView;
  try {
    inspection = await serverFetch<QualityInspectionView>(`/quality/inspections/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const answer = (item: QualityInspectionItemView): string => {
    if (item.outcome === 'na') return t('N/A');
    if (item.kind === 'number' && item.number_value !== null) {
      return `${item.number_value}${item.unit ? ` ${item.unit}` : ''}`;
    }
    if (item.kind === 'text') return item.text_value ?? '—';
    return item.outcome === 'pass' ? t('Pass') : item.outcome === 'fail' ? t('Fail') : '—';
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-[21px] font-semibold">
            {t('Inspection')} #{inspection.number}
          </h2>
          <p className="text-[13.5px] text-ink-muted">
            {inspection.title} · {inspection.project.name}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="rounded-panel border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-[18px] font-semibold">{me.tenant.name}</div>
            <div className="text-[13.5px] text-ink-muted">
              {t('Inspection report')} #{inspection.number} · {inspection.project.name}
            </div>
            <div className="mt-2 text-[14px] font-medium">{inspection.title}</div>
            <div className="text-[13px]">{inspection.location}</div>
            {(inspection.cost_code || inspection.milestone) && (
              <div className="text-[12.5px] text-ink-muted">
                {inspection.cost_code ? `${inspection.cost_code.code} ${inspection.cost_code.name}` : ''}
                {inspection.cost_code && inspection.milestone ? ' · ' : ''}
                {inspection.milestone?.name ?? ''}
              </div>
            )}
          </div>
          <div className="text-end text-[13px]">
            <div className="font-mono">{longDate(inspection.inspection_date)}</div>
            {inspection.inspector && (
              <div>
                {t('Inspector')}: {inspection.inspector.name}
              </div>
            )}
            <div className="mt-1 text-[15px] font-semibold">
              {inspection.result
                ? t(QUALITY_INSPECTION_RESULT_LABELS[inspection.result])
                : t('Not yet signed')}
            </div>
            <div className="text-ink-muted">
              {inspection.counts.answered}/{inspection.counts.total} {t('answered')} · {inspection.counts.failed}{' '}
              {t('failed')}
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <Th>#</Th>
                <Th>{t('Check')}</Th>
                <Th>{t('Requirement')}</Th>
                <Th>{t('Result')}</Th>
                <Th>{t('Comment')}</Th>
              </tr>
            </thead>
            <tbody>
              {inspection.items.map((item, index) => (
                <tr key={item.id} className="break-inside-avoid border-b border-line-soft">
                  <Td className="font-mono text-ink-muted">{index + 1}</Td>
                  <Td>
                    <div>{item.label}</div>
                    {item.photos.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.photos.map((photo) =>
                          photo.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={photo.s3_key}
                              src={photo.url}
                              alt=""
                              className="size-[72px] rounded-[6px] border border-line object-cover"
                            />
                          ) : null,
                        )}
                      </div>
                    )}
                  </Td>
                  <Td className="font-mono text-ink-muted">
                    <span dir="ltr">
                      {qualityToleranceLabel(
                        { target: item.target_value, minus: item.tolerance_minus, plus: item.tolerance_plus },
                        item.unit,
                      )}
                    </span>
                  </Td>
                  <Td className={item.outcome === 'fail' ? 'font-semibold' : undefined}>
                    {answer(item)}
                    {item.kind === 'number' && item.outcome && item.outcome !== 'na' && (
                      <span className="ms-1">({item.outcome === 'pass' ? t('Pass') : t('Fail')})</span>
                    )}
                    {item.snag && (
                      <div className="text-[11px] text-ink-muted">
                        {t('Snag')} #{item.snag.number}
                      </div>
                    )}
                  </Td>
                  <Td>{item.comment ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inspection.notes && (
          <p className="mt-4 text-[12.5px]">
            {t('Notes')}: {inspection.notes}
          </p>
        )}

        <footer className="mt-10 grid grid-cols-3 gap-8 text-[12.5px] text-ink-muted">
          {PARTIES.map(({ party, label }) => {
            const signoff = inspection.signoffs.find((row) => row.party === party);
            return (
              <div key={party} className="border-t border-line pt-2">
                {t(label)}
                {signoff && (
                  <div className="text-ink">
                    <div className="font-medium">{signoff.signature_name}</div>
                    <div className="font-mono text-[11.5px]">
                      {instantDate(signoff.signed_at)} {timeOfDay(signoff.signed_at)}
                    </div>
                    {!signoff.accepted && <div className="font-semibold">{t('Not accepted')}</div>}
                    {signoff.note && <div>{signoff.note}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </footer>
      </div>
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
