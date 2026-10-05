import { describe, expect, it } from 'vitest';
import {
  GANTT_SCALE,
  arrowPath,
  arrowPoints,
  dayNumber,
  ganttGeometry,
  ganttRange,
  ganttTicks,
  linkEdges,
  physicalX,
  weekdayOfDay,
} from './gantt-geometry';

describe('ganttRange', () => {
  it('pads the dates and starts on a Monday for day and week zoom', () => {
    const range = ganttRange(['2026-03-04', '2026-03-20'], 'week');
    expect(weekdayOfDay(dayNumber(range.start))).toBe(1);
    expect(range.start <= '2026-02-25').toBe(true);
    expect(dayNumber(range.start) + range.days).toBeGreaterThan(dayNumber('2026-03-27'));
  });

  it('starts on the first of a month when zoomed to months', () => {
    const range = ganttRange(['2026-03-24', '2026-09-01'], 'month');
    expect(range.start).toBe('2026-03-01');
    expect(range.days).toBeGreaterThanOrEqual(270);
  });
});

describe('ganttGeometry', () => {
  const geo = ganttGeometry({ start: '2026-03-02', days: 28 }, 'day');

  it('places a day by its distance from the start', () => {
    expect(geo.pxPerDay).toBe(GANTT_SCALE.day);
    expect(geo.dayX('2026-03-02')).toBe(0);
    expect(geo.dayX('2026-03-05')).toBe(3 * GANTT_SCALE.day);
    expect(geo.width).toBe(28 * GANTT_SCALE.day);
  });

  it('covers both the first and the last day of a bar', () => {
    expect(geo.bar('2026-03-03', '2026-03-05')).toEqual({ x: GANTT_SCALE.day, width: 3 * GANTT_SCALE.day });
    expect(geo.bar('2026-03-03', '2026-03-03').width).toBe(GANTT_SCALE.day);
  });

  it('puts a milestone in the middle of its day', () => {
    expect(geo.milestoneX('2026-03-02')).toBe(GANTT_SCALE.day / 2);
  });

  it('scales with the zoom', () => {
    const week = ganttGeometry({ start: '2026-03-02', days: 28 }, 'week');
    const month = ganttGeometry({ start: '2026-03-02', days: 28 }, 'month');
    expect(week.dayX('2026-03-09')).toBe(7 * GANTT_SCALE.week);
    expect(month.dayX('2026-03-09')).toBe(7 * GANTT_SCALE.month);
    expect(GANTT_SCALE.day).toBeGreaterThan(GANTT_SCALE.week);
    expect(GANTT_SCALE.week).toBeGreaterThan(GANTT_SCALE.month);
  });
});

describe('physicalX', () => {
  it('is the logical x left to right and mirrored right to left', () => {
    expect(physicalX(30, 300, 'ltr')).toBe(30);
    expect(physicalX(30, 300, 'rtl')).toBe(270);
    expect(physicalX(0, 300, 'rtl')).toBe(300);
  });
});

describe('ganttTicks', () => {
  it('has a tick per day under month headings at day zoom', () => {
    const geo = ganttGeometry({ start: '2026-03-30', days: 7 }, 'day');
    const { major, minor } = ganttTicks(geo);
    expect(minor).toHaveLength(7);
    expect(major.map((t) => t.date)).toEqual(['2026-03-30', '2026-04-01']);
    expect(major[0]!.width).toBe(2 * GANTT_SCALE.day);
    expect(major[1]!.x).toBe(2 * GANTT_SCALE.day);
  });

  it('steps a week at a time at week zoom', () => {
    const geo = ganttGeometry({ start: '2026-03-02', days: 28 }, 'week');
    const { minor } = ganttTicks(geo);
    expect(minor.map((t) => t.date)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']);
    expect(minor[1]!.x).toBe(7 * GANTT_SCALE.week);
  });

  it('has months under years at month zoom', () => {
    const geo = ganttGeometry({ start: '2026-11-01', days: 90 }, 'month');
    const { major, minor } = ganttTicks(geo);
    expect(minor.map((t) => t.date)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(major.map((t) => t.date)).toEqual(['2026-11-01', '2027-01-01']);
  });
});

describe('dependency arrows', () => {
  it('joins the edges each link type names', () => {
    expect(linkEdges('FS')).toEqual({ from: 'end', to: 'start' });
    expect(linkEdges('SS')).toEqual({ from: 'start', to: 'start' });
    expect(linkEdges('FF')).toEqual({ from: 'end', to: 'end' });
    expect(linkEdges('SF')).toEqual({ from: 'start', to: 'end' });
  });

  it('draws one elbow for a successor that starts well after', () => {
    const points = arrowPoints({ fromX: 100, fromY: 18, toX: 200, toY: 54, type: 'FS', width: 400, dir: 'ltr' });
    expect(points).toEqual([
      [100, 18],
      [108, 18],
      [108, 54],
      [200, 54],
    ]);
  });

  it('doglegs back along the row boundary when the successor starts before the end', () => {
    const points = arrowPoints({ fromX: 100, fromY: 18, toX: 60, toY: 54, type: 'FS', width: 400, dir: 'ltr' });
    expect(points[0]).toEqual([100, 18]);
    expect(points[2]).toEqual([108, 36]);
    expect(points[3]).toEqual([52, 36]);
    expect(points.at(-1)).toEqual([60, 54]);
    // Last segment points forward, into the start of the bar.
    expect(points.at(-1)![0]).toBeGreaterThan(points.at(-2)![0]);
  });

  it('enters a finish-to-finish successor from after its end', () => {
    const points = arrowPoints({ fromX: 100, fromY: 18, toX: 150, toY: 54, type: 'FF', width: 400, dir: 'ltr' });
    expect(points.at(-1)).toEqual([150, 54]);
    expect(points.at(-2)![0]).toBeGreaterThan(150);
  });

  it('mirrors the path right to left, so the arrowhead points the other way', () => {
    const input = { fromX: 100, fromY: 18, toX: 200, toY: 54, type: 'FS' as const, width: 400 };
    expect(arrowPath({ ...input, dir: 'ltr' })).toBe('M100 18 L108 18 L108 54 L200 54');
    const rtl = arrowPath({ ...input, dir: 'rtl' });
    expect(rtl).toBe('M300 18 L292 18 L292 54 L200 54');
    // The last segment runs right to left: from 292 down to 200.
  });
});
