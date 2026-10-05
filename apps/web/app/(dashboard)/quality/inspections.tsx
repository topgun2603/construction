'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import type { QualityInspectionSummary, QualityTemplateView } from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { Milestone } from '@/lib/api-types';
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
import { milestoneOptions, startInspection } from '@/lib/quality-actions';
import { ANY, INSPECTION_RESULT } from './labels';
import { FormError } from './quality-ui';
import type { SiteOption } from './snag-dialogs';

/**
 * Inspections as a table: company-wide on /quality, one site's on its Quality tab. A row opens the
 * runner while it is in progress and the signed report once it is not — the same page either way.
 */
export function InspectionsTable({
  inspections,
  showSite = true,
}: {
  inspections: QualityInspectionSummary[];
  showSite?: boolean;
}) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const router = useRouter();

  const columns: ColumnDef<QualityInspectionSummary>[] = [
    {
      accessorKey: 'number',
      header: t('Inspection'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.title}</span>
          <span className="text-[12px] text-ink-muted">
            <span className="font-mono">#{row.original.number}</span> · {row.original.location}
          </span>
        </div>
      ),
    },
    ...(showSite
      ? [
          {
            id: 'site',
            accessorFn: (row: QualityInspectionSummary) => row.project.name,
            header: t('Site'),
          } satisfies ColumnDef<QualityInspectionSummary>,
        ]
      : []),
    {
      accessorKey: 'inspection_date',
      header: t('Date'),
      cell: ({ row }) => <span className="font-mono text-[13px]">{shortDate(row.original.inspection_date)}</span>,
    },
    {
      id: 'inspector',
      accessorFn: (row) => row.inspector?.name ?? '',
      header: t('Inspector'),
    },
    {
      id: 'progress',
      accessorFn: (row) => row.counts.answered / Math.max(row.counts.total, 1),
      header: t('Lines'),
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">
          {row.original.counts.answered}/{row.original.counts.total}
          {row.original.counts.failed > 0 && (
            <span className="ms-1.5 text-blocked-fg">
              {row.original.counts.failed} {t('failed')}
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('Result'),
      cell: ({ row }) => {
        const { status, result, snag_count, signed_by } = row.original;
        if (status === 'in_progress' || !result) return <Badge tone="accent">{t('In progress')}</Badge>;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={INSPECTION_RESULT[result].tone}>{t(INSPECTION_RESULT[result].label)}</Badge>
            <span className="text-[12px] text-ink-muted">
              {snag_count > 0 ? `${snag_count} ${t('snags')}` : ''}
              {snag_count > 0 && signed_by.length > 1 ? ' · ' : ''}
              {signed_by.length > 1 ? t('Countersigned') : ''}
            </span>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={inspections}
      searchPlaceholder={t('Search inspections')}
      emptyMessage={t('No inspections yet.')}
      onRowClick={(row) => router.push(`/quality/inspections/${row.id}`)}
    />
  );
}

/**
 * Start an inspection: which checklist, on which site, where on it. The lines are copied from the
 * template now, so editing the library later never rewrites an inspection already under way.
 */
export function NewInspectionDialog({
  sites,
  templates,
  fixedSiteId,
}: {
  sites: SiteOption[];
  templates: QualityTemplateView[];
  fixedSiteId?: string;
}) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? '');
  const [templateId, setTemplateId] = useState('');
  const [costCodeId, setCostCodeId] = useState(ANY);
  const [milestoneId, setMilestoneId] = useState(ANY);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = templates.filter((template) => template.active);

  // Cost codes and stages belong to the site, so they follow it. Both are optional: a company with
  // no breakdown, or a role that cannot read one, still inspects.
  useEffect(() => {
    if (!open || !siteId) {
      setCodes([]);
      setMilestones([]);
      return;
    }
    let live = true;
    void costCodeOptions(siteId).then((result) => {
      if (live) setCodes(result.ok ? (result.data ?? []) : []);
    });
    void milestoneOptions(siteId).then((result) => {
      if (live) setMilestones(result.ok ? (result.data ?? []) : []);
    });
    setCostCodeId(ANY);
    setMilestoneId(ANY);
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId || !templateId) {
      setError(t('Choose the site and the checklist'));
      return;
    }
    start(async () => {
      const result = await startInspection({
        project_id: siteId,
        template_id: templateId,
        location: read('location'),
        inspection_date: read('date') || undefined,
        cost_code_id: costCodeId === ANY ? null : costCodeId,
        milestone_id: milestoneId === ANY ? null : milestoneId,
        notes: read('notes') || null,
        share_with_client: formData.get('share') === 'on',
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not start the inspection'));
        return;
      }
      setOpen(false);
      router.push(`/quality/inspections/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ClipboardCheck className="size-4" />
          {t('Start inspection')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Start an inspection')}</DialogTitle>
          <DialogDescription>
            {t('Pick the checklist and say where on the site. You answer it line by line on the next screen.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && (
            <Field label={t('Site')}>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose a site')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field
            label={t('Checklist')}
            hint={active.length === 0 ? t('Add checklists under Settings → Quality first') : undefined}
          >
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('Choose a checklist')} />
              </SelectTrigger>
              <SelectContent>
                {active.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.trade ? ` · ${template.trade}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
            <Field label={t('Where')} htmlFor="insp-location">
              <Input
                id="insp-location"
                name="location"
                required
                maxLength={200}
                placeholder={t('Block A, 3rd floor slab')}
              />
            </Field>
            <Field label={t('Date')} htmlFor="insp-date">
              <Input id="insp-date" name="date" type="date" defaultValue={todayIso()} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Cost code')} optional>
              <Select value={costCodeId} onValueChange={setCostCodeId} disabled={codes.length === 0}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('None')}</SelectItem>
                  {codes.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {code.code} {code.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Stage')} optional>
              <Select value={milestoneId} onValueChange={setMilestoneId} disabled={milestones.length === 0}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('None')}</SelectItem>
                  {milestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('Notes')} htmlFor="insp-notes" optional>
            <Textarea id="insp-notes" name="notes" maxLength={2000} className="min-h-[56px]" />
          </Field>
          <label className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" name="share" className="mt-0.5 size-4 accent-accent" />
            <span>
              {t('Share with the client once signed')}
              <span className="block text-[12.5px] text-ink-muted">
                {t('They see the signed report on their site and can countersign it.')}
              </span>
            </span>
          </label>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Start')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
