'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ChartGantt,
  ChevronDown,
  ChevronRight,
  Download,
  FileDown,
  Flag,
  Loader2,
  Plus,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { CSV_BOM, scheduleLookAheadCsv } from '@sitebook/shared';
import {
  deleteScheduleBaseline,
  exportScheduleXml,
  linkScheduleMilestones,
  recordScheduleProgress,
  scheduleLookAhead,
  updateScheduleTask,
  type ScheduleTaskPatch,
} from '@/lib/schedule-actions';
import type { ScheduleTask, ScheduleView } from '@/lib/schedule-types';
import { directionOf } from '@/lib/i18n';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { DeleteRowButton } from '@/components/delete-row-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { GANTT_ROW_HEIGHT, ganttGeometry, ganttRange, type GanttZoom } from './gantt-geometry';
import { GANTT_HEADER_HEIGHT, GanttTimeline } from './gantt-timeline';
import { ImportScheduleDialog } from './import-dialog';
import {
  BaselineDialog,
  CalendarDialog,
  DependencyDialog,
  ProgressDialog,
  TaskDialog,
  type SchedulePickers,
} from './schedule-dialogs';

const ZOOMS: Array<{ key: GanttZoom; label: string }> = [
  { key: 'day', label: 'Days' },
  { key: 'week', label: 'Weeks' },
  { key: 'month', label: 'Months' },
];

/** The task table's columns: WBS, name, duration, start, finish, %, float. */
const COLUMNS = '58px minmax(170px,1fr) 56px 118px 118px 56px 48px';

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-');
}

