/**
 * Safety (HSE) — incidents and near misses, permits to work, toolbox talks and safety observations
 * (roadmap Phase 2, module 8).
 *
 * The vocabulary, the default libraries a new company starts from, and the arithmetic behind the
 * safety KPIs. Pure functions only: the API and the web both call these, so the LTIFR an owner reads
 * on the dashboard and the one in the CSV are the same number by construction.
 *
 * Everything exported is prefixed `safety`/`SAFETY_`: QA/QC has checklists and observations of its
 * own, and the two must never be mistaken for each other in an import.
 */

// --- vocabulary ------------------------------------------------------------------------------------

export const SAFETY_INCIDENT_TYPES = [
  'near_miss',
  'first_aid',
  'medical_treatment',
  'lost_time_injury',
  'fatality',
  'property_damage',
  'environmental',
] as const;
export type SafetyIncidentType = (typeof SAFETY_INCIDENT_TYPES)[number];

export const SAFETY_INCIDENT_TYPE_LABELS: Record<SafetyIncidentType, string> = {
  near_miss: 'Near miss',
  first_aid: 'First aid',
  medical_treatment: 'Medical treatment',
  lost_time_injury: 'Lost-time injury',
  fatality: 'Fatality',
  property_damage: 'Property damage',
  environmental: 'Environmental',
};

/**
 * Lost-time injuries for LTIFR and "days since last LTI". A fatality counts: it is the most lost
 * time there is, and a site that had one must not show a clean record because it was filed under a
 * different heading.
 */
export const SAFETY_LTI_TYPES: readonly SafetyIncidentType[] = ['lost_time_injury', 'fatality'];

/**
 * Recordable injuries for TRIR (the OSHA definition): anything beyond first aid. Near misses,
 * first aid, property damage and spills are tracked, but are not recordable injuries.
 */
export const SAFETY_RECORDABLE_TYPES: readonly SafetyIncidentType[] = [
  'medical_treatment',
  'lost_time_injury',
  'fatality',
];

/** What tells the owners at once, by notification and WhatsApp, rather than at the next review. */
export const SAFETY_SERIOUS_TYPES: readonly SafetyIncidentType[] = SAFETY_LTI_TYPES;

export function safetyIsLti(type: string): boolean {
  return (SAFETY_LTI_TYPES as readonly string[]).includes(type);
}

export function safetyIsRecordable(type: string): boolean {
  return (SAFETY_RECORDABLE_TYPES as readonly string[]).includes(type);
}

export function safetyIsSerious(type: string): boolean {
  return (SAFETY_SERIOUS_TYPES as readonly string[]).includes(type);
}

export const SAFETY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

export const SAFETY_INCIDENT_STATUSES = ['reported', 'investigating', 'actions_open', 'closed'] as const;
export type SafetyIncidentStatus = (typeof SAFETY_INCIDENT_STATUSES)[number];

/**
 * reported → investigating → actions open → closed. A minor incident with nothing to fix may close
 * straight from investigating, and a closed one can be reopened when something new comes to light —
 * a first aid case that turns into a lost-time injury three days later is the usual reason.
 */
export const SAFETY_INCIDENT_TRANSITIONS: Record<SafetyIncidentStatus, readonly SafetyIncidentStatus[]> = {
  reported: ['investigating'],
  investigating: ['actions_open', 'closed'],
  actions_open: ['investigating', 'closed'],
  closed: ['investigating'],
};

export const SAFETY_PERSON_ROLES = ['injured', 'involved', 'witness'] as const;
export type SafetyPersonRole = (typeof SAFETY_PERSON_ROLES)[number];

export const SAFETY_ACTION_KINDS = ['corrective', 'preventive'] as const;
export type SafetyActionKind = (typeof SAFETY_ACTION_KINDS)[number];

export const SAFETY_ACTION_STATUSES = ['open', 'done', 'cancelled'] as const;
export type SafetyActionStatus = (typeof SAFETY_ACTION_STATUSES)[number];

export const SAFETY_OBSERVATION_TYPES = ['unsafe_act', 'unsafe_condition', 'positive'] as const;
export type SafetyObservationType = (typeof SAFETY_OBSERVATION_TYPES)[number];

export const SAFETY_OBSERVATION_TYPE_LABELS: Record<SafetyObservationType, string> = {
  unsafe_act: 'Unsafe act',
  unsafe_condition: 'Unsafe condition',
  positive: 'Positive',
};

