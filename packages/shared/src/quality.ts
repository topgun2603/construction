import { addDays, type IsoDate } from './dates';
import { quantityToThousandths } from './money';

/**
 * QA/QC (roadmap Phase 2, module 7): inspection checklists, material test reports, and snag and
 * punch lists with photos and sign-off.
 *
 * Everything here is pure — the rules a checklist answer, a lab result or a snag's status follow —
 * so the API, the web runner and the tests all judge "did this pass" the same way. Every export is
 * prefixed `QUALITY_`/`quality`/`snag`: safety (HSE) has checklists and observations of its own,
 * and the two must never share a name.
 */

// --- checklist items ---------------------------------------------------------------------------

/**
 * What a checklist line asks for.
 *
 * - `pass_fail` — the inspector's judgement: pass, fail or not applicable.
 * - `number` — a measurement judged against a target and tolerance: cover 40 mm +10/−0.
 * - `text` — something to write down (batch number, mix design reference). Informational.
 * - `photo` — pass/fail, and it cannot be answered without a photograph of the thing.
 */
export const QUALITY_ITEM_KINDS = ['pass_fail', 'number', 'text', 'photo'] as const;
export type QualityItemKind = (typeof QUALITY_ITEM_KINDS)[number];

export const QUALITY_ITEM_OUTCOMES = ['pass', 'fail', 'na'] as const;
export type QualityItemOutcome = (typeof QUALITY_ITEM_OUTCOMES)[number];

export const QUALITY_INSPECTION_STATUSES = ['in_progress', 'completed'] as const;
export type QualityInspectionStatus = (typeof QUALITY_INSPECTION_STATUSES)[number];

export const QUALITY_INSPECTION_RESULTS = ['pass', 'pass_with_comments', 'fail'] as const;
export type QualityInspectionResult = (typeof QUALITY_INSPECTION_RESULTS)[number];

/** Who signed an inspection. The inspector's signature is what completes it. */
export const QUALITY_SIGNOFF_PARTIES = ['inspector', 'client', 'consultant'] as const;
export type QualitySignoffParty = (typeof QUALITY_SIGNOFF_PARTIES)[number];

export const QUALITY_INSPECTION_RESULT_LABELS: Record<QualityInspectionResult, string> = {
  pass: 'Pass',
  pass_with_comments: 'Pass with comments',
  fail: 'Fail',
};

export interface QualityTolerance {
  /** Decimal strings, up to three places: `40`, `-2.5`. */
  target: string | null;
  /** How far below the target is still acceptable. Null is "no limit that side". */
  minus: string | null;
  /** How far above. */
  plus: string | null;
}

/**
 * Whether a measurement is inside its tolerance.
 *
 * Integer arithmetic on thousandths, never floats: `40.1` against `40 + 0.1` must be a pass, and a
 * float comparison makes it a coin toss. Returns null when there is nothing to judge against — a
 * number item with no target records the reading without passing or failing it.
 */
export function qualityMeasurementOutcome(
  value: string,
  tolerance: QualityTolerance,
): 'pass' | 'fail' | null {
  if (tolerance.target === null && tolerance.minus === null && tolerance.plus === null) return null;
  const reading = quantityToThousandths(value);
  if (tolerance.target === null) return null;
  const target = quantityToThousandths(tolerance.target);
  if (tolerance.minus !== null && reading < target - quantityToThousandths(tolerance.minus)) {
    return 'fail';
  }
  if (tolerance.plus !== null && reading > target + quantityToThousandths(tolerance.plus)) {
    return 'fail';
  }
  return 'pass';
}

/** Readable tolerance: `40 mm (+10 / −0)`. */
export function qualityToleranceLabel(tolerance: QualityTolerance, unit?: string | null): string {
  if (tolerance.target === null) return '';
  const base = unit ? `${tolerance.target} ${unit}` : tolerance.target;
  if (tolerance.minus === null && tolerance.plus === null) return base;
  if (tolerance.minus !== null && tolerance.minus === tolerance.plus) return `${base} ±${tolerance.plus}`;
  return `${base} (+${tolerance.plus ?? '∞'} / −${tolerance.minus ?? '∞'})`;
}