function download(text: string, type: string, fileName: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The site's programme (roadmap Phase 2, module 6): a task table and a Gantt chart side by side,
 * sharing a row height so a task's row and its bar line up.
 *
 * Planners (`schedule.manage`) edit the plan in place — duration, start, finish — and through the
 * task dialog; supervisors (`schedule.progress`) report percent complete and actual dates only.
 */
export function ScheduleTab({
  projectId,
  projectName,
  view,
  pickers,
}: {
  projectId: string;
  projectName: string;
  view: ScheduleView;
  pickers: SchedulePickers;
}) {
  const { t, language } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const dir = directionOf(language);
  const canPlan = view.can.manage;
  const canProgress = view.can.progress || view.can.manage;

  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ScheduleTask | null>(null);
  const [progressing, setProgressing] = useState<ScheduleTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, startBusy] = useTransition();

  // A row is hidden when any task above it is folded.
  const rows = useMemo(() => {
    const parentOf = new Map(view.tasks.map((task) => [task.id, task.parent_id]));
    return view.tasks.filter((task) => {
      let at = task.parent_id;
      while (at) {
        if (collapsed.has(at)) return false;
        at = parentOf.get(at) ?? null;
      }
      return true;
    });
  }, [view.tasks, collapsed]);

  const geometry = useMemo(() => {
    const dates: string[] = [view.status_date, view.project_start];
    for (const task of view.tasks) {
      dates.push(task.start, task.finish);
      if (task.baseline) dates.push(task.baseline.start, task.baseline.finish);
    }
    return ganttGeometry(ganttRange(dates, zoom), zoom);
  }, [view.tasks, view.status_date, view.project_start, zoom]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function open(task: ScheduleTask) {
    if (canPlan) setEditing(task);
    else if (view.can.progress && !task.is_summary) setProgressing(task);
  }

  function compareWith(baselineId: string) {
    router.push(
      `/projects/${projectId}?tab=schedule${baselineId === 'none' ? '' : `&baseline=${baselineId}`}`,
    );
  }

  function lookAhead() {
    startBusy(async () => {
      const result = await scheduleLookAhead(projectId, 14);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not build the look-ahead'));
        return;
      }
      const lines = result.data.items.map((item) => ({
        site: item.site,
        wbs: item.wbs,
        task: item.task,
        start: item.start,
        finish: item.finish,
        percent_complete: item.percent_complete,
        critical: item.critical,
        responsible: item.responsible,
        event: item.event,
      }));
      download(
        CSV_BOM + scheduleLookAheadCsv(lines),
        'text/csv;charset=utf-8',
        `${safeName(projectName)}-look-ahead-${result.data.from}.csv`,
      );
    });
  }

  function exportXml() {
    startBusy(async () => {
      const result = await exportScheduleXml(projectId);
      if (!result.ok || result.data === undefined) {
        toast.error(result.error ?? t('Could not export the schedule'));
        return;
      }
      download(result.data, 'application/xml', `${safeName(projectName)}-schedule.xml`);
    });
  }

  function putMilestones() {
    startBusy(async () => {
      const result = await linkScheduleMilestones(projectId);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not add the milestones'));
        return;
      }
      toast.success(`${result.data.created} ${t('milestones put on the schedule')}`);
      router.refresh();
    });
  }

  const milestonesButton =
    canPlan && view.unlinked_milestones.length > 0 ? (
      <Button variant="secondary" size="sm" onClick={putMilestones} disabled={busy}>
        <Flag className="size-4" />
        {t('Put milestones on the schedule')} ({view.unlinked_milestones.length})
      </Button>
    ) : null;

  const addTask = canPlan ? (
    <TaskDialog
      projectId={projectId}
      tasks={view.tasks}
      dependencies={view.dependencies}
      pickers={pickers}
      open={adding}
      onOpenChange={setAdding}
      trigger={
        <Button size="sm">
          <Plus className="size-4" />
          {t('Add task')}
        </Button>
      }
    />
  ) : null;

  if (view.tasks.length === 0) {
    return (
      <Card className="flex flex-col gap-4 p-4">
        <EmptyState
          icon={<ChartGantt />}
          title={t('No schedule for this site yet')}
          body={t(
            'Plan the job as tasks with durations and links, or import a programme from Microsoft Project or Primavera P6. The critical path and float are worked out for you.',
          )}
          action={
            canPlan ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {milestonesButton}
                <ImportScheduleDialog
                  projectId={projectId}
                  hasTasks={false}
                  trigger={
                    <Button variant="secondary" size="sm">
                      <Upload className="size-4" />
                      {t('Import')}
                    </Button>
                  }
                />
                {addTask}
              </div>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const leaves = view.tasks.filter((task) => !task.is_summary);
  const criticalCount = leaves.filter((task) => task.critical).length;
  const behindCount = leaves.filter((task) => task.behind).length;
  const late =
    !!view.finish_date && !!view.project.target_end_date && view.finish_date > view.project.target_end_date;
  const variance = view.baseline?.finish_variance ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure
            label={t('Finish')}
            value={format.shortDate(view.finish_date)}
            tone={late ? 'blocked' : undefined}
            note={
              view.project.target_end_date
                ? `${t('Handover')} ${format.shortDate(view.project.target_end_date)}`
                : undefined
            }
          />
          <Figure
            label={t('Critical tasks')}
            value={String(criticalCount)}
            tone={criticalCount > 0 ? 'blocked' : undefined}
            note={`${t('of')} ${leaves.length}`}
          />
          <Figure
            label={t('Behind')}
            value={String(behindCount)}
            tone={behindCount > 0 ? 'pending' : 'done'}
            note={`${t('As of')} ${format.shortDate(view.status_date)}`}
          />
          <Figure
            label={t('Against baseline')}
            value={
              variance === null
                ? '—'
                : variance === 0
                  ? t('On time')
                  : `${variance > 0 ? '+' : '−'}${Math.abs(variance)} ${t('days')}`
            }
            tone={variance === null ? undefined : variance > 0 ? 'blocked' : 'done'}
            note={
              view.baseline
                ? `${view.baseline.name} · ${view.baseline.slipped_count} ${t('slipped')}`
                : t('No baseline selected')
            }
          />
        </dl>
        <span className="text-[12px] text-ink-faint">
          {t('Calendar')}: {view.calendar.name}
          {view.calendar.scope === 'site'
            ? ` (${t('this site')})`
            : view.calendar.scope === 'company'
              ? ` (${t('company')})`
              : ''}
        </span>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-[9px] border border-line-strong bg-surface p-0.5" role="group" aria-label={t('Zoom')}>
            {ZOOMS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setZoom(option.key)}
                aria-pressed={zoom === option.key}
                className={cn(
                  'h-8 rounded-[7px] px-3 text-[13px] font-semibold transition',
                  zoom === option.key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          {view.baselines.length > 0 && (
            <div className="flex items-center gap-1">
              <Select value={view.baseline?.id ?? 'none'} onValueChange={compareWith}>
                <SelectTrigger className="h-9 w-[220px] text-[13px]" aria-label={t('Compare with a baseline')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('No baseline')}</SelectItem>
                  {view.baselines.map((baseline) => (
                    <SelectItem key={baseline.id} value={baseline.id}>
                      {baseline.name} · {format.shortDate(baseline.created_at.slice(0, 10))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canPlan && view.baseline && (
                <DeleteRowButton
                  what={view.baseline.name}
                  successMessage={`${view.baseline.name} ${t('removed')}`}
                  onConfirm={async () => {
                    const result = await deleteScheduleBaseline(projectId, view.baseline!.id);
                    if (result.ok) compareWith('none');
                    return result;
                  }}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-ink-faint" />}
          <Button variant="secondary" size="sm" onClick={lookAhead} disabled={busy}>
            <Download className="size-4" />
            {t('Look-ahead (2 weeks) CSV')}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportXml} disabled={busy}>
            <FileDown className="size-4" />
            {t('Export to MS Project')}
          </Button>
          {canPlan && (
            <>
              {milestonesButton}
              <CalendarDialog projectId={projectId} calendar={view.calendar} />
              <BaselineDialog projectId={projectId} />
              <ImportScheduleDialog projectId={projectId} hasTasks />
              <DependencyDialog projectId={projectId} tasks={view.tasks} />
              {addTask}
            </>
          )}
        </div>
      </div>

      <Card className="flex overflow-hidden">
        {/* The table, on the start side. Scrolls sideways on its own on a narrow screen. */}
        <div className="w-[600px] max-w-[62%] flex-none overflow-x-auto border-e border-line">
          <div className="min-w-[600px]">
            <div
              className="grid items-center border-b border-line bg-raised text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted"
              style={{ gridTemplateColumns: COLUMNS, height: GANTT_HEADER_HEIGHT }}
            >
              <span className="px-2">{t('WBS')}</span>
              <span className="px-2">{t('Task')}</span>
              <span className="px-1.5 text-end">{t('Days')}</span>
              <span className="px-1.5">{t('Start')}</span>
              <span className="px-1.5">{t('Finish')}</span>
              <span className="px-1.5 text-end">%</span>
              <span className="px-1.5 text-end" title={t('Total float, in working days')}>
                {t('Float')}
              </span>
            </div>
            {rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projectId={projectId}
                canPlan={canPlan}
                canProgress={canProgress}
                progressRoute={view.can.progress}
                folded={collapsed.has(task.id)}
                onToggle={() => toggle(task.id)}
                onOpen={() => open(task)}
              />
            ))}
          </div>
        </div>

        {/* The chart, on the end side. Only it scrolls sideways. */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <GanttTimeline
            rows={rows}
            dependencies={view.dependencies}
            geometry={geometry}
            statusDate={view.status_date}
            workingDays={view.calendar.working_days}
            dir={dir}
            showBaseline={view.baseline !== null}
            onOpen={open}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-muted">
        <Legend swatch="h-2.5 w-5 rounded-[3px] border border-accent/60 bg-accent-soft" label={t('Task')} />
        <Legend swatch="h-2.5 w-5 rounded-[3px] border border-blocked/80 bg-blocked-bg" label={t('Critical')} />
        <Legend swatch="h-1.5 w-5 rounded-[2px] bg-ink-soft" label={t('Summary')} />
        <Legend swatch="size-2.5 rotate-45 rounded-[2px] bg-ink-soft" label={t('Milestone')} />
        <Legend swatch="size-2 rounded-full bg-pending" label={t('Behind')} />
        <Legend swatch="h-3 w-0.5 bg-accent/70" label={t('Status date')} />
        {view.baseline && <Legend swatch="h-1 w-5 rounded-full bg-ink-faint/60" label={t('Baseline')} />}
      </div>

      {canPlan && (
        <TaskDialog
          projectId={projectId}
          tasks={view.tasks}
          dependencies={view.dependencies}
          pickers={pickers}
          task={editing}
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}
      {!canPlan && view.can.progress && (
        <ProgressDialog
          projectId={projectId}
          task={progressing}
          onOpenChange={(next) => {
            if (!next) setProgressing(null);
          }}
        />
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block flex-none', swatch)} />
      {label}
    </span>
  );
}

function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: 'blocked' | 'pending' | 'done';
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</dt>
      <dd
        className={cn(
          'font-mono text-[17px] font-semibold',
          tone === 'blocked' && 'text-blocked-fg',
          tone === 'pending' && 'text-pending-fg',
          tone === 'done' && 'text-done-fg',
        )}
      >
        {value}
      </dd>
      {note && <dd className="truncate text-[12px] text-ink-muted">{note}</dd>}
    </div>
  );
}

/**
 * One task in the table. Plan fields save on blur or Enter, like a budget cell: a duration is typed
 * a digit at a time, and saving "1" on the way to "12" would reshuffle the whole programme.
 */
function TaskRow({
  task,
  projectId,
  canPlan,
  canProgress,
  progressRoute,
  folded,
  onToggle,
  onOpen,
}: {
  task: ScheduleTask;
  projectId: string;
  canPlan: boolean;
  canProgress: boolean;
  /** Send percent complete through the progress route (supervisors) rather than the plan edit. */
  progressRoute: boolean;
  folded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const leaf = !task.is_summary;
  const milestone = task.kind === 'milestone';

  function save(patch: ScheduleTaskPatch, what: string) {
    start(async () => {
      const result =
        patch.percent_complete !== undefined && Object.keys(patch).length === 1 && progressRoute
          ? await recordScheduleProgress(projectId, task.id, { percent_complete: patch.percent_complete })
          : await updateScheduleTask(projectId, task.id, patch);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(`${task.name}: ${what} ${t('saved')}`);
      router.refresh();
    });
  }

  function duration(value: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
      toast.error(t('Duration is a whole number of working days, at least 1'));
      return false;
    }
    if (n !== task.duration_days) save({ duration_days: n }, t('duration'));
    return true;
  }

  function startDate(value: string) {
    if (!value) return false;
    if (value !== task.start) save({ start_date: value }, t('start'));
    return true;
  }

  function finishDate(value: string) {
    if (!value) return false;
    if (value < task.start) {
      toast.error(t('A task cannot finish before it starts'));
      return false;
    }
    if (value !== task.finish) save({ finish_date: value }, t('finish'));
    return true;
  }

  function percent(value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error(t('Percent complete is between 0 and 100'));
      return false;
    }
    if (Math.round(n) !== task.percent_complete) save({ percent_complete: Math.round(n) }, '%');
    return true;
  }

  return (
    <div
      className={cn(
        'grid cursor-pointer items-center border-b border-line-soft text-[13px] transition hover:bg-raised',
        task.depth === 0 && task.is_summary && 'bg-raised/60',
        task.critical && leaf && 'border-s-[3px] border-s-blocked',
      )}
      style={{ gridTemplateColumns: COLUMNS, height: GANTT_ROW_HEIGHT }}
      onClick={onOpen}
    >
      <span className="truncate px-2 font-mono text-[11.5px] text-ink-muted" dir="ltr">
        {task.wbs}
      </span>
      <div className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: task.depth * 16 }}>
        {task.is_summary ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="flex size-5 flex-none items-center justify-center rounded text-ink-muted hover:bg-raised rtl:-scale-x-100"
            aria-label={folded ? `${t('Show tasks under')} ${task.name}` : `${t('Hide tasks under')} ${task.name}`}
            aria-expanded={!folded}
          >
            {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        ) : (
          <span className="flex size-5 flex-none items-center justify-center">
            {milestone && <span className="size-2 rotate-45 rounded-[1px] bg-ink-soft" />}
          </span>
        )}
        <span
          className={cn('truncate', task.is_summary && 'font-semibold', task.critical && leaf && 'text-blocked-fg')}
          title={task.name}
        >
          {task.name}
        </span>
        {task.behind && (
          <span className="flex-none text-pending" title={t('Behind the status date')}>
            <AlertTriangle className="size-3.5" aria-label={t('Behind the status date')} />
          </span>
        )}
        {pending && <Loader2 className="size-3.5 flex-none animate-spin text-ink-faint" />}
      </div>

      <div className="px-1 text-end font-mono">
        {canPlan && leaf && !milestone ? (
          <InlineInput
            value={String(task.duration_days)}
            type="number"
            onCommit={duration}
            disabled={pending}
            label={`${t('Duration of')} ${task.name}`}
            className="text-end"
          />
        ) : (
          <span className="px-1">{milestone ? '0' : task.duration_days}</span>
        )}
      </div>
      <div className="px-1">
        {canPlan && leaf ? (
          <InlineInput
            value={task.start}
            type="date"
            onCommit={startDate}
            disabled={pending}
            label={`${t('Start of')} ${task.name}`}
          />
        ) : (
          <span className="px-1 whitespace-nowrap">{format.shortDate(task.start)}</span>
        )}
      </div>
      <div className="px-1">
        {canPlan && leaf && !milestone ? (
          <InlineInput
            value={task.finish}
            type="date"
            onCommit={finishDate}
            disabled={pending}
            label={`${t('Finish of')} ${task.name}`}
          />
        ) : (
          <span className="px-1 whitespace-nowrap">{format.shortDate(task.finish)}</span>
        )}
      </div>
      <div className="px-1 text-end font-mono">
        {canProgress && leaf ? (
          <InlineInput
            value={String(task.percent_complete)}
            type="number"
            onCommit={percent}
            disabled={pending}
            label={`${t('Percent complete of')} ${task.name}`}
            className="text-end"
          />
        ) : (
          <span className="px-1">{task.percent_complete}</span>
        )}
      </div>
      <span
        className={cn(
          'px-1.5 text-end font-mono',
          task.total_float < 0 ? 'text-blocked-fg' : task.total_float === 0 ? 'text-ink-soft' : 'text-ink-muted',
        )}
      >
        {task.total_float}
      </span>
    </div>
  );
}

function InlineInput({
  value,
  type,
  onCommit,
  disabled,
  label,
  className,
}: {
  value: string;
  type: 'number' | 'date';
  /** False puts the old value back. */
  onCommit: (value: string) => boolean;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Input
      key={value}
      type={type}
      defaultValue={value}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (event.target.value === value) return;
        if (!onCommit(event.target.value)) event.target.value = value;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      disabled={disabled}
      aria-label={label}
      dir="ltr"
      className={cn('h-7 rounded-[6px] px-1.5 font-mono text-[12.5px]', className)}
      {...(type === 'number' ? { min: 0, step: 1, inputMode: 'numeric' as const } : {})}
    />
  );
}
