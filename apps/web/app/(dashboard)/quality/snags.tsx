'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Columns3, List, MapPin, User } from 'lucide-react';
import {
  SNAG_PRIORITIES,
  SNAG_STATUSES,
  SNAG_TRADES,
  type SnagStatus,
  type SnagView,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { cn } from '@/lib/utils';
import { ANY, filterQuery, SNAG_PRIORITY, SNAG_STATUS } from './labels';
import { PhotoStrip } from './quality-ui';
import type { PersonOption, SiteOption } from './snag-dialogs';

export interface SnagFilterValues {
  project_id?: string;
  status?: string;
  trade?: string;
  priority?: string;
  /** `u:<id>` for a person, `c:<id>` for a contractor — one picker for "whose is it". */
  assignee?: string;
  view?: string;
}

/**
 * The snag filters. They live in the URL, so a filtered board ("everything open on plumbing at
 * Tower B") is a link a manager can send, and the export downloads exactly what is on screen.
 */
export function SnagFilters({
  values,
  sites,
  people,
  contractors,
}: {
  values: SnagFilterValues;
  sites: SiteOption[];
  people: PersonOption[];
  contractors: PersonOption[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  function apply(next: Partial<SnagFilterValues>) {
    const query = filterQuery({ tab: 'snags', ...values, ...next });
    router.push(`${pathname}?${query}`);
  }

  const picker = (
    key: keyof SnagFilterValues,
    placeholder: string,
    options: Array<{ value: string; label: string }>,
    width = 'w-[150px]',
  ) => (
    <Select value={values[key] ?? ANY} onValueChange={(value) => apply({ [key]: value })}>
      <SelectTrigger className={cn('h-9 text-[13.5px]', width)} aria-label={placeholder}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const board = values.view !== 'list';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sites.length > 1 &&
        picker(
          'project_id',
          t('All sites'),
          sites.map((site) => ({ value: site.id, label: site.name })),
          'w-[170px]',
        )}
      {picker(
        'status',
        t('Not closed'),
        [
          ...SNAG_STATUSES.map((status) => ({ value: status, label: t(SNAG_STATUS[status].label) })),
          { value: 'all', label: t('Everything') },
        ],
      )}
      {picker(
        'priority',
        t('Any priority'),
        SNAG_PRIORITIES.map((priority) => ({ value: priority, label: t(SNAG_PRIORITY[priority].label) })),
      )}
      {picker(
        'trade',
        t('Any trade'),
        SNAG_TRADES.map((trade) => ({ value: trade, label: t(trade) })),
      )}
      {(people.length > 0 || contractors.length > 0) &&
        picker(
          'assignee',
          t('Anybody'),
          [
            ...people.map((person) => ({ value: `u:${person.id}`, label: person.name })),
            ...contractors.map((contractor) => ({ value: `c:${contractor.id}`, label: contractor.name })),
          ],
          'w-[170px]',
        )}
      <div className="ms-auto flex gap-1">
        <Button
          type="button"
          size="icon"
          variant={board ? 'secondary' : 'ghost'}
          className="size-9"
          onClick={() => apply({ view: undefined })}
          aria-label={t('Board')}
          aria-pressed={board}
        >
          <Columns3 className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={board ? 'ghost' : 'secondary'}
          className="size-9"
          onClick={() => apply({ view: 'list' })}
          aria-label={t('List')}
          aria-pressed={!board}
        >
          <List className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** One snag as a card: what, where, whose, how urgent, and the before/after pictures. */
export function SnagCard({ snag, showSite = true }: { snag: SnagView; showSite?: boolean }) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const before = snag.photos.filter((photo) => photo.stage === 'before').slice(0, 2);
  const after = snag.photos.filter((photo) => photo.stage === 'after').slice(0, 2);
  const assignee = snag.assigned_user?.name ?? snag.assigned_contractor?.name ?? null;

  return (
    <Link href={`/quality/snags/${snag.id}`} className="block">
      <Card className="flex flex-col gap-2 p-3 transition hover:border-line-strong hover:bg-raised">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-medium leading-snug">
            <span className="me-1 font-mono text-[12px] text-ink-muted">#{snag.number}</span>
            {snag.title}
          </span>
          <Badge tone={SNAG_PRIORITY[snag.priority].tone} dot={false} className="text-[11px]">
            {t(SNAG_PRIORITY[snag.priority].label)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-muted">
          {showSite && <span>{snag.project.name}</span>}
          {snag.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {snag.location}
            </span>
          )}
          {snag.trade && <span>{t(snag.trade)}</span>}
          {assignee && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {assignee}
            </span>
          )}
          {snag.due_on && (
            <span className={cn('inline-flex items-center gap-1', snag.overdue && 'font-semibold text-blocked-fg')}>
              {snag.overdue ? <AlertTriangle className="size-3" /> : <CalendarClock className="size-3" />}
              {shortDate(snag.due_on)}
            </span>
          )}
        </div>
        {(before.length > 0 || after.length > 0) && (
          <div className="flex items-center gap-1.5">
            <PhotoStrip photos={before} size="sm" className="gap-1" linked={false} />
            {after.length > 0 && (
              <>
                <span className="text-ink-faint rtl:rotate-180">→</span>
                <PhotoStrip photos={after} size="sm" className="gap-1" linked={false} />
              </>
            )}
          </div>
        )}
      </Card>
    </Link>
  );
}

/**
 * The board: a column per status, so the eye reads the flow — drafts waiting for somebody to
 * confirm, open work, fixes waiting to be checked, and what is done. Closed is the last column
 * and the first to be filtered away.
 */
export function SnagBoard({ snags, showSite = true }: { snags: SnagView[]; showSite?: boolean }) {
  const { t } = useLanguage();
  const statuses = SNAG_STATUSES.filter(
    (status) => status !== 'closed' || snags.some((snag) => snag.status === 'closed'),
  );
  return (
    <div className={cn('grid gap-3 md:grid-cols-2', statuses.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
      {statuses.map((status) => {
        const column = snags.filter((snag) => snag.status === status);
        return (
          <div key={status} className="flex min-w-0 flex-col gap-2 rounded-panel bg-raised p-2">
            <div className="flex items-center justify-between px-1 pt-1">
              <Badge tone={SNAG_STATUS[status].tone}>{t(SNAG_STATUS[status].label)}</Badge>
              <span className="font-mono text-[12px] text-ink-muted">{column.length}</span>
            </div>
            {column.length === 0 ? (
              <p className="px-1 py-3 text-[12.5px] text-ink-faint">{t(EMPTY_COLUMN[status])}</p>
            ) : (
              column.map((snag) => <SnagCard key={snag.id} snag={snag} showSite={showSite} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

const EMPTY_COLUMN: Record<SnagStatus, string> = {
  draft: 'No drafts waiting to be confirmed.',
  open: 'Nothing open.',
  fixed: 'Nothing waiting to be checked.',
  closed: 'Nothing closed yet.',
};

/** The same snags as a plain list, for a long one or a phone. */
export function SnagList({ snags, showSite = true }: { snags: SnagView[]; showSite?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2">
      {snags.map((snag) => (
        <div key={snag.id} className="flex items-stretch gap-2">
          <div className="flex w-[76px] flex-none items-start pt-3">
            <Badge tone={SNAG_STATUS[snag.status].tone}>{t(SNAG_STATUS[snag.status].label)}</Badge>
          </div>
          <div className="min-w-0 flex-1">
            <SnagCard snag={snag} showSite={showSite} />
          </div>
        </div>
      ))}
    </div>
  );
}