/** One answered line, as far as the completion rules care. */
export interface QualityAnsweredItem {
  label: string;
  kind: QualityItemKind;
  required: boolean;
  photoRequired: boolean;
  outcome: QualityItemOutcome | null;
  photoCount: number;
  comment: string | null;
}

/**
 * Why an inspection cannot be signed yet, one line per problem. Empty means it can.
 *
 * A required line left blank is the inspection not done, not a pass — and a photo-required line
 * with no photo is a claim nobody can check later, which is the whole reason it was marked so.
 */
export function qualityCompletionProblems(items: readonly QualityAnsweredItem[]): string[] {
  const problems: string[] = [];
  for (const item of items) {
    if (item.required && item.outcome === null) {
      problems.push(`“${item.label}” has not been answered`);
      continue;
    }
    const needsPhoto = item.kind === 'photo' || item.photoRequired;
    if (needsPhoto && item.outcome !== null && item.outcome !== 'na' && item.photoCount === 0) {
      problems.push(`“${item.label}” needs a photo`);
    }
  }
  return problems;
}

/**
 * The overall result an inspection's answers support.
 *
 * Any failed line fails the inspection; it cannot be talked up to a pass with comments. Without a
 * failure, comments on any line (or overall notes) make it "pass with comments", and the inspector
 * may also choose that themselves — downgrading a clean pass is always allowed, upgrading a failure
 * never is.
 */
export function qualityOverallResult(
  items: readonly Pick<QualityAnsweredItem, 'outcome' | 'comment'>[],
  options: { notes?: string | null; requested?: QualityInspectionResult | null } = {},
): QualityInspectionResult {
  if (items.some((item) => item.outcome === 'fail')) return 'fail';
  const commented =
    Boolean(options.notes?.trim()) || items.some((item) => Boolean(item.comment?.trim()));
  if (commented || options.requested === 'pass_with_comments') return 'pass_with_comments';
  return 'pass';
}

// --- material tests ----------------------------------------------------------------------------

export const QUALITY_TEST_TYPES = [
  'concrete_cube',
  'concrete_slump',
  'steel_tensile',
  'soil_compaction',
  'brick_compressive',
  'water_absorption',
  'other',
] as const;
export type QualityTestType = (typeof QUALITY_TEST_TYPES)[number];

export const QUALITY_TEST_RESULTS = ['pass', 'fail'] as const;
export type QualityTestResult = (typeof QUALITY_TEST_RESULTS)[number];

export const QUALITY_TEST_TYPE_LABELS: Record<QualityTestType, string> = {
  concrete_cube: 'Concrete cube strength',
  concrete_slump: 'Concrete slump',
  steel_tensile: 'Steel tensile strength',
  soil_compaction: 'Soil compaction',
  brick_compressive: 'Brick / block compressive strength',
  water_absorption: 'Water absorption',
  other: 'Other test',
};

/** The unit a test type is usually reported in, offered as the default. */
export const QUALITY_TEST_DEFAULT_UNITS: Record<QualityTestType, string> = {
  concrete_cube: 'N/mm²',
  concrete_slump: 'mm',
  steel_tensile: 'N/mm²',
  soil_compaction: '%',
  brick_compressive: 'N/mm²',
  water_absorption: '%',
  other: '',
};

/** Cube ages crushed by default: the early check and the one the specification is written for. */
export const QUALITY_CUBE_DEFAULT_AGES = [7, 28] as const;

/**
 * The share of the 28-day strength a 7-day cube is expected to reach, in basis points.
 *
 * 65% is the figure site engineers carry in their heads for ordinary Portland cement (IS 456 and
 * BS practice put the 7-day strength at roughly two-thirds); it is a default written onto the
 * 7-day row when the set is created, and editable there, not a rule enforced anywhere else.
 */
export const QUALITY_CUBE_EARLY_RATIO_BP = 6500;

