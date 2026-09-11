'use client';

import { useState, useTransition } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Flag,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { todayInIst } from '@sitebook/shared';
import { addMilestone, deleteMilestone, reorderMilestones, updateMilestone } from '@/lib/actions';
import type { Milestone } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The site timeline: the milestones of a project, in order, with everything needed
 * to keep them true — add, rename, re-date, mark done, reopen, move, delete.
 *
 * A vertical rail rather than a Gantt chart. Builders read this on a phone at the
 * site gate, and a horizontal bar chart of eight stages is unreadable at that width;
 * the order and the state of each stage is what they actually came for.
 *
 * Ordering is manual (move up/down), not by date. Stages have a real sequence —
 * plastering follows brickwork — and that sequence holds even when the dates slip or
 * are missing entirely, which on a live site they usually are.
 */
export function ProjectTimeline({
  projectId,
  milestones,
  canEdit,
}: {
  projectId: string;
  milestones: Milestone[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = todayInIst();

  const done = milestones.filter((m) => m.actual_date).length;

  function move(index: number, direction: -1 | 1) {
    const next = [...milestones];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    // Swap locally to build the id order the API expects; the server renumbers.
    [next[index], next[target]] = [next[target] as Milestone, next[index] as Milestone];
    start(async () => {
      const result = await reorderMilestones({ projectId, milestoneIds: next.map((m) => m.id) });
      if (!result.ok) toast.error(result.error ?? 'Could not reorder the timeline');
    });
  }

  function setDone(milestone: Milestone, complete: boolean) {
    start(async () => {
      const result = await updateMilestone({
        projectId,
        milestoneId: milestone.id,
        actual_date: complete ? today : null,
      });
      if (result.ok) {
        toast.success(complete ? `${milestone.name} marked done` : `${milestone.name} reopened`);
      } else {
        toast.error(result.error ?? 'Could not update the milestone');
      }
    });
  }

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Timeline
          </span>
          {milestones.length > 0 && (
            <span className="font-mono text-[13px] text-ink-muted">
              {done} of {milestones.length} done
            </span>
          )}
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add stage
          </Button>
        )}
      </div>

      {milestones.length === 0 && !adding ? (
        <div className="p-4">
          <EmptyState
            icon={<Flag />}
            title="No stages on the timeline yet"
            body="Break the site into the stages you actually track — excavation, footing, slab, brickwork — and tick them off as they finish."
            action={
              canEdit ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-4" />
                  Add the first stage
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol className="flex flex-col px-4 py-1">
          {milestones.map((milestone, index) => (
            <MilestoneRow
              key={milestone.id}
              projectId={projectId}
              milestone={milestone}
              index={index}
              last={index === milestones.length - 1}
              today={today}
              canEdit={canEdit}
              editing={editingId === milestone.id}
              busy={pending}
              onEdit={() => setEditingId(milestone.id)}
              onEditDone={() => setEditingId(null)}
              onToggleDone={(complete) => setDone(milestone, complete)}
              onMove={(direction) => move(index, direction)}
            />
          ))}
        </ol>
      )}

      {adding && (
        <AddStageForm
          projectId={projectId}
          nextIndex={milestones.length}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  );
}

function MilestoneRow({
  projectId,
  milestone,
  index,
  last,
  today,
  canEdit,
  editing,
  busy,
  onEdit,
  onEditDone,
  onToggleDone,
  onMove,
}: {
  projectId: string;
  milestone: Milestone;
  index: number;
  last: boolean;
  today: string;
  canEdit: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onToggleDone: (complete: boolean) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const complete = Boolean(milestone.actual_date);
  // Overdue only matters for a stage that is still open: a stage finished late is
  // history, and painting it red forever hides the stages still at risk.
  const overdue = !complete && milestone.planned_date !== null && milestone.planned_date < today;
  const lateBy =
    complete && milestone.planned_date && milestone.actual_date
      ? milestone.actual_date > milestone.planned_date
      : false;

  return (
    <li className="flex gap-3">
      {/* The rail. The connector is drawn by every row but the last, so no line
          dangles below the final dot. */}
      <div className="flex flex-none flex-col items-center pt-4">
        <span
          className={cn(
            'flex size-[22px] flex-none items-center justify-center rounded-full border-2 text-white transition',
            complete
              ? 'border-done bg-done'
              : overdue
                ? 'border-blocked bg-blocked-bg'
                : 'border-line-strong bg-surface',
          )}
        >
          {complete ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : (
            <span
              className={cn(
                'font-mono text-[11px] font-semibold',
                overdue ? 'text-blocked-fg' : 'text-ink-muted',
              )}
            >
              {index + 1}
            </span>
          )}
        </span>
        {!last && <span className="my-1 w-0.5 flex-1 rounded-full bg-line-soft" />}
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-2 py-3',
          !last && 'border-b border-line-soft',
        )}
      >
        {editing ? (
          <EditStageForm projectId={projectId} milestone={milestone} onClose={onEditDone} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  'truncate text-[15px] font-medium leading-snug',
                  complete && 'text-ink-soft',
                )}
              >
                {milestone.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px] text-ink-muted">
                {milestone.planned_date ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" />
                    Planned {shortDate(milestone.planned_date)}
                  </span>
                ) : (
                  <span className="text-ink-faint">No planned date</span>
                )}
                {complete && <span>Done {shortDate(milestone.actual_date)}</span>}
              </span>
            </div>

            <div className="flex flex-none items-center gap-1.5">
              {complete ? (
                <Badge tone={lateBy ? 'pending' : 'done'}>{lateBy ? 'Done late' : 'Done'}</Badge>
              ) : overdue ? (
                <Badge tone="blocked">Overdue</Badge>
              ) : (
                <Badge tone="neutral" dot={false}>
                  Open
                </Badge>
              )}

              {canEdit && (
                <div className="flex items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={busy}
                    onClick={() => onToggleDone(!complete)}
                    title={complete ? 'Reopen this stage' : 'Mark done today'}
                    aria-label={complete ? 'Reopen this stage' : 'Mark done today'}
                  >
                    {complete ? (
                      <RotateCcw className="size-4" />
                    ) : (
                      <Check className="size-4 text-done" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={onEdit}
                    title="Edit stage"
                    aria-label="Edit stage"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={busy || index === 0}
                    onClick={() => onMove(-1)}
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={busy || last}
                    onClick={() => onMove(1)}
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <ConfirmDialog
                    title="Remove this stage?"
                    body={
                      <>
                        <strong className="font-semibold text-ink">{milestone.name}</strong> comes
                        off the timeline. Daily reports and attendance are not affected.
                      </>
                    }
                    confirmLabel="Remove stage"
                    successMessage="Stage removed"
                    onConfirm={() => deleteMilestone({ projectId, milestoneId: milestone.id })}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-ink-muted hover:text-blocked-fg"
                        title="Remove stage"
                        aria-label="Remove stage"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function AddStageForm({
  projectId,
  nextIndex,
  onClose,
}: {
  projectId: string;
  nextIndex: number;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError('Give the stage a name');
      return;
    }
    const planned = String(formData.get('planned_date') ?? '').trim();
    setError(null);
    start(async () => {
      const result = await addMilestone({
        projectId,
        name,
        ...(planned ? { planned_date: planned } : {}),
      });
      if (result.ok) {
        toast.success(`${name} added to the timeline`);
        onClose();
      } else {
        setError(result.error ?? 'Could not add the stage');
      }
    });
  }

  return (
    <form
      action={submit}
      className="flex flex-col gap-3 border-t border-line-soft bg-raised px-4 py-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`Stage ${nextIndex + 1}`} className="min-w-[200px] flex-1">
          <Input name="name" placeholder="Slab casting — 2nd floor" autoFocus maxLength={160} />
        </Field>
        <Field label="Planned date" className="w-[170px]">
          <Input name="planned_date" type="date" />
        </Field>
        <div className="flex items-center gap-2 pb-0.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Add
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-blocked-fg">
          {error}
        </p>
      )}
    </form>
  );
}

function EditStageForm({
  projectId,
  milestone,
  onClose,
}: {
  projectId: string;
  milestone: Milestone;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError('Give the stage a name');
      return;
    }
    const planned = String(formData.get('planned_date') ?? '').trim();
    setError(null);
    start(async () => {
      const result = await updateMilestone({
        projectId,
        milestoneId: milestone.id,
        name,
        // Explicit null, not omitted: an emptied date field means "clear it".
        planned_date: planned || null,
      });
      if (result.ok) {
        toast.success('Stage updated');
        onClose();
      } else {
        setError(result.error ?? 'Could not update the stage');
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Stage" className="min-w-[200px] flex-1">
          <Input name="name" defaultValue={milestone.name} autoFocus maxLength={160} />
        </Field>
        <Field label="Planned date" className="w-[170px]">
          <Input name="planned_date" type="date" defaultValue={milestone.planned_date ?? ''} />
        </Field>
        <div className="flex items-center gap-1.5 pb-0.5">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
            onClick={onClose}
            disabled={pending}
            aria-label="Cancel"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-blocked-fg">
          {error}
        </p>
      )}
    </form>
  );
}
