/**
 * Where everything on the Gantt goes. Pure, so the arithmetic is tested rather than eyeballed.
 *
 * Positions are worked out in *logical* units: pixels from the timeline's start edge, which is the
 * left in English and the right in Arabic. HTML bars use them as `inset-inline-start` and the
 * browser mirrors them; the SVG overlay has no logical coordinates, so `physicalX` mirrors them
 * there by hand. The time axis is calendar days — a weekend is a gap in a bar, not a hidden column,
 * because that is how a site manager counts days on a wall chart.
 */

export type GanttZoom = 'day' | 'week' | 'month';
export type GanttDirection = 'ltr' | 'rtl';
export type GanttLinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type GanttEdge = 'start' | 'end';

/** Pixels per calendar day at each zoom. */
export const GANTT_SCALE: Readonly<Record<GanttZoom, number>> = Object.freeze({
  day: 30,
  week: 11,
  month: 3.5,
});

/** Height of one task row, shared by the table and the timeline so they line up. */
export const GANTT_ROW_HEIGHT = 36;
/** How far an arrow leaves a bar before it turns. */
export const GANTT_ARROW_STUB = 8;

const DAY_MS = 86_400_000;

export function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export function isoOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 Sunday … 6 Saturday, as JavaScript and the calendar API number them. */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export interface GanttRange {
  /** First day drawn. */
  start: string;
  /** Calendar days drawn. */
  days: number;
}

/**
 * The span to draw: every date given, with some room either side, snapped to the start of a week
 * (or a month when zoomed out) so the header's first tick is a whole one.
 */
