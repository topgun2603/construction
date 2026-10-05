'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BookmarkPlus, CalendarDays, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { COST_CODE_INDENT } from '@sitebook/shared';
import {
  createScheduleBaseline,
  createScheduleDependency,
  createScheduleTask,
  deleteScheduleDependency,
  deleteScheduleTask,
  recordScheduleProgress,
  resetScheduleCalendar,
  saveScheduleCalendar,
  updateScheduleTask,
  type ScheduleTaskPatch,
} from '@/lib/schedule-actions';
import type {
  ScheduleCalendar,
  ScheduleConstraintType,
  ScheduleDependency,
  ScheduleLinkType,
  ScheduleTask,
  ScheduleTaskKind,
} from '@/lib/schedule-types';
import type { CostCode } from '@/lib/cost-code-types';
import { addDaysIso } from '@/lib/format';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { DeleteRowButton } from '@/components/delete-row-button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** People and things a task can be tied to. Empty for someone who cannot edit the plan. */
export interface SchedulePickers {
  costCodes: CostCode[];
  contractors: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}

export const LINK_LABELS: Record<ScheduleLinkType, string> = {
  FS: 'Finish to start',
  SS: 'Start to start',
  FF: 'Finish to finish',
  SF: 'Start to finish',
};

const LINK_HINTS: Record<ScheduleLinkType, string> = {
  FS: 'The next task starts once this one finishes',
  SS: 'The next task starts once this one starts',
  FF: 'The next task finishes once this one finishes',
  SF: 'The next task finishes once this one starts',
};

const CONSTRAINT_LABELS: Record<ScheduleConstraintType, string> = {
  asap: 'As soon as possible',
  snet: 'Start no earlier than',
  fnlt: 'Finish no later than',
};

const NONE = 'none';

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
      {error}
    </p>
  );
}

/** The tasks a task may sit under: not itself, nothing below it, and not a milestone. */
function parentOptions(tasks: ScheduleTask[], editing?: ScheduleTask): ScheduleTask[] {
  if (!editing) return tasks.filter((task) => task.kind === 'task');
  const below = new Set<string>([editing.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parent_id && below.has(task.parent_id) && !below.has(task.id)) {
        below.add(task.id);
        grew = true;
      }
    }
  }
  return tasks.filter((task) => task.kind === 'task' && !below.has(task.id));
}

