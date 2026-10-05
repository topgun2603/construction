import Link from 'next/link';
import { Layers, Lock } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { CostCodeTemplate, CostCodeTemplateSummary } from '@/lib/cost-code-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';
import { NewTemplateDialog, TemplateEditor } from './template-editor';

export const metadata = { title: 'Cost codes · BUILDR' };

/**
 * The company's library of cost code templates (roadmap Phase 2, module 1).
 *
 * A template is the breakdown a new site starts from. The built-in one is shown alongside the
 * company's own and is read-only — copying it is how a company makes it theirs — so an improvement
 * to it can ship without overwriting anybody's edits.
 */
export default async function CostCodeTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const t = await getT();
  const me = await requireSelf();
  if (!me.permissions.includes('cost_codes.view')) {
    return (
      <EmptyState
        icon={<Lock />}
        title={t('Cost codes are not part of your role')}
        body={t('Ask an owner for access to cost codes and budgets in Settings → Roles.')}
      />
    );
  }

  const { template: wanted } = await searchParams;
  const templates = await serverFetch<CostCodeTemplateSummary[]>('/cost-code-templates');
  const selectedId = templates.some((item) => item.id === wanted) ? wanted! : templates[0]!.id;
  const selected = await serverFetch<CostCodeTemplate>(`/cost-code-templates/${selectedId}`);
  const canManage = me.permissions.includes('cost_codes.manage');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          {t(
            'The work breakdowns a site can start from. Applying one copies its lines into the site, where each gets its own budget; changing a template later never changes a site already started from it.',
          )}
        </p>
        {canManage && <NewTemplateDialog templates={templates} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="flex h-fit flex-col">
          <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Templates')}
          </div>
          <ul className="divide-y divide-line-soft">
            {templates.map((template) => (
              <li key={template.id}>
                <Link
                  href={`/settings/cost-codes?template=${template.id}`}
                  aria-current={template.id === selectedId ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-2.5 text-[14px] transition hover:bg-raised',
                    template.id === selectedId && 'bg-raised font-semibold',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Layers className="size-4 flex-none text-ink-faint" />
                    <span className="truncate">{template.name}</span>
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    {template.builtin && (
                      <Badge tone="neutral" dot={false}>
                        {t('Built in')}
                      </Badge>
                    )}
                    <span className="font-mono text-[12px] text-ink-muted">{template.items}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <TemplateEditor key={selected.id} template={selected} canManage={canManage} />
      </div>
    </FadeIn>
  );
}
