import Link from 'next/link';
import { ClipboardList, Lock } from 'lucide-react';
import type { QualityTemplateView } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/utils';
import { NewQualityTemplateDialog, QualityTemplateEditor } from './template-editor';

export const metadata = { title: 'Quality checklists · BUILDR' };

/**
 * The company's checklist library (roadmap Phase 2, module 7).
 *
 * It starts with the standard checklists — pre-pour, reinforcement, waterproofing, tiling — copied
 * in as the company's own to edit. Archived ones are listed last so they can be restored; a
 * checklist that has been used is archived rather than deleted, because signed inspections point
 * at it.
 */
export default async function QualityTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const t = await getT();
  const me = await requireSelf();
  const canManage = me.permissions.includes('quality.manage');
  if (!canManage && !me.permissions.includes('quality.view') && !me.permissions.includes('quality.inspect')) {
    return (
      <EmptyState
        icon={<Lock />}
        title={t('Quality is not part of your role')}
        body={t('Ask an owner for access to the checklist library in Settings → Roles.')}
      />
    );
  }

  const { template: wanted } = await searchParams;
  const templates = await serverFetch<QualityTemplateView[]>('/quality/templates?include_archived=true');
  // Active first, then archived; each group in the order the API sent it.
  const ordered = [...templates.filter((item) => item.active), ...templates.filter((item) => !item.active)];
  const selected = ordered.find((item) => item.id === wanted) ?? ordered[0];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          {t(
            'The checklists an inspection can be run from. Starting an inspection copies the lines, so changing a checklist here never changes an inspection already started or signed.',
          )}
        </p>
        {canManage && <NewQualityTemplateDialog templates={ordered.filter((item) => item.active)} />}
      </div>

      {!selected ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t('No checklists yet')}
          body={t('Create one, line by line: what to check, and for a measurement the target and tolerance.')}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="flex h-fit flex-col">
            <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Checklists')}
            </div>
            <ul className="divide-y divide-line-soft">
              {ordered.map((template) => (
                <li key={template.id}>
                  <Link
                    href={`/settings/quality?template=${template.id}`}
                    aria-current={template.id === selected.id ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-3 px-4 py-2.5 text-[14px] transition hover:bg-raised',
                      template.id === selected.id && 'bg-raised font-semibold',
                      !template.active && 'text-ink-muted',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{template.name}</span>
                      {template.trade && (
                        <span className="text-[12px] font-normal text-ink-muted">{template.trade}</span>
                      )}
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      {!template.active && (
                        <Badge tone="neutral" dot={false}>
                          {t('Archived')}
                        </Badge>
                      )}
                      <span className="font-mono text-[12px] text-ink-muted">{template.item_count}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <QualityTemplateEditor key={`${selected.id}-${selected.updated_at}`} template={selected} canManage={canManage} />
        </div>
      )}
    </FadeIn>
  );
}
