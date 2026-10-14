'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { AuditEntry } from '@sitebook/shared';
import { ArrowRight } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge, type Tone } from '@/components/ui/badge';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { Format } from '@/lib/format';
import { entityLabel, humanise, isMoneyColumn } from './audit-labels';

const ACTION_TONE: Record<string, Tone> = {
  create: 'done',
  update: 'accent',
  delete: 'blocked',
};

/** How many fields of a created or deleted row show before "and N more". */
const SNAPSHOT_FIELDS = 4;

/**
 * The log itself: who, what, when, and the change. Row changes read as `field: before → after`;
 * the named events (an approval, a reveal) show whatever detail the service recorded.
 */
export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const { t } = useLanguage();
  const format = useFormat();

  const columns: ColumnDef<AuditEntry>[] = [
    {
      id: 'when',
      header: t('When'),
      accessorFn: (entry) => entry.created_at,
      cell: ({ row }) => (
        <div className="flex flex-col whitespace-nowrap">
          <span className="text-[13.5px] text-ink">{format.instantDate(row.original.created_at)}</span>
          <span className="text-[12px] text-ink-muted">{format.timeOfDay(row.original.created_at)}</span>
        </div>
      ),
    },
    {
      id: 'who',
      header: t('Who'),
      accessorFn: (entry) => entry.actor?.name ?? entry.actor_type,
      cell: ({ row }) => {
        const entry = row.original;
        // A write through the public API is the key's, not a person's: say so beside its name.
        if (entry.actor && entry.actor_type === 'api_key') {
          return (
            <span className="flex flex-col whitespace-nowrap">
              <span className="text-[13.5px] font-medium">{entry.actor.name}</span>
              <span className="text-[12px] text-ink-muted">{t('API key')}</span>
            </span>
          );
        }
        if (entry.actor) return <span className="text-[13.5px] font-medium">{entry.actor.name}</span>;
        return (
          <span className="text-[13.5px] text-ink-muted">
            {entry.actor_type === 'platform' ? t('BUILDR support') : t('System')}
          </span>
        );
      },
    },
    {
      id: 'what',
      header: t('What'),
      accessorFn: (entry) => `${entityLabel(entry.entity)} ${entry.entity_label ?? ''} ${entry.action}`,
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'} dot={false}>
                {t(ACTION_TONE[entry.action] ? humanise(entry.action) : eventLabel(entry.action))}
              </Badge>
              <span className="text-[13.5px] text-ink">{t(entityLabel(entry.entity))}</span>
            </div>
            {entry.entity_label && (
              <span className="truncate text-[12.5px] text-ink-muted">{entry.entity_label}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'change',
      header: t('Change'),
      enableSorting: false,
      cell: ({ row }) => <ChangeSummary entry={row.original} format={format} t={t} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={entries}
      emptyMessage={t('No changes match these filters.')}
    />
  );
}

/** `expense.approved` → `Expense approved`. */
function eventLabel(action: string): string {
  return humanise(action);
}

function ChangeSummary({
  entry,
  format,
  t,
}: {
  entry: AuditEntry;
  format: Format;
  t: (english: string) => string;
}) {
  // An update: every changed field, before → after.
  if (entry.action === 'update' || (entry.changed_fields.length > 0 && entry.before && entry.after)) {
    return (
      <ul className="flex flex-col gap-1">
        {entry.changed_fields.map((field) => (
          <li key={field} className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
            <span className="font-medium text-ink-soft">{t(humanise(field))}</span>
            <span className="text-ink-muted line-through decoration-ink-faint">
              {display(field, entry.before?.[field], format, t)}
            </span>
            <ArrowRight className="size-3 flex-none self-center text-ink-faint rtl:rotate-180" />
            <span className="text-ink">{display(field, entry.after?.[field], format, t)}</span>
          </li>
        ))}
      </ul>
    );
  }

  // A create, a delete or a named event: the snapshot or detail that was recorded.
  const snapshot = entry.after ?? entry.before;
  if (!snapshot || Object.keys(snapshot).length === 0) {
    return <span className="text-[12.5px] text-ink-faint">—</span>;
  }
  const fields = Object.entries(snapshot).filter(([key]) => key !== 'id');
  const shown = fields.slice(0, SNAPSHOT_FIELDS);
  const rest = fields.slice(SNAPSHOT_FIELDS);

  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <FieldList fields={shown} format={format} t={t} />
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-accent hover:underline">
            {t('Show')} {rest.length} {t('more')}
          </summary>
          <div className="mt-1">
            <FieldList fields={rest} format={format} t={t} />
          </div>
        </details>
      )}
    </div>
  );
}

function FieldList({
  fields,
  format,
  t,
}: {
  fields: Array<[string, unknown]>;
  format: Format;
  t: (english: string) => string;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      {fields.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-medium text-ink-soft">{t(humanise(key))}</dt>
          <dd className="min-w-0 break-words text-ink">{display(key, value, format, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One value as a person would write it. */
function display(
  field: string,
  value: unknown,
  format: Format,
  t: (english: string) => string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value === '[redacted]') return t('hidden');
  if (typeof value === 'boolean') return value ? t('Yes') : t('No');
  if ((typeof value === 'number' || /^-?\d+$/.test(String(value))) && isMoneyColumn(field)) {
    return format.money(String(value));
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return `${format.instantDate(value)} ${format.timeOfDay(value)}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return format.shortDate(value);
  }
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
