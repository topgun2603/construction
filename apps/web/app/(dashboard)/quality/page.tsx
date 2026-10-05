import Link from 'next/link';
import { ClipboardCheck, FlaskConical, Lock, ShieldCheck } from 'lucide-react';
import {
  QUALITY_INSPECTION_RESULTS,
  QUALITY_TEST_TYPE_LABELS,
  QUALITY_TEST_TYPES,
  type QualityInspectionSummary,
  type QualitySummaryReport,
  type QualityTemplateView,
  type QualityTestView,
  type SnagView,
} from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf, type SelfResponse } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { Contractor, Page, ProjectSummary, TeamMember } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { ANY, INSPECTION_RESULT, TEST_STATE, filterQuery } from './labels';
import { InspectionsTable, NewInspectionDialog } from './inspections';
import { NewTestDialog, TestsTable } from './tests';
import { NewSnagDialog, QuickCaptureDialog } from './snag-dialogs';
import { SnagBoard, SnagFilters, SnagList } from './snags';
import { UrlFilters } from './url-filters';
import { QualityReportsView } from './reports-view';

export const metadata = { title: 'Quality · BUILDR' };

const TABS = ['snags', 'inspections', 'tests', 'reports'] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  snags: 'Snags',
  inspections: 'Inspections',
  tests: 'Tests',
  reports: 'Reports',
};

type Search = Record<string, string | undefined>;

/** A filter value from the URL, or undefined when it is absent or the "any" placeholder. */
function pick(search: Search, key: string): string | undefined {
  const value = search[key];
  return value && value !== ANY ? value : undefined;
}

/**
 * QA/QC across every site the caller can see (roadmap Phase 2, module 7): the snag board,
 * inspections, material tests, and the summary a quality manager reports from.
 *
 * Each tab fetches only its own list. The snag board is the default because it is the one that
 * changes every day — inspections and tests are records, snags are work.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getT();
  const me = await requireSelf();
  const search = await searchParams;
  const canView = me.permissions.includes('quality.view');
  const canInspect = me.permissions.includes('quality.inspect');

  if (!canView && !canInspect) {
    return (
      <EmptyState
        icon={<Lock />}
        title={t('Quality is not part of your role')}
        body={t('Ask an owner for access to inspections and snag lists in Settings → Roles.')}
      />
    );
  }

  // The summary and its exports need `quality.view`: somebody who only inspects runs checklists
  // and fixes snags, but the company-wide picture is the quality manager's.
  const tabs = TABS.filter((tab) => tab !== 'reports' || canView);
  const active: TabKey = (tabs as readonly string[]).includes(search.tab ?? '')
    ? (search.tab as TabKey)
    : 'snags';
  const projectId = pick(search, 'project_id');

  const sitesPage = await serverFetch<Page<ProjectSummary>>('/projects?limit=200');
  const sites = sitesPage.items.map((site) => ({ id: site.id, name: site.name }));
  // Contractors live behind the labour module; without it there is nobody to pick.
  const contractors =
    active === 'snags'
      ? ((await serverFetch<Page<Contractor>>('/contractors?limit=200').catch(() => null))?.items ?? []).map(
          (contractor) => ({ id: contractor.id, name: contractor.name }),
        )
      : [];

  // The checklists, only for the dialog that starts an inspection from one.
  const templates =
    active === 'inspections' && canInspect
      ? await serverFetch<QualityTemplateView[]>('/quality/templates')
      : [];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Quality')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Inspections, material tests and snag lists, with photos and sign-off.')}
          </p>
        </div>
        {canInspect && (
          <div className="flex flex-wrap gap-2">
            {active === 'inspections' && (
              <NewInspectionDialog sites={sites} templates={templates} />
            )}
            {active === 'tests' && <NewTestDialog sites={sites} />}
            {(active === 'snags' || active === 'reports') && (
              <>
                <NewSnagDialog sites={sites} contractors={contractors} />
                <QuickCaptureDialog sites={sites} />
              </>
            )}
          </div>
        )}
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab}
            href={`/quality?${filterQuery({ tab, project_id: projectId })}`}
            aria-current={tab === active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight transition',
              tab === active
                ? 'border-accent font-semibold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:text-ink',
            )}
          >
            {t(TAB_LABELS[tab])}
          </Link>
        ))}
      </nav>

      {active === 'snags' && (
        <SnagsTab search={search} sites={sites} contractors={contractors} me={me} />
      )}
      {active === 'inspections' && <InspectionsTab search={search} sites={sites} />}
      {active === 'tests' && <TestsTab search={search} sites={sites} canRecord={canInspect} />}
      {active === 'reports' && <ReportsTab search={search} sites={sites} />}
    </FadeIn>
  );
}

async function SnagsTab({
  search,
  sites,
  contractors,
  me,
}: {
  search: Search;
  sites: Array<{ id: string; name: string }>;
  contractors: Array<{ id: string; name: string }>;
  me: SelfResponse;
}) {
  const t = await getT();
  const status = pick(search, 'status');
  const assignee = pick(search, 'assignee');
  const query = filterQuery({
    project_id: pick(search, 'project_id'),
    // No status chosen means "everything not yet closed" — the working list.
    ...(status === 'all' ? {} : status ? { status } : { open_only: 'true' }),
    priority: pick(search, 'priority'),
    trade: pick(search, 'trade'),
    assigned_user_id: assignee?.startsWith('u:') ? assignee.slice(2) : undefined,
    assigned_contractor_id: assignee?.startsWith('c:') ? assignee.slice(2) : undefined,
  });

  /*
   * The team list is a management read (team, projects, wages or audit); a supervisor without it
   * still filters by contractor and sees whose name is on each card.
   */
  const canListTeam = ['team.manage', 'projects.manage', 'wages.view', 'audit.view'].some((p) =>
    me.permissions.includes(p),
  );
  const [snags, team] = await Promise.all([
    serverFetch<{ items: SnagView[] }>(`/quality/snags?${query}`),
    canListTeam
      ? serverFetch<TeamMember[]>('/tenants/current/team').catch(() => [] as TeamMember[])
      : ([] as TeamMember[]),
  ]);
  const people = team
    .filter((person) => person.role !== 'client' && person.status === 'active')
    .map((person) => ({ id: person.id, name: person.name }));

  return (
    <div className="flex flex-col gap-4">
      <SnagFilters
        values={{
          project_id: pick(search, 'project_id'),
          status,
          trade: pick(search, 'trade'),
          priority: pick(search, 'priority'),
          assignee,
          view: pick(search, 'view'),
        }}
        sites={sites}
        people={people}
        contractors={contractors}
      />
      {snags.items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={t('No snags here')}
          body={t(
            'Raise one with a photo from the site, or they appear on their own when an inspection line or a test fails.',
          )}
        />
      ) : search.view === 'list' ? (
        <SnagList snags={snags.items} />
      ) : (
        <SnagBoard snags={snags.items} />
      )}
    </div>
  );
}

