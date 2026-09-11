'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { AttendanceRegister } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The register grid: workers down the side, calendar days across the top.
 *
 * Two things carry the design:
 *
 * - The name column is sticky. A fortnight is 14 columns and a quarter is 92, so the
 *   grid scrolls sideways; a row whose name has scrolled out of view is unreadable.
 * - A day with no record shows a dot, not an A. "Absent" is a decision somebody
 *   recorded; a blank is nobody having said anything, which for a worker who was not
 *   expected on site is the truth.
 */

const CELL: Record<string, { label: string; className: string; title: string }> = {
  present: { label: 'P', className: 'bg-done-bg text-done-fg', title: 'Present' },
  half_day: { label: 'H', className: 'bg-pending-bg text-pending-fg', title: 'Half day' },
  absent: { label: 'A', className: 'bg-blocked-bg text-blocked-fg', title: 'Absent' },
};

export function RegisterGrid({ register }: { register: AttendanceRegister }) {
  const [query, setQuery] = useState('');

  const workers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return register.workers;
    return register.workers.filter((worker) =>
      [worker.worker_name, worker.trade, worker.contractor_name]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle)),
    );
  }, [register.workers, query]);

  function exportCsv() {
    const header = [
      'Worker',
      'Trade',
      'Contractor',
      ...register.dates,
      'Days present',
      'Overtime hours',
      'Earned (INR)',
    ];
    const rows = workers.map((worker) => [
      worker.worker_name,
      worker.trade ?? '',
      worker.contractor_name ?? 'Direct labour',
      ...register.dates.map((date) => {
        const cell = worker.days[date];
        if (!cell) return '';
        return CELL[cell.status]?.label ?? cell.status;
      }),
      worker.days_present,
      worker.overtime_hours,
      // Rupees with two decimals for a spreadsheet, which has no concept of paise.
      (Number(BigInt(worker.earned)) / 100).toFixed(2),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    // A BOM so Excel on Windows reads the rupee figures and Indian names as UTF-8
    // rather than mangling them into the system codepage.
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-register-${register.from}-to-${register.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workers, trades, contractors"
          className="w-[280px]"
          aria-label="Search the register"
        />
        <div className="flex items-center gap-3">
          <Legend />
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* The grid's own scroll container, so the page itself never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[200px] border-b border-line-soft bg-surface px-4 py-2.5 text-left font-semibold">
                Worker
              </th>
              {register.dates.map((date) => {
                const day = new Date(`${date}T00:00:00.000Z`);
                const sunday = day.getUTCDay() === 0;
                return (
                  <th
                    key={date}
                    className={cn(
                      'w-9 border-b border-line-soft px-0 py-2.5 text-center font-mono text-[11px] font-medium leading-tight',
                      sunday ? 'bg-raised text-ink-faint' : 'bg-surface text-ink-muted',
                    )}
                    title={date}
                  >
                    <span className="block">{date.slice(8)}</span>
                    <span className="block text-[9.5px] uppercase">
                      {day.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
                    </span>
                  </th>
                );
              })}
              <th className="border-b border-line-soft bg-surface px-3 py-2.5 text-right font-semibold">
                Days
              </th>
              <th className="border-b border-line-soft bg-surface px-3 py-2.5 text-right font-semibold">
                OT
              </th>
              <th className="border-b border-line-soft bg-surface px-4 py-2.5 text-right font-semibold">
                Earned
              </th>
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => (
              <tr key={worker.worker_id} className="group">
                <td className="sticky left-0 z-10 border-b border-line-soft bg-surface px-4 py-2 group-hover:bg-raised">
                  <div className="flex flex-col">
                    <span className="font-medium">{worker.worker_name}</span>
                    <span className="text-[11.5px] text-ink-muted">
                      {[worker.trade, worker.contractor_name ?? 'Direct labour']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </td>
                {register.dates.map((date) => {
                  const cell = worker.days[date];
                  const style = cell ? CELL[cell.status] : null;
                  const overtime = cell ? Number(cell.overtime_hours) > 0 : false;
                  return (
                    <td
                      key={date}
                      className="border-b border-line-soft px-0 py-2 text-center group-hover:bg-raised"
                      title={
                        cell
                          ? `${date} · ${style?.title ?? cell.status}${
                              overtime ? ` · ${cell.overtime_hours}h OT` : ''
                            }`
                          : `${date} · nothing recorded`
                      }
                    >
                      {cell && style ? (
                        <span
                          className={cn(
                            'relative inline-flex size-6 items-center justify-center rounded-[6px] font-mono text-[11.5px] font-bold',
                            style.className,
                          )}
                        >
                          {style.label}
                          {/* A dot rather than the number: at 24px the hours would not
                              fit, and the figure is in the tooltip and the CSV. */}
                          {overtime && (
                            <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-faint">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-line-soft px-3 py-2 text-right font-mono group-hover:bg-raised">
                  {worker.days_present}
                </td>
                <td className="border-b border-line-soft px-3 py-2 text-right font-mono text-ink-muted group-hover:bg-raised">
                  {worker.overtime_hours}
                </td>
                <td className="border-b border-line-soft px-4 py-2 text-right font-mono font-semibold group-hover:bg-raised">
                  {money(worker.earned)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-raised px-4 py-2.5 font-semibold">
                {workers.length} {workers.length === 1 ? 'worker' : 'workers'}
              </td>
              <td className="bg-raised" colSpan={register.dates.length} />
              <td className="bg-raised px-3 py-2.5 text-right font-mono font-semibold">
                {register.totals.days_present}
              </td>
              <td className="bg-raised px-3 py-2.5 text-right font-mono font-semibold">
                {register.totals.overtime_hours}
              </td>
              <td className="bg-raised px-4 py-2.5 text-right font-mono font-semibold">
                {money(register.totals.earned)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-ink-muted">
      {Object.entries(CELL).map(([status, style]) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-[5px] font-mono text-[10.5px] font-bold',
              style.className,
            )}
          >
            {style.label}
          </span>
          {style.title}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-accent" />
        Overtime
      </span>
    </div>
  );
}
