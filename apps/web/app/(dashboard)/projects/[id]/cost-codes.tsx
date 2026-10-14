'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  Download,
  BookmarkPlus,
  HardHat,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  COST_CODE_INDENT,
  CSV_BOM,
  costReportCsv,
  parseCostCodeCsv,
  type CostCodeCsvResult,
} from '@sitebook/shared';
import {
  applyCostCodeTemplate,
  createCostCode,
  createCostCodeTemplate,
  deleteCostCode,
  importCostCodes,
  updateCostCode,
} from '@/lib/cost-code-actions';
import type {
  CostCodeTemplateSummary,
  CostFigures,
  CostReport,
  CostReportLine,
} from '@/lib/cost-code-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { DeleteRowButton } from '@/components/delete-row-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const METHOD_NOTE = {
  progress: 'Cost still to come is projected from the milestones done so far',
  burn_rate: 'Cost still to come is projected from the last four weeks of spending',
  spend_only: 'Add a handover date or milestones to the site to project the cost still to come',
} as const;

/**
 * The site's work breakdown and its budget against what is committed, spent and forecast
 * (roadmap Phase 2, module 1).
 *
 * One table for both jobs — keeping the breakdown and reading the report — because the person who
 * sets a line's budget is the person who wants to see what has happened to it, and two screens
 * would have them flicking between them. Parents show their rolled-up figures; a leaf's budget is
 * edited where it is read.
 */