export const SAFETY_OBSERVATION_STATUSES = ['open', 'closed'] as const;
export type SafetyObservationStatus = (typeof SAFETY_OBSERVATION_STATUSES)[number];

export const SAFETY_CATEGORIES = [
  'ppe',
  'housekeeping',
  'scaffolding',
  'work_at_height',
  'electrical',
  'excavation',
  'lifting',
  'fire',
  'tools_equipment',
  'vehicles_traffic',
  'chemicals',
  'other',
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const SAFETY_CATEGORY_LABELS: Record<SafetyCategory, string> = {
  ppe: 'PPE',
  housekeeping: 'Housekeeping',
  scaffolding: 'Scaffolding',
  work_at_height: 'Work at height',
  electrical: 'Electrical',
  excavation: 'Excavation',
  lifting: 'Lifting',
  fire: 'Fire',
  tools_equipment: 'Tools and equipment',
  vehicles_traffic: 'Vehicles and traffic',
  chemicals: 'Chemicals',
  other: 'Other',
};

export const SAFETY_PHOTO_PURPOSES = ['evidence', 'witness_statement', 'closeout', 'attendance'] as const;
export type SafetyPhotoPurpose = (typeof SAFETY_PHOTO_PURPOSES)[number];

// --- permits to work --------------------------------------------------------------------------------

export const SAFETY_PERMIT_TYPES = [
  'hot_work',
  'work_at_height',
  'confined_space',
  'excavation',
  'electrical_isolation',
  'lifting',
] as const;
export type SafetyPermitType = (typeof SAFETY_PERMIT_TYPES)[number];

export const SAFETY_PERMIT_TYPE_LABELS: Record<SafetyPermitType, string> = {
  hot_work: 'Hot work',
  work_at_height: 'Work at height',
  confined_space: 'Confined space',
  excavation: 'Excavation',
  electrical_isolation: 'Electrical isolation (LOTO)',
  lifting: 'Lifting',
};

/**
 * requested → active (once both the issuer and the area authority have signed and the checklist is
 * complete) ⇄ suspended → closed. "Expired" is not a status: it is an active permit whose time ran
 * out, and the work under it has to stop until somebody closes it or raises a new one. Keeping it
 * derived means the clock, not a job that might not have run yet, decides what is valid.
 */
export const SAFETY_PERMIT_STATUSES = ['requested', 'active', 'suspended', 'closed'] as const;
export type SafetyPermitStatus = (typeof SAFETY_PERMIT_STATUSES)[number];

/** The two signatures a permit needs before work starts. */
export const SAFETY_PERMIT_APPROVALS = ['issuer', 'area_authority'] as const;
export type SafetyPermitApproval = (typeof SAFETY_PERMIT_APPROVALS)[number];

/** The longest a single permit may run. Longer jobs are re-permitted shift by shift, by design. */
export const SAFETY_PERMIT_MAX_HOURS = 24;

/**
 * The default checklist for each permit type — the seed every company starts from. Short on
 * purpose: these are the checks that are skipped in practice and kill people when they are, not a
 * copy of a standard nobody reads at the gate.
 */
export const SAFETY_PERMIT_CHECKLISTS: Record<SafetyPermitType, readonly string[]> = {
  hot_work: [
    'Combustibles removed or covered within 11 m',
    'Fire extinguisher at the work point',
    'Fire watch assigned for the work and 30 minutes after',
    'Gas cylinders upright, chained, flashback arrestors fitted',
    'Welding screens in place',
  ],
  work_at_height: [
    'Full-body harness inspected and worn',
    'Anchor point rated and identified',
    'Scaffold or platform tagged as inspected',
    'Edge protection and toe boards in place',
    'Area below barricaded',
    'Rescue plan briefed',
  ],
  confined_space: [
    'Atmosphere tested (O2, LEL, H2S, CO) and recorded',
    'Ventilation running',
    'Standby person at the entry, not entering',
    'Rescue equipment and tripod at the entry',
    'Entrants briefed and logged in and out',
  ],
  excavation: [
    'Underground services located and marked',
    'Sides shored, battered or benched',
    'Spoil and plant kept back from the edge',
    'Safe access ladder in place',
    'Edge barricades and night lighting in place',
  ],
  electrical_isolation: [
    'Circuit identified on the drawing',
    'Isolated and locked out with a personal lock',
    'Danger tag fixed at the isolation point',
    'Proved dead with a tested voltage detector',
    'Stored energy discharged',
  ],
  lifting: [
    'Lift plan prepared and briefed',
    'Crane and lifting gear certificates in date',
    'Ground conditions checked, outriggers on pads',
    'Exclusion zone barricaded',
    'Banksman or signaller assigned',
    'Wind speed within the crane limit',
  ],
};

export interface SafetyChecklistItem {
  item: string;
  checked: boolean;
}

/** A fresh, unticked checklist for a permit of this type. */
export function safetyDefaultChecklist(type: SafetyPermitType): SafetyChecklistItem[] {
  return SAFETY_PERMIT_CHECKLISTS[type].map((item) => ({ item, checked: false }));
}

// --- toolbox talks ----------------------------------------------------------------------------------

/**
 * The topic library a company starts from. A supervisor with five minutes before the shift should
 * pick a topic, not invent one; free-text topics are still allowed.
 */
export const SAFETY_TOOLBOX_TOPICS: ReadonlyArray<{ key: string; title: string; category: SafetyCategory }> = [
  { key: 'ppe_basics', title: 'PPE: helmet, boots, gloves, vest — every time', category: 'ppe' },
  { key: 'harness', title: 'Using and inspecting a full-body harness', category: 'work_at_height' },
  { key: 'ladders', title: 'Ladders: three points of contact', category: 'work_at_height' },
  { key: 'scaffold', title: 'Scaffold tags and what they mean', category: 'scaffolding' },
  { key: 'housekeeping', title: 'Housekeeping: clear walkways, no trip hazards', category: 'housekeeping' },
  { key: 'heat_stress', title: 'Heat stress: water, rest, shade', category: 'other' },
  { key: 'manual_handling', title: 'Manual handling: lift with the legs', category: 'other' },
  { key: 'electrical', title: 'Temporary electrics, cables and ELCBs', category: 'electrical' },
  { key: 'excavation', title: 'Working near excavations', category: 'excavation' },
  { key: 'lifting', title: 'Lifting operations and the exclusion zone', category: 'lifting' },
  { key: 'hot_work', title: 'Hot work and fire watch', category: 'fire' },
  { key: 'fire_emergency', title: 'Fire extinguishers and the assembly point', category: 'fire' },
  { key: 'power_tools', title: 'Power tools: guards and inspection', category: 'tools_equipment' },
  { key: 'traffic', title: 'Vehicles, reversing and banksmen', category: 'vehicles_traffic' },
  { key: 'chemicals', title: 'Cement, curing compounds and chemicals', category: 'chemicals' },
  { key: 'near_miss', title: 'Why we report near misses', category: 'other' },
];

// --- time --------------------------------------------------------------------------------------------

/** A wall-clock time on the company's clock: `2026-10-06T14:30`. */
export const SAFETY_LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The instant a wall-clock time in `timeZone` names.
 *
 * A supervisor in Dubai who says the incident happened at 14:30 means 14:30 in Dubai, whatever the
 * server's clock or the office's browser says. Two passes, so a time on a daylight-saving boundary
 * lands on the offset in force at that moment rather than the one a few hours earlier.
 */
export function safetyLocalToInstant(local: string, timeZone: string): Date {
  const match = SAFETY_LOCAL_DATETIME.exec(local);
  if (!match) throw new Error(`Not a local date-time: ${local}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall - offsetMs(timeZone, new Date(wall));
  instant = wall - offsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/** The same instant written back as a wall-clock time in `timeZone`, for a form to edit. */
export function safetyInstantToLocal(instant: Date, timeZone: string): string {
  const shifted = new Date(instant.getTime() + offsetMs(timeZone, instant));
  return shifted.toISOString().slice(0, 16);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetMs(timeZone: string, at: Date): number {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// --- KPIs --------------------------------------------------------------------------------------------

/**
 * Hours in a standard shift, for turning the roll call into man-hours. The roll call records who was
 * present and their overtime, not clock-in times; a present day is a shift, a half day half of one.
 */
export const SAFETY_SHIFT_HOURS = 8;

/** The exposure base of LTIFR: injuries per million hours worked. */
export const SAFETY_LTIFR_BASE = 1_000_000;

/** The exposure base of TRIR (OSHA): 100 full-time workers for a year, 200,000 hours. */
export const SAFETY_TRIR_BASE = 200_000;

export interface SafetyAttendanceTally {
  status: 'present' | 'half_day' | 'absent' | string;
  /** Rows with this status. */
  days: number;
  /** Overtime hours across those rows, as a decimal string or number. */
  overtimeHours: string | number;
}

/**
 * Man-hours worked from the roll call: a shift per present day, half a shift per half day, plus
 * the overtime that was recorded. Absent rows carry no hours even if overtime was typed on them.
 */
export function safetyManHours(
  tallies: readonly SafetyAttendanceTally[],
  shiftHours: number = SAFETY_SHIFT_HOURS,
): number {
  let total = 0;
  for (const row of tallies) {
    if (row.status === 'absent') continue;
    const shift = row.status === 'half_day' ? shiftHours / 2 : shiftHours;
    const overtime = Number(row.overtimeHours) || 0;
    total += row.days * shift + overtime;
  }
  return Math.round(total * 10) / 10;
}

/** Rounded to two places; null with no hours worked, because a rate of nothing is not zero. */
function frequency(count: number, manHours: number, base: number): number | null {
  if (!(manHours > 0)) return null;
  return Math.round(((count * base) / manHours) * 100) / 100;
}

/** Lost-time injury frequency rate: LTIs × 1,000,000 ÷ man-hours. */
export function safetyLtifr(ltiCount: number, manHours: number): number | null {
  return frequency(ltiCount, manHours, SAFETY_LTIFR_BASE);
}

/** Total recordable incident rate: recordables × 200,000 ÷ man-hours. */
export function safetyTrir(recordableCount: number, manHours: number): number | null {
  return frequency(recordableCount, manHours, SAFETY_TRIR_BASE);
}

/**
 * Whole days from `since` to `today` (both `YYYY-MM-DD` on the company's clock). An LTI today is
 * zero days since; null when there is nothing to count from.
 */
export function safetyDaysSince(since: string | null | undefined, today: string): number | null {
  if (!since) return null;
  const from = Date.parse(`${since}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export const SAFETY_ACTION_AGE_BUCKETS = [
  { key: '0_7', label: '0–7 days', max: 7 },
  { key: '8_30', label: '8–30 days', max: 30 },
  { key: '31_90', label: '31–90 days', max: 90 },
  { key: '90_plus', label: 'Over 90 days', max: Number.POSITIVE_INFINITY },
] as const;
export type SafetyActionAgeKey = (typeof SAFETY_ACTION_AGE_BUCKETS)[number]['key'];

export interface SafetyActionAges {
  buckets: Record<SafetyActionAgeKey, number>;
  open: number;
  /** Open past their due date. */
  overdue: number;
}

/**
 * Open corrective and preventive actions by how long they have been open, and how many are late.
 * An action is aged from when it was raised (its created date on the company's clock), not its due
 * date: "open for 40 days" is what tells an owner nobody owns it.
 */
export function safetyOpenActionAges(
  actions: ReadonlyArray<{ status: string; raisedOn: string; dueOn: string | null }>,
  today: string,
): SafetyActionAges {
  const buckets = { '0_7': 0, '8_30': 0, '31_90': 0, '90_plus': 0 } as Record<SafetyActionAgeKey, number>;
  let open = 0;
  let overdue = 0;
  for (const action of actions) {
    if (action.status !== 'open') continue;
    open += 1;
    const age = safetyDaysSince(action.raisedOn, today) ?? 0;
    const bucket = SAFETY_ACTION_AGE_BUCKETS.find((entry) => age <= entry.max)!;
    buckets[bucket.key] += 1;
    if (action.dueOn && action.dueOn < today) overdue += 1;
  }
  return { buckets, open, overdue };
}

/** Counts by a key, every known key present (zero when absent) so a chart's bars never move. */
export function safetyCountBy<K extends string>(
  keys: readonly K[],
  values: readonly string[],
): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) {
    if (value in counts) counts[value as K] += 1;
  }
  return counts;
}

/**
 * Toolbox-talk coverage: the share of the people on the roll this week who attended at least one
 * talk. Null when nobody was on the roll, so an idle site does not show as 0%.
 */
export function safetyCoverage(attended: number, onRoll: number): number | null {
  if (onRoll <= 0) return null;
  return Math.round((Math.min(attended, onRoll) / onRoll) * 100);
}

// --- quick capture -----------------------------------------------------------------------------------

export interface SafetySuggestion {
  type: SafetyObservationType;
  category: SafetyCategory;
  severity: SafetySeverity;
}

/**
 * Words that point at a category. Checked in order, so the more specific hazards (a harness, a
 * trench) win over the general ones (a helmet mentioned in passing). English plus the site words a
 * transcript of Hindi or Tamil speech usually comes back with.
 */
const CATEGORY_WORDS: ReadonlyArray<[SafetyCategory, RegExp]> = [
  ['scaffolding', /\bscaff|\bcoupler|\bstanding|\bledger board|\bplank/i],
  ['work_at_height', /\bharness|\bheight|\bfall|\bladder|\broof|\bedge|\bopening|\blanyard/i],
  ['excavation', /\bexcavat|\btrench|\bpit\b|\bdig|\bshoring|\bcollapse/i],
  ['lifting', /\bcrane|\blift|\bsling|\bhoist|\brigging|\bload\b|\bshackle/i],
  ['electrical', /\belectric|\bcable|\bwire|\bshock|\bdb\b|\bsocket|\belcb|\brcd|\bpanel|\blive\b/i],
  ['fire', /\bfire|\bweld|\bspark|\bgas cylinder|\bextinguish|\bhot work|\bburn/i],
  ['vehicles_traffic', /\bvehicle|\btruck|\btipper|\bjcb|\bexcavator|\breversing|\bforklift|\btraffic|\bdumper/i],
  ['chemicals', /\bchemical|\bspill|\bdiesel|\bpaint|\bsolvent|\bacid|\bcuring compound|\boil leak/i],
  ['tools_equipment', /\bgrinder|\bdrill|\btool|\bguard|\bmachine|\bcutter|\bmixer|\bvibrator/i],
  ['ppe', /\bppe\b|\bhelmet|\bhard ?hat|\bboots?\b|\bgloves?\b|\bgoggles|\bvest|\bmask|\bear ?plug/i],
  ['housekeeping', /\bhousekeep|\bdebris|\brubbish|\bwaste|\bclutter|\btrip|\bslip|\bnail|\bmess|\bblocked/i],
];

const POSITIVE_WORDS = /\b(good|well done|great|excellent|correctly|properly|proper|safe practice|appreciat|commend)/i;
const ACT_WORDS = /\b(not wearing|without|no (helmet|harness|gloves|boots|ppe)|removed|ignored|bypass|standing on|climbing|running|throwing|smoking|on (his|her|the) phone|worker|labour|operator|someone|person)\b/i;
const CRITICAL_WORDS = /\b(collapse|electrocut|fatal|crush|fell|fall from|unconscious|live wire|exposed live|no edge protection|gas leak|trapped)\b/i;
const HIGH_WORDS = /\b(height|harness|trench|excavat|crane|lift|live|electric|scaffold|fire|weld|roof|edge|opening)\b/i;

/**
 * A first guess at what an observation is, from the note somebody typed or said.
 *
 * The no-AI path, and the fallback when the model is down: a keyword match nobody has to pay for,
 * good enough to pre-fill a form that a person then confirms. It never decides anything on its own —
 * the person reporting can change every field before it is saved.
 */
export function safetySuggestFromNote(note: string): SafetySuggestion {
  const text = note.trim();
  const category = CATEGORY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';

  if (POSITIVE_WORDS.test(text) && !/\b(not|no|without|never)\b/i.test(text)) {
    return { type: 'positive', category, severity: 'low' };
  }

  const type: SafetyObservationType = ACT_WORDS.test(text) ? 'unsafe_act' : 'unsafe_condition';
  const severity: SafetySeverity = CRITICAL_WORDS.test(text)
    ? 'critical'
    : HIGH_WORDS.test(text)
      ? 'high'
      : category === 'other' || category === 'housekeeping'
        ? 'low'
        : 'medium';
  return { type, category, severity };
}

// --- numbering ---------------------------------------------------------------------------------------

/** `INC-0007`, `PTW-0012`, `OBS-0003`: numbered per company, padded so they sort as text. */
export function safetyNumber(prefix: 'INC' | 'PTW' | 'OBS', value: number): string {
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