async function InspectionsTab({ search, sites }: { search: Search; sites: Array<{ id: string; name: string }> }) {
  const t = await getT();
  const status = pick(search, 'status');
  const result = pick(search, 'result');
  const query = filterQuery({
    project_id: pick(search, 'project_id'),
    status,
    result,
    from: pick(search, 'from'),
    to: pick(search, 'to'),
  });
  const list = await serverFetch<{ items: QualityInspectionSummary[] }>(`/quality/inspections?${query}`);

  return (
    <div className="flex flex-col gap-4">
      <UrlFilters
        tab="inspections"
        values={{ project_id: pick(search, 'project_id'), status, result, from: pick(search, 'from'), to: pick(search, 'to') }}
        dates
        fields={[
          {
            key: 'project_id',
            placeholder: t('All sites'),
            options: sites.length > 1 ? sites.map((site) => ({ value: site.id, label: site.name })) : [],
          },
          {
            key: 'status',
            placeholder: t('Any status'),
            options: [
              { value: 'in_progress', label: t('In progress') },
              { value: 'completed', label: t('Completed') },
            ],
          },
          {
            key: 'result',
            placeholder: t('Any result'),
            options: QUALITY_INSPECTION_RESULTS.map((value) => ({
              value,
              label: t(INSPECTION_RESULT[value].label),
            })),
          },
        ]}
      />
      {list.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={t('No inspections yet')}
          body={t(
            'Run a checklist — a pre-pour check, a waterproofing flood test — on a phone at the spot, and sign it there.',
          )}
        />
      ) : (
        <InspectionsTable inspections={list.items} />
      )}
    </div>
  );
}

async function TestsTab({
  search,
  sites,
  canRecord,
}: {
  search: Search;
  sites: Array<{ id: string; name: string }>;
  canRecord: boolean;
}) {
  const t = await getT();
  const state = pick(search, 'state');
  const testType = pick(search, 'test_type');
  const query = filterQuery({ project_id: pick(search, 'project_id'), state, test_type: testType });
  const list = await serverFetch<{ items: QualityTestView[] }>(`/quality/tests?${query}`);

  return (
    <div className="flex flex-col gap-4">
      <UrlFilters
        tab="tests"
        values={{ project_id: pick(search, 'project_id'), state, test_type: testType }}
        fields={[
          {
            key: 'project_id',
            placeholder: t('All sites'),
            options: sites.length > 1 ? sites.map((site) => ({ value: site.id, label: site.name })) : [],
          },
          {
            key: 'state',
            placeholder: t('Any state'),
            options: [
              { value: 'pending', label: t('Waiting for a result') },
              { value: 'due', label: t(TEST_STATE.due.label) },
              { value: 'overdue', label: t(TEST_STATE.overdue.label) },
              { value: 'pass', label: t(TEST_STATE.pass.label) },
              { value: 'fail', label: t(TEST_STATE.fail.label) },
            ],
          },
          {
            key: 'test_type',
            placeholder: t('Any test'),
            options: QUALITY_TEST_TYPES.map((value) => ({ value, label: t(QUALITY_TEST_TYPE_LABELS[value]) })),
          },
        ]}
      />
      {list.items.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title={t('No tests recorded')}
          body={t(
            'Log a cube set the day it is cast; each age comes due on its own day, and the result is judged against the specification.',
          )}
        />
      ) : (
        <TestsTable tests={list.items} canRecord={canRecord} />
      )}
    </div>
  );
}

async function ReportsTab({ search, sites }: { search: Search; sites: Array<{ id: string; name: string }> }) {
  const t = await getT();
  const filters = { project_id: pick(search, 'project_id'), from: pick(search, 'from'), to: pick(search, 'to') };
  const report = await serverFetch<QualitySummaryReport>(`/quality/reports/summary?${filterQuery(filters)}`);
  return (
    <div className="flex flex-col gap-4">
      <UrlFilters
        tab="reports"
        values={filters}
        dates
        fields={[
          {
            key: 'project_id',
            placeholder: t('All sites'),
            options: sites.length > 1 ? sites.map((site) => ({ value: site.id, label: site.name })) : [],
          },
        ]}
      />
      <QualityReportsView report={report} filters={filters} />
    </div>
  );
}
