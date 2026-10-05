'use client';

import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  SAFETY_CATEGORY_LABELS,
  SAFETY_INCIDENT_TYPE_LABELS,
  SAFETY_OBSERVATION_TYPE_LABELS,
  SAFETY_PERMIT_TYPE_LABELS,
  type SafetyCategory,
} from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type {
  SafetyIncidentSummary,
  SafetyObservationSummary,
  SafetyPermitSummary,
  SafetyTalkSummary,
} from '@/lib/safety-types';
import { INCIDENT_STATUS, OBSERVATION_STATUS, SEVERITY, permitBadge } from './labels';

/**
 * The four safety registers as tables, company-wide on /safety and one site's on its Safety tab.
 * Times show on the company's clock.
 */

function siteColumn<T extends { project: { name: string } }>(label: string): ColumnDef<T> {
  return { id: 'site', accessorFn: (row) => row.project.name, header: label };
}

function Number_({ value }: { value: string }) {
  return (
    <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
      {value}
    </span>
  );
}

export function IncidentsTable({ items, showSite = true }: { items: SafetyIncidentSummary[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<SafetyIncidentSummary>[] = [
    {
      accessorKey: 'title',
      header: t('Incident'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.title}</span>
          <Number_ value={row.original.number} />
        </div>
      ),
    },
    {
      accessorKey: 'type',
      header: t('Type'),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span>{t(SAFETY_INCIDENT_TYPE_LABELS[row.original.type])}</span>
          <Badge tone={SEVERITY[row.original.severity].tone}>{t(SEVERITY[row.original.severity].label)}</Badge>
        </div>
      ),
    },
    ...(showSite ? [siteColumn<SafetyIncidentSummary>(t('Site'))] : []),
    {
      accessorKey: 'occurred_at',
      header: t('When'),
      cell: ({ row }) => (
        <span className="text-[13px]">
          {instantDate(row.original.occurred_at)}, {timeOfDay(row.original.occurred_at)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={INCIDENT_STATUS[row.original.status].tone}>{t(INCIDENT_STATUS[row.original.status].label)}</Badge>
          {row.original.open_actions > 0 && (
            <span className="text-[12px] text-ink-muted">
              {row.original.open_actions} {t('open actions')}
            </span>
          )}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search incidents')}
      emptyMessage={t('No incidents or near misses reported.')}
      onRowClick={(row) => router.push(`/safety/incidents/${row.id}`)}
    />
  );
}

export function PermitsTable({ items, showSite = true }: { items: SafetyPermitSummary[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<SafetyPermitSummary>[] = [
    {
      accessorKey: 'description',
      header: t('Permit'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{t(SAFETY_PERMIT_TYPE_LABELS[row.original.type])}</span>
          <span className="text-[12.5px] text-ink-muted">{row.original.description}</span>
          <Number_ value={row.original.number} />
        </div>
      ),
    },
    { accessorKey: 'area', header: t('Area') },
    ...(showSite ? [siteColumn<SafetyPermitSummary>(t('Site'))] : []),
    {
      accessorKey: 'valid_to',
      header: t('Valid'),
      cell: ({ row }) => (
        <span className="text-[13px]">
          {instantDate(row.original.valid_from)} {timeOfDay(row.original.valid_from)} –{' '}
          {timeOfDay(row.original.valid_to)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const badge = permitBadge(row.original);
        return <Badge tone={badge.tone}>{t(badge.label)}</Badge>;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search permits')}
      emptyMessage={t('No permits to work yet.')}
      onRowClick={(row) => router.push(`/safety/permits/${row.id}`)}
    />
  );
}

export function TalksTable({ items, showSite = true }: { items: SafetyTalkSummary[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<SafetyTalkSummary>[] = [
    { accessorKey: 'talk_date', header: t('Date'), cell: ({ row }) => shortDate(row.original.talk_date) },
    { accessorKey: 'topic', header: t('Topic'), cell: ({ row }) => t(row.original.topic) },
    ...(showSite ? [siteColumn<SafetyTalkSummary>(t('Site'))] : []),
    { id: 'presenter', accessorFn: (row) => row.presenter?.name ?? '', header: t('Given by') },
    {
      accessorKey: 'attendees',
      header: () => <span className="block text-end">{t('Attended')}</span>,
      cell: ({ row }) => (
        <div className="text-end font-mono text-[13px]">
          {row.original.attendees}
          {row.original.signed < row.original.attendees && (
            <span className="text-ink-muted"> ({row.original.signed} {t('signed')})</span>
          )}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search talks')}
      emptyMessage={t('No toolbox talks recorded.')}
      onRowClick={(row) => router.push(`/safety/talks/${row.id}`)}
    />
  );
}

export function ObservationsTable({
  items,
  showSite = true,
}: {
  items: SafetyObservationSummary[];
  showSite?: boolean;
}) {
  const { t } = useLanguage();
  const { instantDate } = useFormat();
  const router = useRouter();
  const columns: ColumnDef<SafetyObservationSummary>[] = [
    {
      accessorKey: 'description',
      header: t('Observation'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="line-clamp-2 font-medium">{row.original.description}</span>
          <Number_ value={row.original.number} />
        </div>
      ),
    },
    {
      accessorKey: 'category',
      header: t('Category'),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <span>{t(SAFETY_CATEGORY_LABELS[row.original.category as SafetyCategory] ?? row.original.category)}</span>
          <span className="text-[12px] text-ink-muted">{t(SAFETY_OBSERVATION_TYPE_LABELS[row.original.type])}</span>
        </div>
      ),
    },
    ...(showSite ? [siteColumn<SafetyObservationSummary>(t('Site'))] : []),
    { accessorKey: 'observed_at', header: t('Seen'), cell: ({ row }) => instantDate(row.original.observed_at) },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={OBSERVATION_STATUS[row.original.status].tone}>
            {t(OBSERVATION_STATUS[row.original.status].label)}
          </Badge>
          {row.original.type !== 'positive' && (
            <Badge tone={SEVERITY[row.original.severity].tone} dot={false}>
              {t(SEVERITY[row.original.severity].label)}
            </Badge>
          )}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder={t('Search observations')}
      emptyMessage={t('No observations yet.')}
      onRowClick={(row) => router.push(`/safety/observations/${row.id}`)}
    />
  );
}
