import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  ASK_METRICS,
  ASK_PERIODS,
  askIntentSchema,
  attendanceEarning,
  isoDateToUtcDate,
  quantityToThousandths,
  thousandthsToQuantity,
  todayInIst,
  type AskIntent,
  type AskResult,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import type { RequestUser } from '../../common/auth/request-user';
import { describePeriod, resolvePeriod } from './ask-periods';

/**
 * Answering a question about a builder's own numbers.
 *
 * The division of labour is the whole design, and it is deliberately lopsided:
 *
 * - **The model reads the question.** It turns "how much on steel at Lakeview last month" into a
 *   metric name, a site word, a subject word and a period keyword. That is all it does. It never
 *   sees a row, never writes a query, and never produces a figure.
 * - **This file answers it.** The site word is matched against the tenant's real sites, the period
 *   keyword becomes two dates, the figure is computed with Prisma under the caller's own project
 *   scope, and the sentence is a template with that figure in it.
 *
 * A model asked to query a database will eventually return a plausible total, and a plausible total
 * in a construction ledger is worse than no answer — somebody acts on it. This way the worst case
 * is a misread question, which the answer shows back ("Expenses · Lakeview Tower · September") so
 * it is visible rather than silent.
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);
  private readonly config = env();
  private client?: OpenAI;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  async ask(actor: RequestUser, question: string): Promise<AskResult> {
    if (!this.enabled) {
      throw ApiError.conflict('Asking questions is not configured on this deployment');
    }

    const today = todayInIst();
    const db = this.tenantDb.clientFor(actor.tenantId);

    // The sites this person may see, by name, so the model's "Lakeview" can become an id — and so
    // a site they have no access to cannot be named into an answer.
    const projects = await db.project.findMany({
      where: { deletedAt: null, ...this.access.scopeFilter(actor) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const intent = await this.readQuestion(question, projects.map((p) => p.name));
    const site = intent.project ? matchByName(intent.project, projects) : null;
    const range = resolvePeriod(intent.period, today);

    const caveat =
      intent.project && !site
        ? `No site here is called "${intent.project}", so this covers every site.`
        : null;

    return this.compute(actor, intent, site, range, caveat, today);
  }

  /** The one model call. Its answer is validated into `AskIntent` or the question is refused. */
  private async readQuestion(question: string, siteNames: string[]): Promise<AskIntent> {
    let raw: string;
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_ASK_MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(siteNames) },
          { role: 'user', content: question },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.warn({ err: error }, 'Ask failed at the vendor');
      throw ApiError.conflict('Could not read that question. Try asking it another way.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw ApiError.conflict('Could not read that question. Try asking it another way.');
    }

    const intent = askIntentSchema.safeParse(parsed);
    if (!intent.success) {
      this.logger.warn({ issues: intent.error.issues, raw }, 'Ask returned an unusable intent');
      throw ApiError.conflict(
        'That is not something I can look up yet. Try asking about spend, wages, headcount, materials, approvals or reports.',
      );
    }
    return intent.data;
  }

  /** Every metric, computed from rows. No model involved past this point. */
  private async compute(
    actor: RequestUser,
    intent: AskIntent,
    site: { id: string; name: string } | null,
    range: { from: string; to: string },
    caveat: string | null,
    today: string,
  ): Promise<AskResult> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const scope = site ? { projectId: site.id } : this.access.scopeFilterByProjectId(actor);
    const where = { from: isoDateToUtcDate(range.from), to: isoDateToUtcDate(range.to) };
    const when = describePeriod(intent.period, range);
    const place = site ? ` at ${site.name}` : '';

    const understood = {
      metric: intent.metric,
      project: site?.name ?? null,
      subject: intent.subject,
      period: when,
      from: range.from,
      to: range.to,
    };

    switch (intent.metric) {
      case 'expense_total': {
        const category = matchCategory(intent.subject);
        const rows = await db.expense.findMany({
          where: {
            deletedAt: null,
            ...scope,
            spentOn: { gte: where.from, lte: where.to },
            ...(category ? { category: category as never } : {}),
          },
          select: { amount: true },
        });
        const total = rows.reduce((sum, row) => sum + row.amount, 0n);
        const what = category ? `${category.replace(/_/g, ' ')} expenses` : 'expenses';
        return {
          answer: `${formatInr(total)} on ${what}${place} ${when}, across ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}.`,
          value: total.toString(),
          unit: 'paise',
          understood,
          href: '/expenses',
          caveat:
            caveat ??
            (intent.subject && !category
              ? `"${intent.subject}" is not an expense category, so this is every category.`
              : null),
        };
      }

      case 'labour_cost': {
        const rows = await db.attendance.findMany({
          where: { ...scope, attendanceDate: { gte: where.from, lte: where.to } },
          select: {
            status: true,
            overtimeHours: true,
            wageSnapshot: true,
            overtimeRateSnapshot: true,
          },
        });
        const total = rows.reduce(
          (sum, row) =>
            sum +
            attendanceEarning({
              status: row.status,
              overtimeHours: row.overtimeHours.toString(),
              wageSnapshot: row.wageSnapshot,
              overtimeRateSnapshot: row.overtimeRateSnapshot,
            }).totalPaise,
          0n,
        );
        return {
          answer: `${formatInr(total)} of wages earned${place} ${when}, from ${rows.length} ${rows.length === 1 ? 'day' : 'days'} of attendance.`,
          value: total.toString(),
          unit: 'paise',
          understood,
          href: '/labour/attendance',
          caveat,
        };
      }

      case 'headcount': {
        const rows = await db.attendance.count({
          where: {
            ...scope,
            attendanceDate: { gte: where.from, lte: where.to },
            status: { not: 'absent' },
          },
        });
        return {
          answer: `${rows} man-${rows === 1 ? 'day' : 'days'}${place} ${when}.`,
          value: String(rows),
          unit: 'man-days',
          understood,
          href: '/labour/attendance',
          caveat,
        };
      }

      case 'material_consumed': {
        const material = intent.subject
          ? await db.material.findFirst({
              where: { deletedAt: null, name: { contains: intent.subject, mode: 'insensitive' } },
              select: { id: true, name: true, unit: true },
            })
          : null;

        if (intent.subject && !material) {
          return {
            answer: `No material here is called "${intent.subject}".`,
            value: '0',
            unit: '',
            understood,
            href: '/stock',
            caveat: null,
          };
        }

        const rows = await db.stockMovement.findMany({
          where: {
            deletedAt: null,
            ...scope,
            type: 'out',
            movedOn: { gte: where.from, lte: where.to },
            ...(material ? { materialId: material.id } : {}),
          },
          select: { quantity: true },
        });
        const total = rows.reduce(
          (sum, row) => sum + quantityToThousandths(row.quantity.toString()),
          0n,
        );
        const what = material ? `${material.name}` : 'material';
        const unit = material?.unit ?? '';
        return {
          // "Consumed", not "bought": what was issued to the work, which is the number somebody
          // means when they ask how much a slab took.
          answer: `${thousandthsToQuantity(total)} ${unit} of ${what} consumed${place} ${when}.`.replace(
            /\s+/g,
            ' ',
          ),
          value: thousandthsToQuantity(total),
          unit,
          understood,
          href: '/stock',
          caveat,
        };
      }

      case 'indents_pending': {
        const rows = await db.materialIndent.count({
          where: { deletedAt: null, ...scope, status: 'requested' },
        });
        return {
          // Deliberately not filtered by period: "waiting" is a state today, and an indent raised
          // in August that nobody has answered is exactly the one being asked about.
          answer: `${rows} ${rows === 1 ? 'indent is' : 'indents are'} waiting on a decision${place}.`,
          value: String(rows),
          unit: 'count',
          understood: { ...understood, period: 'right now', from: today, to: today },
          href: '/indents',
          caveat,
        };
      }

      case 'reports_filed': {
        const rows = await db.dailyReport.count({
          where: {
            deletedAt: null,
            ...scope,
            status: 'submitted',
            reportDate: { gte: where.from, lte: where.to },
          },
        });
        return {
          answer: `${rows} daily ${rows === 1 ? 'report' : 'reports'} filed${place} ${when}.`,
          value: String(rows),
          unit: 'count',
          understood,
          href: '/projects',
          caveat,
        };
      }
    }
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}