export function CostCodesTab({
  projectId,
  projectName,
  report,
  templates,
  canManage,
}: {
  projectId: string;
  projectName: string;
  report: CostReport;
  templates: CostCodeTemplateSummary[];
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // A row is hidden when any line above it is folded.
  const visible = useMemo(() => {
    const parentOf = new Map(report.lines.map((line) => [line.id, line.parent_id]));
    return report.lines.filter((line) => {
      let at = line.parent_id;
      while (at) {
        if (collapsed.has(at)) return false;
        at = parentOf.get(at) ?? null;
      }
      return true;
    });
  }, [report.lines, collapsed]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const csv = costReportCsv(
      report.lines,
      [
        { label: t('Unallocated'), total: report.unallocated },
        { label: t('Total'), total: report.totals },
      ],
      format.currencyDigits,
    );
    const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName.replace(/[^\p{L}\p{N}]+/gu, '-')}-budget-${report.as_of}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totals = report.totals;
  const over = BigInt(totals.variance) < 0n;
  const hasUnallocated =
    report.unallocated.actual !== '0' || report.unallocated.committed !== '0';

  if (report.lines.length === 0) {
    return (
      <Card className="flex flex-col gap-4 p-4">
        <EmptyState
          icon={<Layers />}
          title={t('No cost codes on this site yet')}
          body={t(
            'Break the job into lines — earthworks, substructure, finishes — and give each a budget. Expenses booked to a line are measured against it.',
          )}
          action={
            canManage ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <ApplyTemplate projectId={projectId} templates={templates} />
                <ImportDialog projectId={projectId} />
                <CostCodeDialog projectId={projectId} lines={report.lines} />
              </div>
            ) : undefined
          }
        />
        {hasUnallocated && (
          <p className="text-center text-[13px] text-ink-muted">
            {t('Spent so far without a code')}: {format.money(report.unallocated.actual)}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Budget against cost')}
            </span>
            <Badge tone={over ? 'blocked' : 'done'}>
              {over ? t('Forecast over budget') : t('Within budget')}
            </Badge>
          </div>
          <span className="text-[12px] text-ink-faint">
            {t('As of')} {format.shortDate(report.as_of)}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Figure
            label={
              report.approved_changes && report.approved_changes !== '0'
                ? `${t('Budget')} (${t('incl. change orders')} ${format.moneyShort(report.approved_changes)})`
                : t('Budget')
            }
            value={format.moneyShort(totals.budget)}
          />
          <Figure label={t('Committed')} value={format.moneyShort(totals.committed)} />
          <Figure label={t('Actual')} value={format.moneyShort(totals.actual)} />
          <Figure label={t('Forecast')} value={format.moneyShort(totals.forecast)} />
          <Figure
            label={t('Variance')}
            value={format.moneyShort(totals.variance)}
            tone={over ? 'blocked' : 'done'}
          />
        </dl>
        <div className="flex flex-col gap-0.5 text-[12px] text-ink-faint">
          <span>{t(METHOD_NOTE[report.method])}.</span>
          {report.project_budget !== null && report.project_budget !== totals.budget && (
            <span>
              {t('The site’s own budget is')} {format.money(report.project_budget)};{' '}
              {t('the lines add up to')} {format.money(totals.budget)}.
            </span>
          )}
          {report.committed_sources.length === 0 && (
            <span>{t('Committed fills in once purchase orders and subcontracts are recorded.')}</span>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download className="size-4" />
          {t('Export CSV')}
        </Button>
        {canManage && (
          <>
            <SaveAsTemplate projectId={projectId} projectName={projectName} />
            <ApplyTemplate projectId={projectId} templates={templates} />
            <ImportDialog projectId={projectId} />
            <CostCodeDialog projectId={projectId} lines={report.lines} />
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-start">{t('Cost code')}</TableHead>
              <TableHead className="text-end">{t('Budget')}</TableHead>
              <TableHead className="text-end">{t('Committed')}</TableHead>
              <TableHead className="text-end">{t('Actual')}</TableHead>
              <TableHead className="text-end">{t('Forecast')}</TableHead>
              <TableHead className="text-end">{t('Variance')}</TableHead>
              {canManage && <TableHead className="w-[1%]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                projectId={projectId}
                lines={report.lines}
                canManage={canManage}
                folded={collapsed.has(line.id)}
                onToggle={() => toggle(line.id)}
              />
            ))}
            {hasUnallocated && (
              <TableRow>
                <TableCell className="text-start">
                  <div className="flex flex-col">
                    <span className="font-medium">{t('Unallocated')}</span>
                    <span className="text-[12px] text-ink-muted">
                      {t('Spent or committed without a code')}
                    </span>
                  </div>
                </TableCell>
                <Amounts figures={report.unallocated} />
                {canManage && <TableCell />}
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="text-start">{t('Total')}</TableCell>
              <Amounts figures={totals} />
              {canManage && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </div>
  );
}

function LineRow({
  line,
  projectId,
  lines,
  canManage,
  folded,
  onToggle,
}: {
  line: CostReportLine;
  projectId: string;
  lines: CostReportLine[];
  canManage: boolean;
  folded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const [pending, start] = useTransition();

  /*
   * Saved on blur, not per keystroke: a budget is typed a digit at a time, and saving "1" on the
   * way to "150000" would have the report briefly call the line wildly over budget.
   */
  function revise(value: string) {
    let minor: string;
    try {
      minor = amountToMinorString(value, format.currencyDigits, format.currencySymbol);
    } catch {
      toast.error(t('Enter the budget as a number, like 250000'));
      return;
    }
    if (minor === line.own.budget) return;
    if (minor.startsWith('-')) {
      toast.error(t('A budget cannot be negative'));
      return;
    }
    start(async () => {
      const result = await updateCostCode(projectId, line.id, { budget: minor });
      if (result.ok) toast.success(`${line.code} ${t('budget saved')}`);
      else toast.error(result.error ?? t('Could not save that'));
    });
  }

  function makeLabourLine() {
    start(async () => {
      const result = await updateCostCode(projectId, line.id, {
        labour_default: !line.labour_default,
      });
      if (!result.ok) toast.error(result.error ?? t('Could not save that'));
    });
  }

  const figures = line.has_children ? line.total : line.own;

  return (
    <TableRow className={cn(line.depth === 0 && 'bg-raised')}>
      <TableCell className="text-start">
        <div className="flex items-center gap-1.5" style={{ paddingInlineStart: line.depth * 20 }}>
          {line.has_children ? (
            <button
              type="button"
              onClick={onToggle}
              className="flex size-5 flex-none items-center justify-center rounded text-ink-muted hover:bg-raised rtl:-scale-x-100"
              aria-label={folded ? `${t('Show lines under')} ${line.code}` : `${t('Hide lines under')} ${line.code}`}
              aria-expanded={!folded}
            >
              {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : (
            <span className="size-5 flex-none" />
          )}
          <span className="font-mono text-[12.5px] text-ink-muted">{line.code}</span>
          <span className={cn('truncate', line.depth === 0 && 'font-semibold')}>{line.name}</span>
          {line.unit && <span className="text-[12px] text-ink-faint">({line.unit})</span>}
          {line.labour_default && (
            <Badge tone="accent" dot={false} title={t('Labour on the site lands on this line')}>
              <HardHat className="size-3" />
              {t('Labour')}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-end font-mono">
        {canManage && !line.has_children ? (
          <Input
            key={line.own.budget}
            defaultValue={minorToAmountInput(line.own.budget, format.currencyDigits)}
            onBlur={(event) => revise(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            inputMode="decimal"
            className="ms-auto h-8 w-[130px] text-end font-mono"
            aria-label={`${t('Budget for')} ${line.code}`}
            disabled={pending}
          />
        ) : (
          <span title={line.has_children && line.own.budget !== '0' ? `${t('Of which on this line itself')}: ${format.money(line.own.budget)}` : undefined}>
            {format.money(figures.budget)}
          </span>
        )}
        {/* The budget includes approved change orders; this says how much, so the original is
            always readable as budget minus it. */}
        {line.approved_changes &&
          (line.has_children ? line.approved_changes.total : line.approved_changes.own) !== '0' && (
            <span className="block text-[11px] text-ink-muted">
              {t('incl. change orders')}{' '}
              {format.money(line.has_children ? line.approved_changes.total : line.approved_changes.own)}
            </span>
          )}
      </TableCell>
      <Amounts figures={figures} skipBudget />
      {canManage && (
        <TableCell>
          <div className="flex items-center justify-end gap-0.5">
            {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
            <Button
              size="icon"
              variant="ghost"
              className={cn('size-8', line.labour_default ? 'text-accent' : 'text-ink-faint')}
              onClick={makeLabourLine}
              disabled={pending}
              title={
                line.labour_default
                  ? t('Stop booking site labour here')
                  : t('Book site labour to this line')
              }
              aria-label={
                line.labour_default
                  ? t('Stop booking site labour here')
                  : t('Book site labour to this line')
              }
            >
              <HardHat className="size-4" />
            </Button>
            <CostCodeDialog projectId={projectId} lines={lines} parent={line} />
            <CostCodeDialog projectId={projectId} lines={lines} editing={line} />
            <DeleteRowButton
              what={`${line.code} ${line.name}`}
              body={
                <>
                  <strong className="font-semibold text-ink">
                    {line.code} {line.name}
                  </strong>{' '}
                  {t('comes off this site’s breakdown. A line with spend booked to it, or lines under it, cannot be removed.')}
                </>
              }
              successMessage={`${line.code} ${t('removed')}`}
              onConfirm={deleteCostCode.bind(null, projectId, line.id)}
            />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function Amounts({ figures, skipBudget = false }: { figures: CostFigures; skipBudget?: boolean }) {
  const format = useFormat();
  const negative = BigInt(figures.variance) < 0n;
  return (
    <>
      {!skipBudget && <TableCell className="text-end font-mono">{format.money(figures.budget)}</TableCell>}
      <TableCell className="text-end font-mono text-ink-soft">{format.money(figures.committed)}</TableCell>
      <TableCell className="text-end font-mono">{format.money(figures.actual)}</TableCell>
      <TableCell className="text-end font-mono">{format.money(figures.forecast)}</TableCell>
      <TableCell className={cn('text-end font-mono', negative ? 'text-blocked-fg' : 'text-done-fg')}>
        {format.money(figures.variance)}
      </TableCell>
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'blocked' | 'done' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</dt>
      <dd
        className={cn(
          'font-mono text-[17px] font-semibold',
          tone === 'blocked' && 'text-blocked-fg',
          tone === 'done' && 'text-done-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Keep this site's breakdown in the library for the next job. Budgets stay with the site. */
function SaveAsTemplate({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useLanguage();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await createCostCodeTemplate({
            name: `${projectName} ${t('breakdown')}`,
            from_project_id: projectId,
          });
          if (result.ok) toast.success(t('Saved to the template library in Settings'));
          else toast.error(result.error ?? t('Could not save the template'));
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />}
      {t('Save as template')}
    </Button>
  );
}

/** Copy a template's lines into the site. Lines the site already has are left alone. */
function ApplyTemplate({
  projectId,
  templates,
}: {
  projectId: string;
  templates: CostCodeTemplateSummary[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 'standard');
  const [pending, start] = useTransition();

  function apply() {
    start(async () => {
      const result = await applyCostCodeTemplate(projectId, templateId);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not apply that template'));
        return;
      }
      toast.success(
        `${result.data.created} ${t('lines added')}${result.data.skipped ? `, ${result.data.skipped} ${t('already here')}` : ''}`,
      );
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Layers className="size-4" />
          {t('From a template')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Start from a template')}</DialogTitle>
          <DialogDescription>
            {t('Copies the template’s lines into this site. Lines the site already has, and their budgets, are left as they are.')}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('Template')}>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name} · {template.items} {t('lines')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={apply} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Copy into this site')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Codes and budgets from a spreadsheet. Read in the browser first, so the person sees what will
 * be imported — and which lines could not be read — before anything is written.
 */
function ImportDialog({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<CostCodeCsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setParsed(parseCostCodeCsv(await file.text(), format.currencyDigits));
    if (fileInput.current) fileInput.current.value = '';
  }

  function submit() {
    if (!parsed || parsed.rows.length === 0) return;
    start(async () => {
      const result = await importCostCodes(projectId, parsed.rows);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not import that sheet'));
        return;
      }
      toast.success(
        `${result.data.created} ${t('lines added')}, ${result.data.updated} ${t('updated')}`,
      );
      setParsed(null);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setParsed(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload className="size-4" />
          {t('Import CSV')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Import cost codes and budgets')}</DialogTitle>
          <DialogDescription>
            {t('A CSV with the columns code, name, parent code, budget — and optionally unit. Save it from Excel as CSV. A code the site already has is updated; anything new is added.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-raised p-3.5">
          <code className="font-mono text-[12px] leading-relaxed text-ink-soft" dir="ltr">
            code,name,parent code,budget
            <br />
            03,Substructure,,
            <br />
            03.20,Footings &amp; foundations,03,250000
          </code>
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={pending}
            >
              <Upload className="size-4" />
              {parsed ? t('Choose another file') : t('Choose a file')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </div>
        </div>

        {parsed && (
          <div className="flex flex-col gap-1.5 text-[13px]">
            <span>
              {parsed.rows.length} {t('lines ready to import')}
            </span>
            {parsed.errors.length > 0 && (
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto text-pending-fg">
                {parsed.errors.slice(0, 20).map((issue) => (
                  <li key={issue.line}>
                    {t('Line')} {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !parsed || parsed.rows.length === 0}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add a line (at the top, or under `parent`), or edit one (`editing`). Editing is where a parent's
 * own budget is set, since its budget cell shows the rolled-up total.
 */
function CostCodeDialog({
  projectId,
  lines,
  parent,
  editing,
}: {
  projectId: string;
  lines: CostReportLine[];
  parent?: CostReportLine;
  editing?: CostReportLine;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState<string>(
    editing?.parent_id ?? parent?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A line cannot move under itself or anything beneath it.
  const below = useMemo(() => {
    if (!editing) return new Set<string>();
    const out = new Set<string>([editing.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const line of lines) {
        if (line.parent_id && out.has(line.parent_id) && !out.has(line.id)) {
          out.add(line.id);
          grew = true;
        }
      }
    }
    return out;
  }, [editing, lines]);

  function submit(formData: FormData) {
    setError(null);
    const code = String(formData.get('code') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const unit = String(formData.get('unit') ?? '').trim();
    if (!code || !name) {
      setError(t('A line needs a code and a name'));
      return;
    }
    let budget: string;
    try {
      budget = amountToMinorString(
        String(formData.get('budget') ?? ''),
        format.currencyDigits,
        format.currencySymbol,
      );
    } catch {
      setError(t('Enter the budget as a number, like 250000'));
      return;
    }
    start(async () => {
      const result = editing
        ? await updateCostCode(projectId, editing.id, {
            code,
            name,
            unit: unit || null,
            budget,
            parent_id: parentId || null,
          })
        : await createCostCode(projectId, {
            code,
            name,
            budget,
            ...(unit ? { unit } : {}),
            ...(parentId ? { parent_id: parentId } : {}),
          });
      if (!result.ok) {
        setError(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(editing ? `${code} ${t('saved')}` : `${code} ${t('added')}`);
      setOpen(false);
      router.refresh();
    });
  }

  const suggested = parent
    ? `${parent.code}.${String((lines.filter((line) => line.parent_id === parent.id).length + 1) * 10).padStart(2, '0')}`
    : '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-ink-faint"
            title={`${t('Edit')} ${editing.code}`}
            aria-label={`${t('Edit')} ${editing.code}`}
          >
            <Pencil className="size-4" />
          </Button>
        ) : parent ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-ink-faint"
            title={`${t('Add a line under')} ${parent.code}`}
            aria-label={`${t('Add a line under')} ${parent.code}`}
          >
            <Plus className="size-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" />
            {t('Add line')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `${t('Edit')} ${editing.code}` : t('Add a cost code')}</DialogTitle>
          <DialogDescription>
            {t('A line of the site’s work breakdown. Expenses, orders and subcontracts are booked against it.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label={t('Code')} htmlFor="cc-code">
              <Input
                id="cc-code"
                name="code"
                defaultValue={editing?.code ?? suggested}
                placeholder="03.20"
                maxLength={30}
                className="font-mono"
                dir="ltr"
                required
              />
            </Field>
            <Field label={t('Name')} htmlFor="cc-name">
              <Input
                id="cc-name"
                name="name"
                defaultValue={editing?.name}
                placeholder={t('Footings & foundations')}
                maxLength={120}
                required
              />
            </Field>
          </div>
          <Field label={t('Under')}>
            <Select value={parentId || 'none'} onValueChange={(value) => setParentId(value === 'none' ? '' : value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('Top level')}</SelectItem>
                {lines
                  .filter((line) => !below.has(line.id))
                  .map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {COST_CODE_INDENT.repeat(line.depth)}
                      {line.code} {line.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`${t('Budget')} (${format.currencySymbol})`}
              htmlFor="cc-budget"
              optional
              hint={
                editing?.has_children
                  ? t('For this line itself; the lines under it add theirs on top')
                  : undefined
              }
            >
              <Input
                id="cc-budget"
                name="budget"
                inputMode="decimal"
                defaultValue={
                  editing ? minorToAmountInput(editing.own.budget, format.currencyDigits) : ''
                }
                placeholder="250000"
              />
            </Field>
            <Field label={t('Unit')} htmlFor="cc-unit" optional>
              <Input
                id="cc-unit"
                name="unit"
                defaultValue={editing?.unit ?? ''}
                placeholder="m3"
                maxLength={20}
              />
            </Field>
          </div>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