export function ganttRange(dates: ReadonlyArray<string | null | undefined>, zoom: GanttZoom): GanttRange {
  const days = dates.filter((d): d is string => !!d).map(dayNumber);
  const today = Math.floor(Date.now() / DAY_MS);
  let first = days.length ? Math.min(...days) : today;
  let last = days.length ? Math.max(...days) : today + 30;
  const pad = zoom === 'day' ? 3 : zoom === 'week' ? 7 : 20;
  first -= pad;
  last += pad;
  if (zoom === 'month') {
    const d = new Date(first * DAY_MS);
    first = dayNumber(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  } else {
    // Back to Monday.
    first -= (weekdayOfDay(first) + 6) % 7;
  }
  // Wide enough to look like a chart even for a one-task schedule.
  const minDays = zoom === 'day' ? 28 : zoom === 'week' ? 84 : 270;
  return { start: isoOfDay(first), days: Math.max(last - first + 1, minDays) };
}

export interface GanttGeometry {
  range: GanttRange;
  zoom: GanttZoom;
  pxPerDay: number;
  /** Full width of the timeline. */
  width: number;
  /** Logical x of the start of a day. */
  dayX(iso: string): number;
  /** Logical start and width of a bar covering `start` to `finish`, both days included. */
  bar(start: string, finish: string): { x: number; width: number };
  /** Logical x of a milestone: the middle of its day. */
  milestoneX(iso: string): number;
}

export function ganttGeometry(range: GanttRange, zoom: GanttZoom): GanttGeometry {
  const pxPerDay = GANTT_SCALE[zoom];
  const origin = dayNumber(range.start);
  const dayX = (iso: string) => (dayNumber(iso) - origin) * pxPerDay;
  return {
    range,
    zoom,
    pxPerDay,
    width: range.days * pxPerDay,
    dayX,
    bar(start, finish) {
      const x = dayX(start);
      const end = dayX(finish) + pxPerDay;
      return { x, width: Math.max(end - x, pxPerDay) };
    },
    milestoneX(iso) {
      return dayX(iso) + pxPerDay / 2;
    },
  };
}

/** A logical x as a coordinate in the SVG, which always counts from the left. */
export function physicalX(logicalX: number, width: number, dir: GanttDirection): number {
  return dir === 'rtl' ? width - logicalX : logicalX;
}

export interface GanttTick {
  /** First day of the tick. */
  date: string;
  x: number;
  width: number;
}

/**
 * Header ticks. `major` is the upper row (months, or years when zoomed to months), `minor` the lower
 * (days, weeks or months). Each is clipped to the range.
 */
export function ganttTicks(geometry: GanttGeometry): { major: GanttTick[]; minor: GanttTick[] } {
  const { range, zoom, pxPerDay } = geometry;
  const first = dayNumber(range.start);
  const end = first + range.days;

  const monthStarts: number[] = [];
  const yearStarts: number[] = [];
  {
    const d = new Date(first * DAY_MS);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    for (;;) {
      const day = Math.floor(Date.UTC(y, m, 1) / DAY_MS);
      if (day >= end) break;
      monthStarts.push(day);
      if (m === 0) yearStarts.push(day);
      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
  }

  const spans = (starts: number[]): GanttTick[] => {
    const bounded = starts.length && starts[0]! > first ? [first, ...starts] : starts.length ? starts : [first];
    return bounded.map((day, i) => {
      const from = Math.max(day, first);
      const to = Math.min(bounded[i + 1] ?? end, end);
      return { date: isoOfDay(from), x: (from - first) * pxPerDay, width: (to - from) * pxPerDay };
    });
  };

  if (zoom === 'month') {
    return { major: spans(yearStarts), minor: spans(monthStarts) };
  }
  const minorStarts: number[] = [];
  const step = zoom === 'day' ? 1 : 7;
  // In week zoom the range starts on a Monday (see ganttRange), so the steps land on Mondays.
  for (let day = first; day < end; day += step) minorStarts.push(day);
  return { major: spans(monthStarts), minor: spans(minorStarts) };
}

/** Which edge of each bar a link joins: FS runs from the predecessor's end to the successor's start. */
export function linkEdges(type: GanttLinkType): { from: GanttEdge; to: GanttEdge } {
  return {
    from: type === 'FS' || type === 'FF' ? 'end' : 'start',
    to: type === 'FS' || type === 'SS' ? 'start' : 'end',
  };
}

export interface ArrowInput {
  /** Logical x of the edge the arrow leaves. */
  fromX: number;
  /** Row centre it leaves. */
  fromY: number;
  toX: number;
  toY: number;
  type: GanttLinkType;
  width: number;
  dir: GanttDirection;
  rowHeight?: number;
  stub?: number;
}

/**
 * The logical points of a dependency arrow, ending on the successor's edge.
 *
 * It leaves the predecessor outward (forward from an end, backward from a start), and enters the
 * successor from outside (from before a start, from after an end). When an FS successor starts far
 * enough after, that is one elbow; otherwise it doglegs along the row boundary just above (or below)
 * the successor's row so it never runs through a bar.
 */
export function arrowPoints(input: ArrowInput): Array<[number, number]> {
  const { fromX, fromY, toX, toY, type } = input;
  const rowHeight = input.rowHeight ?? GANTT_ROW_HEIGHT;
  const stub = input.stub ?? GANTT_ARROW_STUB;
  const { from, to } = linkEdges(type);
  const out = from === 'end' ? 1 : -1;
  const into = to === 'start' ? -1 : 1;
  const leaveX = fromX + out * stub;
  const enterX = toX + into * stub;

  if (from === 'end' && to === 'start' && enterX >= leaveX) {
    return [
      [fromX, fromY],
      [leaveX, fromY],
      [leaveX, toY],
      [toX, toY],
    ];
  }
  if (from === 'start' && to === 'end' && enterX <= leaveX) {
    return [
      [fromX, fromY],
      [leaveX, fromY],
      [leaveX, toY],
      [toX, toY],
    ];
  }
  if ((from === 'start' && to === 'start') || (from === 'end' && to === 'end')) {
    // Both on the same side: go out to whichever is further, then across.
    const x = from === 'start' ? Math.min(leaveX, enterX) : Math.max(leaveX, enterX);
    return [
      [fromX, fromY],
      [x, fromY],
      [x, toY],
      [toX, toY],
    ];
  }
  const midY = toY + (toY >= fromY ? -rowHeight / 2 : rowHeight / 2);
  return [
    [fromX, fromY],
    [leaveX, fromY],
    [leaveX, midY],
    [enterX, midY],
    [enterX, toY],
    [toX, toY],
  ];
}

/** The SVG path of a dependency arrow, mirrored for a right-to-left page. */
export function arrowPath(input: ArrowInput): string {
  return arrowPoints(input)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(physicalX(x, input.width, input.dir))} ${round(y)}`)
    .join(' ');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Centre of row `index`. */
export function rowCenter(index: number, rowHeight = GANTT_ROW_HEIGHT): number {
  return index * rowHeight + rowHeight / 2;
}