/** The minimum a cube of `ageDays` should reach, given the 28-day characteristic strength. */
export function qualityCubeTarget(characteristic: string, ageDays: number): string {
  if (ageDays >= 28) return characteristic;
  const thousandths = quantityToThousandths(characteristic);
  // Rounded down to one decimal: the target printed on the sheet is what a lab compares against.
  const scaled = (thousandths * BigInt(QUALITY_CUBE_EARLY_RATIO_BP)) / 10_000n;
  const tenths = scaled / 100n;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** When a cube cast on `castOn` is due for crushing at `ageDays`. */
export function qualityTestDueOn(castOn: IsoDate, ageDays: number): IsoDate {
  return addDays(castOn, ageDays);
}

/**
 * Pass or fail against the specification: at least `min`, at most `max`, either optional. A test
 * with neither limit records a reading and judges nothing, like a number item with no target.
 */
export function qualityTestOutcome(
  value: string,
  spec: { min: string | null; max: string | null },
): QualityTestResult | null {
  if (spec.min === null && spec.max === null) return null;
  const reading = quantityToThousandths(value);
  if (spec.min !== null && reading < quantityToThousandths(spec.min)) return 'fail';
  if (spec.max !== null && reading > quantityToThousandths(spec.max)) return 'fail';
  return 'pass';
}

/** `≥ 25`, `75 – 100`, `≤ 12`. */
export function qualitySpecLabel(
  spec: { min: string | null; max: string | null },
  unit?: string | null,
): string {
  const suffix = unit ? ` ${unit}` : '';
  if (spec.min !== null && spec.max !== null) return `${spec.min} – ${spec.max}${suffix}`;
  if (spec.min !== null) return `≥ ${spec.min}${suffix}`;
  if (spec.max !== null) return `≤ ${spec.max}${suffix}`;
  return '';
}

/** Where a test is: waiting, due today or earlier with no result, or judged. */
export type QualityTestState = 'scheduled' | 'due' | 'overdue' | 'pass' | 'fail' | 'recorded';

export function qualityTestState(
  test: { dueOn: IsoDate | null; result: QualityTestResult | null; testedOn: IsoDate | null },
  today: IsoDate,
): QualityTestState {
  if (test.result) return test.result;
  if (test.testedOn) return 'recorded';
  if (!test.dueOn) return 'scheduled';
  if (test.dueOn < today) return 'overdue';
  if (test.dueOn === today) return 'due';
  return 'scheduled';
}

// --- snags -------------------------------------------------------------------------------------

/**
 * draft → open → fixed → closed, and fixed or closed → open again when it was not really fixed.
 *
 * `draft` exists for quick capture: a photo and three words from the slab become a snag somebody
 * confirms before it is assigned to anyone, so a misheard voice note never lands on a
 * subcontractor's list as an instruction.
 */
export const SNAG_STATUSES = ['draft', 'open', 'fixed', 'closed'] as const;
export type SnagStatus = (typeof SNAG_STATUSES)[number];

export const SNAG_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type SnagPriority = (typeof SNAG_PRIORITIES)[number];

export const SNAG_SOURCES = ['manual', 'inspection', 'quick_capture', 'test'] as const;
export type SnagSource = (typeof SNAG_SOURCES)[number];

export const SNAG_PHOTO_STAGES = ['before', 'after'] as const;
export type SnagPhotoStage = (typeof SNAG_PHOTO_STAGES)[number];

export const SNAG_STATUS_LABELS: Record<SnagStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  fixed: 'Fixed',
  closed: 'Closed',
};

export const SNAG_PRIORITY_LABELS: Record<SnagPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** The moves a snag can make, named by the action that makes them. */
export const SNAG_TRANSITIONS: Record<'open' | 'fix' | 'verify' | 'reopen', readonly SnagStatus[]> = {
  /** Confirming a draft. */
  open: ['draft'],
  fix: ['open'],
  verify: ['fixed'],
  reopen: ['fixed', 'closed'],
};

export function snagCanTransition(
  action: keyof typeof SNAG_TRANSITIONS,
  from: SnagStatus,
): boolean {
  return SNAG_TRANSITIONS[action].includes(from);
}

/** Age buckets the open-snag report groups by, in days since raised. */
export const SNAG_AGE_BUCKETS = [
  { key: '0-7', label: 'Up to a week', max: 7 },
  { key: '8-14', label: '1–2 weeks', max: 14 },
  { key: '15-30', label: '2–4 weeks', max: 30 },
  { key: '31+', label: 'Over a month', max: Number.POSITIVE_INFINITY },
] as const;