function PickerSelect({
  value,
  onChange,
  options,
  noneLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  noneLabel: string;
  id?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? '' : next)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Add a task, or edit one. Controlled from outside when editing (a row click opens it); carries
 * its own trigger when adding.
 */
export function TaskDialog({
  projectId,
  tasks,
  dependencies,
  pickers,
  task,
  open,
  onOpenChange,
  trigger,
}: {
  projectId: string;
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  pickers: SchedulePickers;
  task?: ScheduleTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? task.name : t('Add a task')}</DialogTitle>
          <DialogDescription>
            {task
              ? t('Change the plan for this task. Its dates are worked out from its links and the site calendar.')
              : t('A piece of work on the programme. Link it to others once it is added.')}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TaskForm
            key={task?.id ?? 'new'}
            projectId={projectId}
            tasks={tasks}
            dependencies={dependencies}
            pickers={pickers}
            task={task ?? undefined}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  projectId,
  tasks,
  dependencies,
  pickers,
  task,
  onDone,
}: {
  projectId: string;
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  pickers: SchedulePickers;
  task?: ScheduleTask;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ScheduleTaskKind>(task?.kind ?? 'task');
  const [parentId, setParentId] = useState(task?.parent_id ?? '');
  const [constraint, setConstraint] = useState<ScheduleConstraintType>(task?.constraint_type ?? 'asap');
  const [costCodeId, setCostCodeId] = useState(task?.cost_code?.id ?? '');
  const [responsibleId, setResponsibleId] = useState(task?.responsible?.id ?? '');
  const [contractorId, setContractorId] = useState(task?.contractor?.id ?? '');

  const summary = task?.is_summary ?? false;
  const parents = useMemo(() => parentOptions(tasks, task), [tasks, task]);
  const byId = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);
  const predecessors = task ? dependencies.filter((d) => d.successor_id === task.id) : [];

  // A person or contractor already on the task stays pickable even if the lists no longer carry them.
  const members = [...pickers.members];
  if (task?.responsible && !members.some((m) => m.id === task.responsible!.id)) members.push(task.responsible);
  const contractors = [...pickers.contractors];
  if (task?.contractor && !contractors.some((c) => c.id === task.contractor!.id)) contractors.push(task.contractor);
  const codes = pickers.costCodes.map((c) => ({ id: c.id, label: `${COST_CODE_INDENT.repeat(c.depth)}${c.code} ${c.name}` }));
  if (task?.cost_code && !codes.some((c) => c.id === task.cost_code!.id)) {
    codes.push({ id: task.cost_code.id, label: `${task.cost_code.code} ${task.cost_code.name}` });
  }

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    const wbsCode = String(formData.get('wbs_code') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    const constraintDate = String(formData.get('constraint_date') ?? '');
    if (!name) {
      setError(t('A task needs a name'));
      return;
    }
    let duration: number | undefined;
    if (kind === 'task' && !summary) {
      duration = Number(formData.get('duration_days'));
      if (!Number.isInteger(duration) || duration < 1) {
        setError(t('Duration is a whole number of working days, at least 1'));
        return;
      }
    }
    if (constraint !== 'asap' && !constraintDate) {
      setError(t('Pick the date for the constraint'));
      return;
    }
    const plan: ScheduleTaskPatch = {
      name,
      ...(summary ? {} : { kind }),
      parent_id: parentId || null,
      wbs_code: wbsCode || null,
      ...(duration !== undefined ? { duration_days: duration } : kind === 'milestone' ? { duration_days: 0 } : {}),
      constraint_type: constraint,
      constraint_date: constraint === 'asap' ? null : constraintDate,
      cost_code_id: costCodeId || null,
      responsible_user_id: responsibleId || null,
      contractor_id: contractorId || null,
      notes: notes || null,
    };
    if (task && !summary) {
      const percent = Number(formData.get('percent_complete'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        setError(t('Percent complete is between 0 and 100'));
        return;
      }
      const actualStart = String(formData.get('actual_start') ?? '');
      const actualFinish = String(formData.get('actual_finish') ?? '');
      if (percent !== task.percent_complete) plan.percent_complete = Math.round(percent);
      if (actualStart !== (task.actual_start ?? '')) plan.actual_start = actualStart || null;
      if (actualFinish !== (task.actual_finish ?? '')) plan.actual_finish = actualFinish || null;
    }
    start(async () => {
      const result = task
        ? await updateScheduleTask(projectId, task.id, plan)
        : await createScheduleTask(projectId, {
            ...Object.fromEntries(Object.entries(plan).filter(([, v]) => v !== null)),
            name,
          });
      if (!result.ok) {
        setError(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(task ? `${name} ${t('saved')}` : `${name} ${t('added')}`);
      onDone();
      router.refresh();
    });
  }

  function unlink(dependency: ScheduleDependency) {
    start(async () => {
      const result = await deleteScheduleDependency(projectId, dependency.id);
      if (!result.ok) toast.error(result.error ?? t('Could not remove that link'));
      else {
        toast.success(t('Link removed'));
        router.refresh();
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <Field label={t('WBS code')} htmlFor="st-wbs" optional>
          <Input
            id="st-wbs"
            name="wbs_code"
            defaultValue={task?.wbs_code ?? ''}
            placeholder={task?.wbs ?? '1.2'}
            maxLength={40}
            className="font-mono"
            dir="ltr"
          />
        </Field>
        <Field label={t('Name')} htmlFor="st-name">
          <Input
            id="st-name"
            name="name"
            defaultValue={task?.name ?? ''}
            placeholder={t('Ground floor slab')}
            maxLength={200}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {!summary && (
          <Field label={t('Kind')}>
            <Select value={kind} onValueChange={(v) => setKind(v as ScheduleTaskKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">{t('Task')}</SelectItem>
                <SelectItem value="milestone">{t('Milestone')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t('Under')}>
          <PickerSelect
            value={parentId}
            onChange={setParentId}
            noneLabel={t('Top level')}
            options={parents.map((p) => ({ id: p.id, label: `${COST_CODE_INDENT.repeat(p.depth)}${p.wbs} ${p.name}` }))}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {kind === 'task' && !summary && (
          <Field label={t('Duration (working days)')} htmlFor="st-duration">
            <Input
              id="st-duration"
              name="duration_days"
              type="number"
              min={1}
              step={1}
              defaultValue={task?.duration_days ?? 5}
              className="font-mono"
              dir="ltr"
            />
          </Field>
        )}
        <Field label={t('Constraint')}>
          <Select value={constraint} onValueChange={(v) => setConstraint(v as ScheduleConstraintType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CONSTRAINT_LABELS) as ScheduleConstraintType[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {t(CONSTRAINT_LABELS[key])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {constraint !== 'asap' && (
          <Field label={t('Constraint date')} htmlFor="st-cdate">
            <Input
              id="st-cdate"
              name="constraint_date"
              type="date"
              defaultValue={task?.constraint_date ?? format.todayIso()}
              dir="ltr"
            />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('Cost code')} optional>
          <PickerSelect value={costCodeId} onChange={setCostCodeId} noneLabel={t('None')} options={codes} />
        </Field>
        <Field label={t('Responsible')} optional>
          <PickerSelect
            value={responsibleId}
            onChange={setResponsibleId}
            noneLabel={t('Nobody')}
            options={members.map((m) => ({ id: m.id, label: m.name }))}
          />
        </Field>
        <Field label={t('Contractor')} optional>
          <PickerSelect
            value={contractorId}
            onChange={setContractorId}
            noneLabel={t('None')}
            options={contractors.map((c) => ({ id: c.id, label: c.name }))}
          />
        </Field>
      </div>

      {task && !summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('% complete')} htmlFor="st-pct">
            <Input
              id="st-pct"
              name="percent_complete"
              type="number"
              min={0}
              max={100}
              defaultValue={task.percent_complete}
              className="font-mono"
              dir="ltr"
            />
          </Field>
          <Field label={t('Actual start')} htmlFor="st-as" optional>
            <Input id="st-as" name="actual_start" type="date" defaultValue={task.actual_start ?? ''} dir="ltr" />
          </Field>
          <Field label={t('Actual finish')} htmlFor="st-af" optional>
            <Input id="st-af" name="actual_finish" type="date" defaultValue={task.actual_finish ?? ''} dir="ltr" />
          </Field>
        </div>
      )}

      <Field label={t('Notes')} htmlFor="st-notes" optional>
        <Textarea id="st-notes" name="notes" defaultValue={task?.notes ?? ''} maxLength={2000} />
      </Field>

      {task && predecessors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13.5px] font-semibold">{t('Comes after')}</span>
          <ul className="flex flex-col gap-1">
            {predecessors.map((dependency) => {
              const before = byId.get(dependency.predecessor_id);
              return (
                <li
                  key={dependency.id}
                  className="flex items-center justify-between gap-2 rounded-btn border border-line-soft bg-raised px-3 py-1.5 text-[13px]"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-ink-muted">{before?.wbs}</span> {before?.name ?? '—'}
                    <span className="ms-2 text-ink-muted">
                      {t(LINK_LABELS[dependency.type])}
                      {dependency.lag_days !== 0 &&
                        ` ${dependency.lag_days > 0 ? '+' : ''}${dependency.lag_days} ${t('days')}`}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 flex-none text-ink-faint hover:text-blocked-fg"
                    onClick={() => unlink(dependency)}
                    disabled={pending}
                    aria-label={t('Remove link')}
                    title={t('Remove link')}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ErrorLine error={error} />

      <DialogFooter className="sm:items-center">
        {task && (
          <div className="me-auto">
            <DeleteRowButton
              what={task.name}
              title={`${t('Delete')} ${task.name}?`}
              body={
                <>
                  <strong className="font-semibold text-ink">{task.name}</strong>{' '}
                  {task.is_summary
                    ? t('and every task under it come off the schedule, with their links.')
                    : t('comes off the schedule, with its links.')}
                </>
              }
              successMessage={`${task.name} ${t('removed')}`}
              onConfirm={async () => {
                const result = await deleteScheduleTask(projectId, task.id);
                if (result.ok) onDone();
                return result;
              }}
            />
          </div>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {task ? t('Save') : t('Add task')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Percent complete and actual dates, for someone who reports progress but does not plan. */
export function ProgressDialog({
  projectId,
  task,
  onOpenChange,
}: {
  projectId: string;
  task: ScheduleTask | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    if (!task) return;
    setError(null);
    const percent = Number(formData.get('percent_complete'));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError(t('Percent complete is between 0 and 100'));
      return;
    }
    const actualStart = String(formData.get('actual_start') ?? '');
    const actualFinish = String(formData.get('actual_finish') ?? '');
    start(async () => {
      const result = await recordScheduleProgress(projectId, task.id, {
        percent_complete: Math.round(percent),
        actual_start: actualStart || null,
        actual_finish: actualFinish || null,
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(`${task.name} ${t('updated')}`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task?.name}</DialogTitle>
          <DialogDescription>{t('Record how far this task has got on site.')}</DialogDescription>
        </DialogHeader>
        {task && (
          <form action={submit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('% complete')} htmlFor="sp-pct">
                <Input
                  id="sp-pct"
                  name="percent_complete"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={task.percent_complete}
                  className="font-mono"
                  dir="ltr"
                />
              </Field>
              <Field label={t('Actual start')} htmlFor="sp-as" optional>
                <Input id="sp-as" name="actual_start" type="date" defaultValue={task.actual_start ?? ''} dir="ltr" />
              </Field>
              <Field label={t('Actual finish')} htmlFor="sp-af" optional>
                <Input id="sp-af" name="actual_finish" type="date" defaultValue={task.actual_finish ?? ''} dir="ltr" />
              </Field>
            </div>
            <ErrorLine error={error} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t('Save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Link two tasks. Summaries are not offered: their dates are what their subtasks make them. */
export function DependencyDialog({ projectId, tasks }: { projectId: string; tasks: ScheduleTask[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [predecessor, setPredecessor] = useState('');
  const [successor, setSuccessor] = useState('');
  const [type, setType] = useState<ScheduleLinkType>('FS');
  const [lag, setLag] = useState('0');

  const linkable = tasks.filter((task) => !task.is_summary);
  const options = linkable.map((task) => ({ id: task.id, label: `${task.wbs} ${task.name}` }));

  function submit() {
    setError(null);
    const lagDays = Number(lag || 0);
    if (!predecessor || !successor) {
      setError(t('Pick both tasks'));
      return;
    }
    if (predecessor === successor) {
      setError(t('A task cannot come after itself'));
      return;
    }
    if (!Number.isInteger(lagDays)) {
      setError(t('Lag is a whole number of working days'));
      return;
    }
    start(async () => {
      const result = await createScheduleDependency(projectId, {
        predecessor_id: predecessor,
        successor_id: successor,
        type,
        lag_days: lagDays,
      });
      if (!result.ok) {
        // A loop is refused with a message that names it; show it where the person is looking.
        setError(result.error ?? t('Could not link those tasks'));
        return;
      }
      toast.success(t('Tasks linked'));
      setOpen(false);
      setPredecessor('');
      setSuccessor('');
      setLag('0');
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={linkable.length < 2}>
          <Link2 className="size-4" />
          {t('Link tasks')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Link two tasks')}</DialogTitle>
          <DialogDescription>
            {t('The second task’s dates follow the first. A lag adds working days between them; a negative lag overlaps them.')}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('First (predecessor)')}>
          <PickerSelect value={predecessor} onChange={setPredecessor} noneLabel={t('Choose a task')} options={options} />
        </Field>
        <Field label={t('Then (successor)')}>
          <PickerSelect
            value={successor}
            onChange={setSuccessor}
            noneLabel={t('Choose a task')}
            options={options.filter((o) => o.id !== predecessor)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label={t('Type')} hint={t(LINK_HINTS[type])}>
            <Select value={type} onValueChange={(v) => setType(v as ScheduleLinkType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LINK_LABELS) as ScheduleLinkType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(LINK_LABELS[key])} ({key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Lag (days)')} htmlFor="sd-lag">
            <Input
              id="sd-lag"
              type="number"
              step={1}
              value={lag}
              onChange={(e) => setLag(e.target.value)}
              className="font-mono"
              dir="ltr"
            />
          </Field>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Link')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Freeze today's plan to measure slippage against later. */
export function BaselineDialog({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError(t('Give the baseline a name'));
      return;
    }
    start(async () => {
      const result = await createScheduleBaseline(projectId, name);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the baseline'));
        return;
      }
      toast.success(`${name} ${t('saved')}`);
      setOpen(false);
      router.push(`/projects/${projectId}?tab=schedule&baseline=${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <BookmarkPlus className="size-4" />
          {t('Save baseline')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Save a baseline')}</DialogTitle>
          <DialogDescription>
            {t('Keeps a copy of every task’s dates as they are now, so later slippage can be measured against it.')}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <form action={submit} className="flex flex-col gap-4">
            <Field label={t('Name')} htmlFor="sb-name">
              <Input
                id="sb-name"
                name="name"
                defaultValue={`${t('Baseline')} ${format.shortDate(format.todayIso())}`}
                maxLength={120}
                required
              />
            </Field>
            <ErrorLine error={error} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t('Save baseline')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 2026-01-04 was a Sunday: adding 0–6 gives each weekday's name in the company's language. */
const A_SUNDAY = '2026-01-04';

/** The site's working week and days off. */
export function CalendarDialog({ projectId, calendar }: { projectId: string; calendar: ScheduleCalendar }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>(calendar.working_days);
  const [holidays, setHolidays] = useState<string[]>(calendar.holidays);
  const [newHoliday, setNewHoliday] = useState('');

  function reset() {
    setDays(calendar.working_days);
    setHolidays(calendar.holidays);
    setNewHoliday('');
    setError(null);
  }

  function toggle(day: number) {
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b),
    );
  }

  function addHoliday() {
    if (!newHoliday || holidays.includes(newHoliday)) return;
    setHolidays([...holidays, newHoliday].sort());
    setNewHoliday('');
  }

  function save() {
    setError(null);
    if (days.length === 0) {
      setError(t('Pick at least one working day'));
      return;
    }
    start(async () => {
      const result = await saveScheduleCalendar(projectId, { working_days: days, holidays });
      if (!result.ok) {
        setError(result.error ?? t('Could not save the calendar'));
        return;
      }
      toast.success(t('Calendar saved; the schedule has been worked out again'));
      setOpen(false);
      router.refresh();
    });
  }

  function backToCompany() {
    setError(null);
    start(async () => {
      const result = await resetScheduleCalendar(projectId);
      if (!result.ok) {
        setError(result.error ?? t('Could not save the calendar'));
        return;
      }
      toast.success(t('Back on the company calendar'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <CalendarDays className="size-4" />
          {t('Calendar')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Working calendar')}</DialogTitle>
          <DialogDescription>
            {calendar.scope === 'site'
              ? t('This site has its own working week. Durations count only working days.')
              : t('This site uses the company calendar. Saving here gives it its own.')}
          </DialogDescription>
        </DialogHeader>

        <Field label={t('Working days')}>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => {
              const on = days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggle(day)}
                  aria-pressed={on}
                  className={cn(
                    'h-9 min-w-[52px] rounded-btn border px-2.5 text-[13px] font-semibold transition',
                    on
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line-strong bg-surface text-ink-muted hover:bg-raised',
                  )}
                >
                  {format.weekday(addDaysIso(A_SUNDAY, day))}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t('Holidays')} hint={t('Days off on top of the weekend: public holidays, Eid, Diwali, a shutdown.')}>
          <div className="flex gap-2">
            <Input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              aria-label={t('Holiday date')}
              dir="ltr"
            />
            <Button type="button" variant="secondary" onClick={addHoliday} disabled={!newHoliday}>
              <Plus className="size-4" />
              {t('Add')}
            </Button>
          </div>
          {holidays.length > 0 && (
            <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
              {holidays.map((day) => (
                <li
                  key={day}
                  className="flex items-center justify-between rounded-btn bg-raised px-3 py-1 text-[13px]"
                >
                  <span>{format.longDate(day)}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-ink-faint hover:text-blocked-fg"
                    onClick={() => setHolidays(holidays.filter((h) => h !== day))}
                    aria-label={`${t('Remove')} ${format.longDate(day)}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <ErrorLine error={error} />

        <DialogFooter className="sm:items-center">
          {calendar.scope === 'site' && (
            <Button type="button" variant="link" className="me-auto px-0" onClick={backToCompany} disabled={pending}>
              {t('Use the company calendar')}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Save calendar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