/** Rupees from paise, the way the answer should read it. */
function formatInr(paise: bigint): string {
  const rupees = paise / 100n;
  const paisePart = (paise % 100n).toString().padStart(2, '0');
  return `₹${new Intl.NumberFormat('en-IN').format(rupees)}.${paisePart}`;
}

/**
 * The site a person meant.
 *
 * Exact first, then "starts with", then "contains" — somebody typing "Lakeview" for "Lakeview
 * Tower" is the common case, and a fuzzy distance metric would occasionally pick a different site
 * with a similar name, which is a wrong answer wearing a confident face. No match returns null and
 * the caller says so.
 */
function matchByName<T extends { name: string }>(needle: string, rows: T[]): T | null {
  const query = needle.trim().toLowerCase();
  if (!query) return null;
  return (
    rows.find((row) => row.name.toLowerCase() === query) ??
    rows.find((row) => row.name.toLowerCase().startsWith(query)) ??
    rows.find((row) => row.name.toLowerCase().includes(query)) ??
    null
  );
}

/** An expense category, if the subject names one. "steel" does not — that is a material. */
function matchCategory(subject: string | null): string | null {
  if (!subject) return null;
  const query = subject.trim().toLowerCase().replace(/\s+/g, '_');
  const categories = [
    'materials',
    'transport',
    'fuel',
    'equipment_hire',
    'tools',
    'site_office',
    'utilities',
    'food',
    'permits',
    'repairs',
    'other',
  ];
  return categories.find((category) => category === query || category.startsWith(query)) ?? null;
}

function systemPrompt(siteNames: string[]): string {
  return `You turn a construction manager's question into a lookup. Return JSON and nothing else.

Keys:
  metric  - one of: ${ASK_METRICS.join(', ')}
  project - the site they named, copied as they said it, or null for all sites.${
    siteNames.length > 0 ? ` The sites are: ${siteNames.join('; ')}.` : ''
  }
  subject - what within the metric: an expense category for expense_total, a material for material_consumed. null otherwise.
  period  - one of: ${ASK_PERIODS.join(', ')}

Which metric:
  expense_total     money spent on expenses — materials bought, lorry hire, diesel, repairs
  labour_cost       wages earned by workers
  headcount         how many people worked, in man-days
  material_consumed how much of a material was used on the work
  indents_pending   material requests waiting for approval
  reports_filed     daily progress reports submitted

"last week" and "this week" both mean last_7_days. Use previous_7_days only for an explicit
comparison with the week before that. Use all_time when no period is mentioned. Never invent a site that is not in the list; if they name
something else, copy what they said and let the server decide.`;
}