export function snagAgeBucket(ageDays: number): (typeof SNAG_AGE_BUCKETS)[number]['key'] {
  return (SNAG_AGE_BUCKETS.find((bucket) => ageDays <= bucket.max) ?? SNAG_AGE_BUCKETS[3]).key;
}

/** The trades a snag is usually filed under. Free text is allowed; these are the suggestions. */
export const SNAG_TRADES = [
  'Civil',
  'Concrete',
  'Masonry',
  'Plastering',
  'Waterproofing',
  'Tiling',
  'Painting',
  'Carpentry',
  'Doors and windows',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Glazing',
  'Cleaning',
] as const;

/**
 * Words that point at a trade. Each matches at the start of a word, so "leaking" finds "leak" and
 * "tiles" finds "tile"; one written with a trailing space must match whole ("tap " is not
 * "tapping", which is how a tiler finds hollow tiles). The trade with the most hits wins, and a tie
 * goes to the one listed first.
 */
const TRADE_HINTS: ReadonlyArray<{ trade: (typeof SNAG_TRADES)[number]; words: readonly string[] }> = [
  { trade: 'Waterproofing', words: ['seepage', 'damp', 'waterproof', 'efflorescence', 'flood test'] },
  { trade: 'Electrical', words: ['switch', 'socket', 'wiring', 'wire', 'mcb', 'db ', 'light', 'conduit', 'earthing', 'fan point'] },
  { trade: 'Plumbing', words: ['leak', 'pipe', 'tap ', 'taps ', 'drain', 'flush', 'trap ', 'sanitary', 'cistern', 'basin', 'water pressure'] },
  { trade: 'Tiling', words: ['tile', 'tiling', 'grout', 'hollow', 'skirting'] },
  { trade: 'Painting', words: ['paint', 'putty', 'touch up', 'stain', 'shade'] },
  { trade: 'Plastering', words: ['plaster', 'hairline', 'undulation'] },
  { trade: 'Concrete', words: ['honeycomb', 'rebar', 'cover block', 'slab', 'beam', 'column', 'concrete', 'shuttering'] },
  { trade: 'Doors and windows', words: ['door', 'window', 'hinge', 'lock ', 'locks ', 'frame'] },
  { trade: 'Glazing', words: ['glass', 'glazing', 'sealant'] },
  { trade: 'Masonry', words: ['brick', 'block', 'masonry', 'mortar'] },
  { trade: 'HVAC', words: ['duct', 'hvac', 'chiller', 'air condition'] },
  { trade: 'Cleaning', words: ['debris', 'housekeeping', 'cleaning'] },
];

const CRITICAL_HINTS = ['structural', 'exposed rebar', 'collapse', 'unsafe', 'live wire', 'shock', 'sparking', 'sagging'];
const HIGH_HINTS = ['leak', 'seepage', 'crack', 'honeycomb', 'broken', 'not working', 'no water'];
const LOW_HINTS = ['touch up', 'scratch', 'stain', 'clean', 'paint', 'cosmetic'];

/** `touch up` matches "touch-up" and "touch  up" too; a trailing space means a whole word. */
function hintMatches(word: string, text: string): boolean {
  const whole = word.endsWith(' ');
  const body = word
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '[\\s-]+');
  return new RegExp(`\\b${body}${whole ? '\\b' : ''}`, 'i').test(text);
}

export interface SnagSuggestion {
  title: string;
  trade: string | null;
  priority: SnagPriority;
}

/**
 * A first guess at a snag's title, trade and priority from the few words somebody said or typed.
 *
 * Deterministic and offline on purpose: quick capture has to work on a deployment with no AI key,
 * in a basement with no signal, and in the test suite. When a model is configured the API may ask
 * it for a better guess; this is what the snag gets either way, and what a person corrects.
 */
