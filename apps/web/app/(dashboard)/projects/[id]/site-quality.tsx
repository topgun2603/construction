import Link from 'next/link';
import { ClipboardCheck, FileCheck2, Printer, ShieldCheck } from 'lucide-react';
import {
  SNAG_PRIORITY_LABELS,
  type PunchListItemView,
  type QualityInspectionSummary,
  type QualityTemplateView,
  type QualityTestView,
  type SnagView,
} from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import type { SelfResponse } from '@/lib/session';
import type { Contractor, Page } from '@/lib/api-types';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { INSPECTION_RESULT, SNAG_STATUS } from '../../quality/labels';
import { InspectionsTable, NewInspectionDialog } from '../../quality/inspections';
import { BeforeAfter } from '../../quality/quality-ui';
import { NewSnagDialog, QuickCaptureDialog } from '../../quality/snag-dialogs';
import { SnagBoard } from '../../quality/snags';
import { NewTestDialog, TestsTable } from '../../quality/tests';
import { CountersignDialog } from '../../quality/inspections/[id]/inspection-runner';

/**
 * The site's Quality tab (roadmap Phase 2, module 7). Rendered only when the tab is open, so its
 * fetches happen only then.
 *
 * Two audiences, two views. The team sees the working record: open snags, inspections, tests, and
 * the buttons to add to them. A client sees what was made for them — the handover punch list with
 * its before and after photos, and the inspections shared for them to countersign — and nothing
 * about who was assigned what, which is the builder's business.
 */
export async function SiteQuality({
  projectId,
  projectName,
  me,
}: {
  projectId: string;
  projectName: string;
  me: SelfResponse;
}) {
  const can = (permission: string) => me.permissions.includes(permission);
  if (can('quality.view') || can('quality.inspect')) {
    return <TeamView projectId={projectId} projectName={projectName} canInspect={can('quality.inspect')} />;
  }
  return <ClientView projectId={projectId} signerName={me.user.name} canSign={can('approvals.decide')} />;
}

async function TeamView({
  projectId,
  projectName,
  canInspect,
}: {
  projectId: string;
  projectName: string;
  canInspect: boolean;
}) {
  const t = await getT();
  const site = [{ id: projectId, name: projectName }];
  const [snags, inspections, tests, templates, contractors] = await Promise.all([
    serverFetch<{ items: SnagView[] }>(`/quality/snags?project_id=${projectId}&open_only=true`),
    serverFetch<{ items: QualityInspectionSummary[] }>(`/quality/inspections?project_id=${projectId}`),
    serverFetch<{ items: QualityTestView[] }>(`/quality/tests?project_id=${projectId}`),
    canInspect ? serverFetch<QualityTemplateView[]>('/quality/templates') : ([] as QualityTemplateView[]),
    // Contractors live behind the labour module; without it there is nobody to pick.
    canInspect ? serverFetch<Page<Contractor>>('/contractors?limit=200').catch(() => null) : null,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/quality/punch-list/print?project_id=${projectId}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <Printer className="size-4" />
          {t('Print punch list')}
        </Link>
        {canInspect && (
          <div className="flex flex-wrap gap-2">
            <NewTestDialog sites={site} fixedSiteId={projectId} />
            <NewInspectionDialog sites={site} templates={templates} fixedSiteId={projectId} />
            <NewSnagDialog
              sites={site}
              fixedSiteId={projectId}
              contractors={(contractors?.items ?? []).map((c) => ({ id: c.id, name: c.name }))}
            />
            <QuickCaptureDialog sites={site} fixedSiteId={projectId} />
          </div>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('Snags not yet closed')}</SectionTitle>
        {snags.items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={t('No open snags on this site')}
            body={t('Raise one with a photo from the site, or they appear on their own when an inspection line or a test fails.')}
          />
        ) : (
          <SnagBoard snags={snags.items} showSite={false} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('Inspections')}</SectionTitle>
        {inspections.items.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title={t('No inspections yet')}
            body={t('Run a checklist — a pre-pour check, a waterproofing flood test — on a phone at the spot, and sign it there.')}
          />
        ) : (
          <InspectionsTable inspections={inspections.items} showSite={false} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('Material tests')}</SectionTitle>
        {tests.items.length === 0 ? (
          <p className="text-[13.5px] text-ink-muted">{t('No tests recorded for this site yet.')}</p>
        ) : (
          <TestsTable tests={tests.items} showSite={false} canRecord={canInspect} />
        )}
      </section>
    </div>
  );
}

async function ClientView({
  projectId,
  signerName,
  canSign,
}: {
  projectId: string;
  signerName: string;
  canSign: boolean;
}) {
  const t = await getT();
  const { shortDate } = await getFormat();
  const [punch, shared] = await Promise.all([
    serverFetch<{ items: PunchListItemView[] }>(`/projects/${projectId}/punch-list`),
    serverFetch<{ items: QualityInspectionSummary[] }>(`/projects/${projectId}/quality/shared-inspections`),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t('Punch list')}</SectionTitle>
          {punch.items.length > 0 && (
            <Link
              href={`/quality/punch-list/print?project_id=${projectId}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Printer className="size-4" />
              {t('Print')}
            </Link>
          )}
        </div>
        {punch.items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={t('Nothing on the punch list')}
            body={t('Items the builder is putting right before handover appear here, with photos before and after.')}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {punch.items.map((item) => (
              <Card key={item.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-medium leading-snug">
                    <span className="me-1.5 font-mono text-[12px] text-ink-muted">#{item.number}</span>
                    {item.title}
                  </span>
                  <Badge tone={SNAG_STATUS[item.status].tone}>{t(SNAG_STATUS[item.status].label)}</Badge>
                </div>
                {item.description && <p className="text-[13.5px] leading-relaxed">{item.description}</p>}
                <span className="text-[12.5px] text-ink-muted">
                  {[item.location, item.trade ? t(item.trade) : null, t(SNAG_PRIORITY_LABELS[item.priority])]
                    .filter(Boolean)
                    .join(' · ')}
                  {item.due_on && item.status !== 'closed' ? ` · ${t('Due')} ${shortDate(item.due_on)}` : ''}
                </span>
                <BeforeAfter photos={item.photos} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('Inspections shared with you')}</SectionTitle>
        {shared.items.length === 0 ? (
          <p className="text-[13.5px] text-ink-muted">{t('No inspections have been shared with you yet.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shared.items.map((inspection) => {
              const countersigned = inspection.signed_by.some((party) => party !== 'inspector');
              return (
                <li key={inspection.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                    <Link href={`/quality/inspections/${inspection.id}`} className="flex min-w-0 flex-col hover:underline">
                      <span className="flex items-center gap-2 text-[14.5px] font-medium">
                        <FileCheck2 className="size-4 flex-none text-ink-muted" />
                        {inspection.title}
                      </span>
                      <span className="text-[12.5px] text-ink-muted">
                        #{inspection.number} · {inspection.location} · {shortDate(inspection.inspection_date)}
                      </span>
                    </Link>
                    <div className="flex items-center gap-2">
                      {inspection.result && (
                        <Badge tone={INSPECTION_RESULT[inspection.result].tone}>
                          {t(INSPECTION_RESULT[inspection.result].label)}
                        </Badge>
                      )}
                      {countersigned ? (
                        <Badge tone="done">{t('Countersigned')}</Badge>
                      ) : (
                        canSign && (
                          <CountersignDialog
                            view={{ id: inspection.id, title: inspection.title, number: inspection.number }}
                            signerName={signerName}
                          />
                        )
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{children}</span>
  );
}
