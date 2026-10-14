'use client';

import { useId, useMemo, type ReactNode } from 'react';
import type { ScheduleDependency, ScheduleTask } from '@/lib/schedule-types';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { cn } from '@/lib/utils';
import {
  GANTT_ROW_HEIGHT,
  arrowPath,
  dayNumber,
  ganttTicks,
  rowCenter,
  weekdayOfDay,
  type GanttDirection,
  type GanttGeometry,
} from './gantt-geometry';

/** Height of the two-row header; the task table's header matches it. */
export const GANTT_HEADER_HEIGHT = 48;

const BAR_HEIGHT = 16;
const MILESTONE_SIZE = 12;

/**
 * The bars, drawn with plain positioned HTML, and the links between them as one SVG overlay.
 *
 * HTML is positioned with `inset-inline-start`, so on an Arabic page the browser lays the chart out
 * right to left by itself; the SVG mirrors its own x coordinates (see `gantt-geometry`).
 */
export function GanttTimeline({
  rows,
  dependencies,
  geometry,
  statusDate,
  workingDays,
  dir,
  showBaseline,
  onOpen,
}: {
  rows: ScheduleTask[];
  dependencies: ScheduleDependency[];
  geometry: GanttGeometry;
  statusDate: string;
  workingDays: number[];
  dir: GanttDirection;
  showBaseline: boolean;
  onOpen?: (task: ScheduleTask) => void;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const markerId = useId().replace(/:/g, '');
  const ticks = useMemo(() => ganttTicks(geometry), [geometry]);
  const height = rows.length * GANTT_ROW_HEIGHT;
  const { width, pxPerDay, zoom } = geometry;

  // Month names in the company's locale; the format helpers stop at days.
  const months = useMemo(() => {
    const withYear = new Intl.DateTimeFormat(format.settings.locale, {
      month: zoom === 'day' ? 'long' : 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const alone = new Intl.DateTimeFormat(format.settings.locale, { month: 'short', timeZone: 'UTC' });
    const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
    return { withYear: (iso: string) => withYear.format(at(iso)), alone: (iso: string) => alone.format(at(iso)) };
  }, [format.settings.locale, zoom]);

  const rowOf = useMemo(() => new Map(rows.map((task, index) => [task.id, index])), [rows]);

  // The edges a link can join: a bar's two ends, or a milestone's two points.
  const edges = useMemo(() => {
    const out = new Map<string, { start: number; end: number }>();
    for (const task of rows) {
      if (task.kind === 'milestone') {
        const x = geometry.milestoneX(task.finish);
        out.set(task.id, { start: x - MILESTONE_SIZE / 2, end: x + MILESTONE_SIZE / 2 });
      } else {
        const bar = geometry.bar(task.start, task.finish);
        out.set(task.id, { start: bar.x, end: bar.x + bar.width });
      }
    }
    return out;
  }, [rows, geometry]);

  const critical = useMemo(() => new Set(rows.filter((r) => r.critical).map((r) => r.id)), [rows]);

  const arrows = dependencies.flatMap((link) => {
    const from = rowOf.get(link.predecessor_id);
    const to = rowOf.get(link.successor_id);
    const a = edges.get(link.predecessor_id);
    const b = edges.get(link.successor_id);
    if (from === undefined || to === undefined || !a || !b) return [];
    const fromEdge = link.type === 'FS' || link.type === 'FF' ? a.end : a.start;
    const toEdge = link.type === 'FS' || link.type === 'SS' ? b.start : b.end;
    return [
      {
        id: link.id,
        critical: critical.has(link.predecessor_id) && critical.has(link.successor_id),
        d: arrowPath({
          fromX: fromEdge,
          fromY: rowCenter(from),
          toX: toEdge,
          toY: rowCenter(to),
          type: link.type,
          width,
          dir,
        }),
      },
    ];
  });

  // Non-working weekdays shaded at day zoom, where a day is wide enough to see.
  const offDays = useMemo(() => {
    if (zoom !== 'day') return [];
    const first = dayNumber(geometry.range.start);
    const out: number[] = [];
    for (let i = 0; i < geometry.range.days; i += 1) {
      if (!workingDays.includes(weekdayOfDay(first + i))) out.push(i);
    }
    return out;
  }, [zoom, geometry.range, workingDays]);

  const statusX = geometry.dayX(statusDate);
  const range = (task: ScheduleTask) => `${format.shortDate(task.start)} – ${format.shortDate(task.finish)}`;

  return (
    <div className="relative" style={{ width }}>
      {/* Header */}
      <div className="relative border-b border-line bg-raised" style={{ height: GANTT_HEADER_HEIGHT }}>
        {ticks.major.map((tick) => (
          <div
            key={`M${tick.date}`}
            className="absolute top-0 flex h-6 items-center overflow-hidden whitespace-nowrap border-s border-line px-1.5 text-[11.5px] font-semibold text-ink-soft"
            style={{ insetInlineStart: tick.x, width: tick.width }}
          >
            {zoom === 'month' ? tick.date.slice(0, 4) : months.withYear(tick.date)}
          </div>
        ))}
        {ticks.minor.map((tick) => (
          <div
            key={`m${tick.date}`}
            className="absolute bottom-0 flex h-6 items-center justify-center overflow-hidden whitespace-nowrap border-s border-t border-line-soft font-mono text-[11px] text-ink-muted"
            style={{ insetInlineStart: tick.x, width: tick.width }}
          >
            {zoom === 'day'
              ? Number(tick.date.slice(8))
              : zoom === 'week'
                ? format.shortDate(tick.date)
                : months.alone(tick.date)}
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="relative" style={{ height }}>
        {offDays.map((i) => (
          <div
            key={`off${i}`}
            className="absolute inset-y-0 bg-track/50"
            style={{ insetInlineStart: i * pxPerDay, width: pxPerDay }}
          />
        ))}
        {ticks.minor.map((tick) => (
          <div
            key={`g${tick.date}`}
            className="absolute inset-y-0 border-s border-line-soft"
            style={{ insetInlineStart: tick.x }}
          />
        ))}
        {rows.map((task, index) => (
          <div
            key={`r${task.id}`}
            className="absolute inset-x-0 border-b border-line-soft"
            style={{ top: index * GANTT_ROW_HEIGHT, height: GANTT_ROW_HEIGHT }}
          />
        ))}

        {/* Status date */}
        {statusX >= 0 && statusX <= width && (
          <div
            className="absolute inset-y-0 z-[1] w-0.5 bg-accent/70"
            style={{ insetInlineStart: statusX }}
            title={`${t('Status date')}: ${format.longDate(statusDate)}`}
          />
        )}

        {rows.map((task, index) => {
          const top = index * GANTT_ROW_HEIGHT;
          const baseline = showBaseline && task.baseline ? geometry.bar(task.baseline.start, task.baseline.finish) : null;
          const label = `${task.name}: ${range(task)} · ${task.percent_complete}%`;
          const done = task.status === 'complete';
          let end: number;
          let shape: ReactNode;

          if (task.is_summary) {
            const bar = geometry.bar(task.start, task.finish);
            end = bar.x + bar.width;
            shape = (
              <button
                type="button"
                onClick={() => onOpen?.(task)}
                title={label}
                aria-label={label}
                className={cn('absolute z-[2] h-[7px] text-ink-soft', task.critical && 'text-blocked')}
                style={{ insetInlineStart: bar.x, width: bar.width, top: top + 10 }}
              >
                <span className="absolute inset-0 rounded-[2px] bg-current" />
                <span className="absolute start-0 top-0 h-3.5 w-1.5 rounded-b-[2px] bg-current" />
                <span className="absolute end-0 top-0 h-3.5 w-1.5 rounded-b-[2px] bg-current" />
              </button>
            );
          } else if (task.kind === 'milestone') {
            const x = geometry.milestoneX(task.finish);
            end = x + MILESTONE_SIZE / 2;
            shape = (
              <button
                type="button"
                onClick={() => onOpen?.(task)}
                title={`${task.name}: ${format.shortDate(task.finish)}`}
                aria-label={`${task.name}: ${format.shortDate(task.finish)}`}
                className={cn(
                  'absolute z-[2] rotate-45 rounded-[2px] border',
                  done
                    ? 'border-done bg-done'
                    : task.critical
                      ? 'border-blocked bg-blocked'
                      : 'border-ink-soft bg-ink-soft',
                )}
                style={{
                  insetInlineStart: x - MILESTONE_SIZE / 2,
                  width: MILESTONE_SIZE,
                  height: MILESTONE_SIZE,
                  top: top + (GANTT_ROW_HEIGHT - MILESTONE_SIZE) / 2 - 2,
                }}
              />
            );
          } else {
            const bar = geometry.bar(task.start, task.finish);
            end = bar.x + bar.width;
            shape = (
              <button
                type="button"
                onClick={() => onOpen?.(task)}
                title={label}
                aria-label={label}
                className={cn(
                  'absolute z-[2] overflow-hidden rounded-[5px] border transition hover:brightness-95',
                  done
                    ? 'border-done/70 bg-done-bg'
                    : task.critical
                      ? 'border-blocked/80 bg-blocked-bg'
                      : 'border-accent/60 bg-accent-soft',
                )}
                style={{ insetInlineStart: bar.x, width: bar.width, height: BAR_HEIGHT, top: top + 8 }}
              >
                <span
                  className={cn(
                    'absolute inset-y-0 start-0',
                    done ? 'bg-done/70' : task.critical ? 'bg-blocked/70' : 'bg-accent/70',
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, task.percent_complete))}%` }}
                />
              </button>
            );
          }

          return (
            <div key={task.id}>
              {baseline && (
                <div
                  className="absolute z-[1] h-[4px] rounded-full bg-ink-faint/60"
                  style={{ insetInlineStart: baseline.x, width: baseline.width, top: top + 27 }}
                  title={`${t('Baseline')}: ${format.shortDate(task.baseline!.start)} – ${format.shortDate(task.baseline!.finish)}`}
                />
              )}
              {shape}
              {task.behind && (
                <span
                  className="absolute z-[2] size-2 rounded-full bg-pending ring-2 ring-surface"
                  style={{ insetInlineStart: end + 4, top: top + 6 }}
                  title={t('Behind the status date')}
                  aria-label={t('Behind the status date')}
                />
              )}
              {zoom !== 'month' && (
                <span
                  className="pointer-events-none absolute z-[2] whitespace-nowrap text-[11.5px] leading-none text-ink-muted"
                  style={{ insetInlineStart: end + (task.behind ? 14 : 6), top: top + 12 }}
                >
                  {task.name}
                </span>
              )}
            </div>
          );
        })}

        {/* Links */}
        <svg
          className="pointer-events-none absolute inset-0 z-[3] overflow-visible"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden
        >
          <defs>
            {(['plain', 'critical'] as const).map((kind) => (
              <marker
                key={kind}
                id={`${markerId}-${kind}`}
                className={kind === 'critical' ? 'text-blocked' : 'text-ink-muted'}
                viewBox="0 0 8 8"
                refX="8"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
              </marker>
            ))}
          </defs>
          {arrows.map((arrow) => (
            <path
              key={arrow.id}
              d={arrow.d}
              fill="none"
              strokeWidth={1.25}
              stroke="currentColor"
              className={arrow.critical ? 'text-blocked' : 'text-ink-muted'}
              markerEnd={`url(#${markerId}-${arrow.critical ? 'critical' : 'plain'})`}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