export function suggestSnagFromNote(note: string): SnagSuggestion {
  const clean = note.replace(/\s+/g, ' ').trim();
  const has = (word: string) => hintMatches(word, clean);

  let trade: string | null = null;
  let best = 0;
  for (const hint of TRADE_HINTS) {
    const hits = hint.words.filter(has).length;
    if (hits > best) {
      best = hits;
      trade = hint.trade;
    }
  }
  const priority: SnagPriority = CRITICAL_HINTS.some(has)
    ? 'critical'
    : HIGH_HINTS.some(has)
      ? 'high'
      : LOW_HINTS.some(has)
        ? 'low'
        : 'medium';

  // The first sentence, trimmed to something a list can show on one line.
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const title = first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
  return { title: title ? title[0]!.toUpperCase() + title.slice(1) : '', trade, priority };
}

// --- the standard checklist library ------------------------------------------------------------

export interface QualityStandardItem {
  label: string;
  kind: QualityItemKind;
  required?: boolean;
  photo_required?: boolean;
  unit?: string;
  target_value?: string;
  tolerance_minus?: string;
  tolerance_plus?: string;
  guidance?: string;
}

export interface QualityStandardChecklist {
  name: string;
  trade: string;
  description: string;
  items: readonly QualityStandardItem[];
}

const pf = (label: string, extra: Partial<QualityStandardItem> = {}): QualityStandardItem => ({
  label,
  kind: 'pass_fail',
  ...extra,
});

/**
 * The checklists every company starts with, copied into its own library the first time it opens
 * one — after that they are the company's to edit, like a cost code template. Code rather than
 * rows so they can be improved without a migration writing into every tenant.
 *
 * Wording follows what an Indian or Gulf site engineer actually ticks on a pour card or a handover
 * sheet; tolerances are the common specification values (IS 456 / BS EN 13670 territory), set as
 * targets a company will adjust to its own specification.
 */
