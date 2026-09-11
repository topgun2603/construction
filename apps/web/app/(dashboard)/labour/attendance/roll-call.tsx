'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HardHat, Lock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { attendanceEarning } from '@sitebook/shared';
import { saveAttendance } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { money, longDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AttendanceDay, ProjectSummary, Worker } from '@/lib/api-types';

type Status = 'present' | 'half_day' | 'absent';

interface RowState {
  status: Status;
  overtime: string;
}

const STATUSES: Array<{ value: Status; label: string }> = [
  { value: 'present', label: 'Present' },
  { value: 'half_day', label: 'Half day' },
  { value: 'absent', label: 'Absent' },
];

export function RollCall({
  projects,
  projectId,
  date,
  roster,
  recorded,
}: {
  projects: ProjectSummary[];
  projectId: string;
  date: string;
  roster: Worker[];
  recorded: AttendanceDay;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const existing = new Map(recorded.items.map((row) => [row.worker_id, row]));
    return Object.fromEntries(
      roster.map((worker) => {
        const row = existing.get(worker.id);
        return [
          worker.id,
          {
            status: (row?.status ?? 'absent') as Status,
            overtime: row?.overtime_hours ?? '0.0',
          },
        ];
      }),
    );
  });

  /**
   * The earned total is computed here with the same shared arithmetic the server
   * uses, so the supervisor sees the real figure before saving rather than after.
   * It uses the worker's *current* wage — the server freezes its own snapshot on
   * write, and for an unsaved row those are the same number.
   */
  const total = useMemo(() => {
    let sum = 0n;
    for (const worker of roster) {
      const row = rows[worker.id];
      if (!row) continue;
      sum += attendanceEarning({
        status: row.status,
        overtimeHours: row.overtime || '0',
        wageSnapshot: BigInt(worker.daily_wage),
        overtimeRateSnapshot: BigInt(worker.overtime_rate_per_hour),
      }).totalPaise;
    }
    return sum;
  }, [roster, rows]);

  const presentCount = Object.values(rows).filter((row) => row.status !== 'absent').length;

  const groups = useMemo(() => {
    const byContractor = new Map<string, { name: string; workers: Worker[] }>();
    for (const worker of roster) {
      const key = worker.contractor_id ?? 'direct';
      const group = byContractor.get(key) ?? {
        name: worker.contractor_name ?? 'Direct labour',
        workers: [],
      };
      group.workers.push(worker);
      byContractor.set(key, group);
    }
    return [...byContractor.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [roster]);

  function navigate(next: { project?: string; date?: string }) {
    const query = new URLSearchParams({
      project: next.project ?? projectId,
      date: next.date ?? date,
    });
    router.push(`/labour/attendance?${query.toString()}`);
  }

  function setRow(workerId: string, patch: Partial<RowState>) {
    setRows((current) => ({
      ...current,
      [workerId]: { ...(current[workerId] ?? { status: 'absent', overtime: '0.0' }), ...patch },
    }));
  }

  function markGroup(workers: Worker[], status: Status) {
    setRows((current) => {
      const next = { ...current };
      for (const worker of workers) {
        next[worker.id] = { ...(next[worker.id] ?? { overtime: '0.0', status }), status };
      }
      return next;
    });
  }

  function save() {
    start(async () => {
      const result = await saveAttendance({
        projectId,
        date,
        rows: roster.map((worker) => ({
          worker_id: worker.id,
          status: rows[worker.id]?.status ?? 'absent',
          overtime_hours: rows[worker.id]?.overtime || '0',
        })),
      });

      if (!result.ok) {
        // PERIOD_FINALISED and WORKER_OVERBOOKED both land here, and the API's
        // message names the site or the period — exactly what the user needs.
        toast.error(result.error ?? 'Could not save the roll call');
        return;
      }
      toast.success(`Roll call saved · ${money(result.data?.total_earned ?? '0')} earned`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Select value={projectId} onValueChange={(value) => navigate({ project: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(event) => navigate({ date: event.target.value })}
          className="w-[180px]"
          aria-label="Attendance date"
        />
        {recorded.locked && (
          <Badge tone="blocked">
            <Lock className="size-3" /> Locked by a finalised wage period
          </Badge>
        )}
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {longDate(date)}
          </span>
          <span className="text-[15px]">
            <span className="font-mono font-semibold">{presentCount}</span> of{' '}
            <span className="font-mono">{roster.length}</span> on site
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[12px] uppercase tracking-[0.08em] text-ink-muted">
              Earned today
            </span>
            <AnimatePresence mode="popLayout">
              <motion.span
                key={total.toString()}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="font-mono text-[20px] font-bold"
              >
                {money(total.toString())}
              </motion.span>
            </AnimatePresence>
          </div>
          <Button onClick={save} disabled={pending || recorded.locked || roster.length === 0}>
            <Save /> {pending ? 'Saving…' : 'Save roll call'}
          </Button>
        </div>
      </Card>

      {roster.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title="Nobody assigned to this site"
          body="Add workers to the roster and assign them to this site to take a roll call."
        />
      ) : (
        groups.map(([key, group]) => (
          <Card key={key} className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold">{group.name}</span>
                <span className="font-mono text-[13px] text-ink-muted">
                  {group.workers.length}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={recorded.locked}
                  onClick={() => markGroup(group.workers, 'present')}
                >
                  All present
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={recorded.locked}
                  onClick={() => markGroup(group.workers, 'absent')}
                >
                  All absent
                </Button>
              </div>
            </div>

            <ul className="divide-y divide-line-soft">
              {group.workers.map((worker) => {
                const row = rows[worker.id] ?? { status: 'absent' as Status, overtime: '0.0' };
                return (
                  <li
                    key={worker.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[15px] font-medium">{worker.name}</span>
                      <span className="text-[12.5px] text-ink-muted">
                        {worker.trade ?? 'No trade'} · {money(worker.daily_wage)}/day
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div
                        role="radiogroup"
                        aria-label={`Attendance for ${worker.name}`}
                        className="flex gap-1 rounded-btn bg-neutral-bg p-1"
                      >
                        {STATUSES.map((option) => {
                          const selected = row.status === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              disabled={recorded.locked}
                              onClick={() => setRow(worker.id, { status: option.value })}
                              className={cn(
                                'min-h-0 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
                                selected
                                  ? 'bg-surface font-semibold text-ink shadow-seg'
                                  : 'text-ink-soft hover:text-ink',
                                recorded.locked && 'opacity-60',
                              )}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Input
                          value={row.overtime}
                          onChange={(event) =>
                            setRow(worker.id, { overtime: event.target.value })
                          }
                          disabled={recorded.locked || row.status === 'absent'}
                          inputMode="decimal"
                          aria-label={`Overtime hours for ${worker.name}`}
                          className="w-[68px] text-center font-mono"
                        />
                        <span className="text-[12.5px] text-ink-muted">h OT</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
