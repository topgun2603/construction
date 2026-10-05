'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { ENTITY_FILTER_ORDER, entityLabel } from './audit-labels';

export interface AuditFilterValues {
  from?: string;
  to?: string;
  actor_id?: string;
  entity?: string;
  entity_id?: string;
  action?: string;
}

/** Radix Select cannot hold an empty value, so "any" has a name of its own. */
const ANY = 'any';

const ACTIONS = [
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Changed' },
  { value: 'delete', label: 'Deleted' },
  { value: 'event', label: 'Approvals and payments' },
];

/**
 * The filters live in the URL, so a filtered view is a link an owner can send to their accountant,
 * and the export button exports exactly what is on screen.
 */
export function AuditFilters({
  values,
  people,
}: {
  values: AuditFilterValues;
  people: Array<{ id: string; name: string }>;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  function apply(next: Partial<AuditFilterValues>) {
    const merged = { ...values, ...next };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== ANY) query.set(key, value);
    }
    // A new filter starts from the newest entry again, so no cursor carries over.
    router.push(query.size > 0 ? `${pathname}?${query.toString()}` : pathname);
  }

  const exportQuery = new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const filtered = Object.values(values).some(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={values.from ?? ''}
        max={values.to}
        onChange={(event) => apply({ from: event.target.value })}
        className="w-[160px]"
        aria-label={t('From date')}
      />
      <span className="text-ink-muted rtl:rotate-180">→</span>
      <Input
        type="date"
        value={values.to ?? ''}
        min={values.from}
        onChange={(event) => apply({ to: event.target.value })}
        className="w-[160px]"
        aria-label={t('To date')}
      />

      <Select value={values.actor_id ?? ANY} onValueChange={(value) => apply({ actor_id: value })}>
        <SelectTrigger className="w-[170px]" aria-label={t('Who')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('Anyone')}</SelectItem>
          {people.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={values.entity ?? ANY}
        // A different kind of record makes a pinned record id meaningless.
        onValueChange={(value) => apply({ entity: value, entity_id: undefined })}
      >
        <SelectTrigger className="w-[170px]" aria-label={t('Record')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('Every record')}</SelectItem>
          {ENTITY_FILTER_ORDER.map((entity) => (
            <SelectItem key={entity} value={entity}>
              {t(entityLabel(entity))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={values.action ?? ANY} onValueChange={(value) => apply({ action: value })}>
        <SelectTrigger className="w-[190px]" aria-label={t('Action')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('Any change')}</SelectItem>
          {ACTIONS.map((action) => (
            <SelectItem key={action.value} value={action.value}>
              {t(action.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered && (
        <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
          <X className="size-4" />
          {t('Clear')}
        </Button>
      )}

      <Button variant="secondary" size="sm" asChild className="ms-auto">
        {/* A plain link: the route handler answers with the file, and the browser saves it. */}
        <a href={`${pathname}/export${exportQuery ? `?${exportQuery}` : ''}`} download>
          <Download className="size-4" />
          {t('Export CSV')}
        </a>
      </Button>
    </div>
  );
}