export const QUALITY_STANDARD_CHECKLISTS: readonly QualityStandardChecklist[] = [
  {
    name: 'Pre-pour concrete check',
    trade: 'Concrete',
    description: 'Signed before any concrete is placed: formwork, steel, embedments, and the mix.',
    items: [
      pf('Formwork and reinforcement inspections signed off'),
      pf('Levels and slab thickness checked', { photo_required: true }),
      { label: 'Slab thickness', kind: 'number', unit: 'mm', target_value: '150', tolerance_minus: '5', tolerance_plus: '10' },
      pf('Conduits, sleeves and inserts fixed as per drawings', { photo_required: true }),
      pf('Formwork clean, oiled, joints sealed'),
      { label: 'Mix design / grade', kind: 'text', guidance: 'e.g. M25, RMC batch slip number' },
      pf('Vibrators (and a standby) on site and working'),
      pf('Curing arrangement ready'),
      pf('Cube moulds and slump cone available'),
    ],
  },
  {
    name: 'Reinforcement inspection',
    trade: 'Concrete',
    description: 'Bar sizes, spacing, laps and cover, checked against the bar bending schedule.',
    items: [
      pf('Bar diameters as per drawing / BBS'),
      { label: 'Bar spacing', kind: 'number', unit: 'mm', target_value: '150', tolerance_minus: '10', tolerance_plus: '10' },
      { label: 'Clear cover', kind: 'number', unit: 'mm', target_value: '25', tolerance_minus: '0', tolerance_plus: '10', guidance: 'Measure at cover blocks' },
      pf('Lap lengths and locations as specified'),
      pf('Cover blocks fixed at the right spacing', { photo_required: true }),
      pf('Chairs and spacer bars in place'),
      pf('Steel clean — free of rust scale, oil and mud'),
      pf('Binding wire ends turned inwards'),
    ],
  },
  {
    name: 'Formwork / shuttering',
    trade: 'Concrete',
    description: 'Line, level, plumb, tightness and propping before steel or concrete goes in.',
    items: [
      pf('Dimensions as per drawing'),
      { label: 'Plumb (column / wall)', kind: 'number', unit: 'mm per 3 m', target_value: '0', tolerance_minus: '5', tolerance_plus: '5' },
      pf('Level and camber checked'),
      pf('Props plumb, braced and on firm base', { photo_required: true }),
      pf('Joints tight — no gaps for slurry loss'),
      pf('Shuttering oil applied, surfaces clean'),
      pf('Openings and pockets provided'),
    ],
  },
  {
    name: 'Brickwork / blockwork',
    trade: 'Masonry',
    description: 'Walls checked while the mortar is fresh enough to correct.',
    items: [
      pf('Bricks / blocks soaked or as specified'),
      { label: 'Mortar mix', kind: 'text', guidance: 'e.g. 1:6 CM' },
      { label: 'Joint thickness', kind: 'number', unit: 'mm', target_value: '10', tolerance_minus: '2', tolerance_plus: '2' },
      { label: 'Plumb', kind: 'number', unit: 'mm per 3 m', target_value: '0', tolerance_minus: '5', tolerance_plus: '5' },
      pf('Courses level, bond maintained'),
      pf('Lintels / bands at the right level'),
      pf('Wall ties / mesh at RCC junctions'),
      pf('Curing being done'),
    ],
  },
  {
    name: 'Plastering',
    trade: 'Plastering',
    description: 'Internal and external plaster: base preparation, thickness, finish and curing.',
    items: [
      pf('Surface hacked / chipped and cleaned'),
      pf('Mesh at RCC–masonry junctions', { photo_required: true }),
      { label: 'Plaster thickness', kind: 'number', unit: 'mm', target_value: '12', tolerance_minus: '2', tolerance_plus: '3' },
      { label: 'Undulation under 2 m straight edge', kind: 'number', unit: 'mm', target_value: '0', tolerance_minus: '0', tolerance_plus: '3' },
      pf('Edges, corners and grooves true'),
      pf('No cracks or hollow sound'),
      pf('Curing for 7 days'),
    ],
  },
  {
    name: 'Waterproofing',
    trade: 'Waterproofing',
    description: 'Wet areas, terraces and basements — finished with a flood test.',
    items: [
      pf('Surface clean, dry and repaired'),
      pf('Coving / fillets at wall–floor junctions', { photo_required: true }),
      pf('Primer applied'),
      { label: 'Number of coats', kind: 'number', unit: 'coats', target_value: '2', tolerance_minus: '0' },
      pf('Lapped up the walls to the specified height'),
      pf('Pipe penetrations sealed'),
      { label: 'Flood test duration', kind: 'number', unit: 'hours', target_value: '48', tolerance_minus: '0', guidance: 'Pond and check below for 48 hours' },
      { label: 'Flood test — no seepage below', kind: 'photo' },
    ],
  },
  {
    name: 'Tiling',
    trade: 'Tiling',
    description: 'Floor and wall tiling: line, level, joints, slope and the tap test.',
    items: [
      pf('Tiles of approved make, shade and batch'),
      pf('Base levelled and cured'),
      { label: 'Joint width', kind: 'number', unit: 'mm', target_value: '2', tolerance_minus: '0.5', tolerance_plus: '0.5' },
      pf('Lines and levels true'),
      pf('Slope towards drains in wet areas'),
      pf('No hollow sound on tapping'),
      pf('No chipped or cracked tiles', { photo_required: true }),
      pf('Joints grouted and cleaned'),
    ],
  },
  {
    name: 'Electrical first fix',
    trade: 'Electrical',
    description: 'Concealed conduits and boxes, before they disappear under plaster.',
    items: [
      pf('Conduit route as per layout'),
      pf('Conduit size and make as specified'),
      pf('Boxes at the right heights', { photo_required: true }),
      pf('Bends without kinks; pull wires in'),
      pf('Conduits fixed and chased neatly'),
      pf('Separate conduits for power and low voltage'),
      pf('Earthing provision made'),
    ],
  },
  {
    name: 'Plumbing pressure test',
    trade: 'Plumbing',
    description: 'Concealed supply lines pressure-tested before they are covered.',
    items: [
      pf('Pipes and fittings of approved make'),
      pf('All open ends capped'),
      { label: 'Test pressure', kind: 'number', unit: 'kg/cm²', target_value: '10', tolerance_minus: '0', guidance: '1.5 × working pressure' },
      { label: 'Holding time', kind: 'number', unit: 'minutes', target_value: '30', tolerance_minus: '0' },
      { label: 'Pressure drop', kind: 'number', unit: 'kg/cm²', target_value: '0', tolerance_minus: '0', tolerance_plus: '0' },
      { label: 'Gauge reading at end of test', kind: 'photo' },
      pf('No leaks at joints'),
    ],
  },
];
