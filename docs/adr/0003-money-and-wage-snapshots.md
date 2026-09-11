# ADR 0003 — Money is bigint paise, and wage rates are frozen onto attendance

Status: accepted
Date: 2026-09-09

## Context

SiteBook computes what a builder owes real people in cash, weekly, and the wage
sheet is printed and signed at the site. Two ways to get that wrong:

1. Floating point. `0.1 + 0.2` is the classic example; the version that actually
   bites is a week of 6.5-day wage lines that sum to a rupee off the cash handed out.
2. Rates that move. A worker's `daily_wage` is edited — a raise, or a correction — and
   last month's attendance silently revalues. The builder's books no longer match
   what was paid.

## Decision

**Money is an integer count of paise in a `bigint`.** In Postgres that is `BIGINT`,
in TypeScript `bigint`, in Prisma `BigInt`. No `Float`, no `Decimal`, no `number`.

On the wire it is a decimal **string**: `"65000"` is ₹650.00. A JSON number would be
a `double` in every client, which silently loses paise above 2^53 and invites float
arithmetic on the other side. `apps/api/src/main.ts` installs an Express `json
replacer` that serialises every bigint this way, so no DTO has to remember.

Arithmetic lives in `packages/shared/src/money.ts` and `earnings.ts` — shared so the
API, the nightly rollup job and the Flutter app's offline preview cannot disagree.
Two rounding rules are deliberate:

- A half day is `wage / 2n`, which truncates. Two halves therefore never sum to more
  than a full day. Rounding up would let the builder pay 1 paise more than the daily
  wage for a split shift, and the wage sheet would not tie out.
- Overtime is computed in tenths of an hour (`numeric(4,1)` in the database, a
  one-decimal string on the wire) and multiplied before dividing:
  `(tenths * ratePerHour) / 10n`. Dividing first would throw away the fraction.

**Rates are snapshotted onto the attendance row.** `attendance.wage_snapshot` and
`attendance.overtime_rate_snapshot` are copied from the worker at record time, and
every earnings calculation reads the snapshot, never the worker's current rate.

The spec names only `wage_snapshot`. We added `overtime_rate_snapshot` because the
same argument applies to it exactly: "changing a wage does not alter past
attendance" is not true if the overtime rate can still move underneath a recorded
1.5 hours.

## Consequences

- A wage correction for a past date is a `bonus` or `deduction` row in the next
  period (spec §8A), not an edit to history. The API blocks backdated edits after
  payment.
- Reports can recompute any past period and get the same number they got the first
  time, which is what makes the printed wage sheet defensible.
- Clients must not parse money into a float. `formatInr` / `formatPaise` in
  `@sitebook/shared` handle display, including Indian lakh/crore grouping.
- `netPayable` floors at zero: when advances exceed a thin week's gross, the
  uncovered remainder stays outstanding rather than becoming a negative payment.
