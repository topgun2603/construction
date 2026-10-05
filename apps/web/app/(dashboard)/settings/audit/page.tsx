import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AuditEntry } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Page, TeamMember } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { AuditFilters, type AuditFilterValues } from './audit-filters';
import { AuditTable } from './audit-table';

export const metadata = { title: 'Audit log · BUILDR' };

const FILTER_KEYS = ['from', 'to', 'actor_id', 'entity', 'entity_id', 'action'] as const;

/**
 * Every change anybody made (roadmap Phase 3): who, what, when, and the before and after.
 *
 * Written by the database itself, so there is no screen in the product whose changes are missing
 * from here. Filters are in the URL; paging is by cursor, newest first, the way the API serves it.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireSelf();
  if (!me.permissions.includes('audit.view')) notFound();

  const t = await getT();
  const params = await searchParams;
  const values: AuditFilterValues = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (value) values[key] = value;
  }

  const query = new URLSearchParams({ ...values, limit: '100' });
  if (params['cursor']) query.set('cursor', params['cursor']);

  const [page, team] = await Promise.all([
    serverFetch<Page<AuditEntry>>(`/audit?${query.toString()}`),
    serverFetch<TeamMember[]>('/tenants/current/team'),
  ]);

  const olderQuery = new URLSearchParams({ ...values });
  if (page.next_cursor) olderQuery.set('cursor', page.next_cursor);
  const newestQuery = new URLSearchParams({ ...values }).toString();

  return (
    <FadeIn className="flex flex-col gap-4">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
        {t('Every record anybody created, changed or deleted, with what it was before and after — and the approvals and payments by name. Recorded by the database itself, so nothing in the app can skip it. Secret values such as document numbers are shown only as changed.')}
      </p>

      <AuditFilters
        values={values}
        people={team.map((member) => ({ id: member.id, name: member.name }))}
      />

      <AuditTable entries={page.items} />

      {(page.next_cursor || params['cursor']) && (
        <div className="flex items-center justify-between gap-3">
          {params['cursor'] ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={newestQuery ? `?${newestQuery}` : '?'}>{t('Back to newest')}</Link>
            </Button>
          ) : (
            <span />
          )}
          {page.next_cursor && (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`?${olderQuery.toString()}`}>{t('Older entries')}</Link>
            </Button>
          )}
        </div>
      )}
    </FadeIn>
  );
}
