import { Injectable } from '@nestjs/common';
import {
  attendanceEarning,
  isoDateToUtcDate,
  outstandingBalance,
  utcDateToIsoDate,
  type AssignWorkerInput,
  type CreateWorkerInput,
  type ListWorkersQuery,
  type Page,
  type UpdateWorkerInput,
} from '@sitebook/shared';
import type { Prisma } from '@prisma/client';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TokenService } from '../../common/auth/token.service';
import { env } from '../../config/env';
import { oneDecimal } from '../../common/decimal';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

export interface WorkerView {
  id: string;
  name: string;
  phone: string | null;
  trade: string | null;
  skill_level: string;
  status: string;
  contractor_id: string | null;
  contractor_name: string | null;
  daily_wage: bigint;
  overtime_rate_per_hour: bigint;
  photo_s3_key: string | null;
  client_id: string | null;
}

const SELECT = {
  id: true,
  name: true,
  phone: true,
  trade: true,
  skillLevel: true,
  status: true,
  contractorId: true,
  dailyWage: true,
  overtimeRatePerHour: true,
  photoS3Key: true,
  clientId: true,
  contractor: { select: { name: true } },
} as const;

@Injectable()
export class WorkersService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly tokens: TokenService,
  ) {}

  async list(actor: RequestUser, query: ListWorkersQuery): Promise<Page<WorkerView>> {
    // A supervisor may only see the roster of sites they are on. Without a
    // project filter their view is the union of their own sites.
    const projectScope = query.project_id
      ? [query.project_id]
      : actor.seesAllProjects
        ? null
        : actor.projectIds;

    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const onDate = query.on_date ? isoDateToUtcDate(query.on_date) : null;
    const assignmentFilter: Prisma.WorkerProjectListRelationFilter | undefined =
      projectScope === null
        ? undefined
        : {
            some: {
              projectId: { in: projectScope },
              // Assignment windows are half-open: a worker counts on `from_date`
              // and on every day up to and including `to_date`.
              ...(onDate
                ? {
                    fromDate: { lte: onDate },
                    OR: [{ toDate: null }, { toDate: { gte: onDate } }],
                  }
                : {}),
            },
          };

    const rows = await this.tenantDb.clientFor(actor.tenantId).worker.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.contractor_id ? { contractorId: query.contractor_id } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
        ...(assignmentFilter ? { workerProjects: assignmentFilter } : {}),
      },
      select: SELECT,
      // Grouped by contractor then name: the order the roll call renders in.
      orderBy: [{ contractorId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    });

    return toPage(rows, query.limit, toView);
  }

  async get(actor: RequestUser, id: string): Promise<WorkerView> {
    const worker = await this.tenantDb
      .clientFor(actor.tenantId)
      .worker.findFirst({ where: { id, deletedAt: null }, select: SELECT });
    if (!worker) throw ApiError.notFound('Worker');
    return toView(worker);
  }

  /**
   * Creating a worker is idempotent on `client_id` (spec §8): a supervisor adds
   * someone on site with no signal, the outbox retries, and the retry must not
   * produce a second person on the wage sheet.
   */
  async create(actor: RequestUser, input: CreateWorkerInput): Promise<WorkerView> {
    if (input.project_id) await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.worker.findFirst({
          where: { clientId: input.client_id },
          select: SELECT,
        });
        if (existing) return toView(existing);
      }

      await this.assertContractor(tx, input.contractor_id ?? null);

      const worker = await tx.worker.create({
        data: {
          tenantId: actor.tenantId,
          name: input.name,
          phone: input.phone,
          trade: input.trade,
          contractorId: input.contractor_id ?? null,
          skillLevel: input.skill_level,
          dailyWage: input.daily_wage,
          overtimeRatePerHour: input.overtime_rate_per_hour,
          idProofS3Key: input.id_proof_s3_key,
          photoS3Key: input.photo_s3_key,
          clientId: input.client_id,
        },
        select: SELECT,
      });

      if (input.project_id) {
        await tx.workerProject.create({
          data: {
            tenantId: actor.tenantId,
            workerId: worker.id,
            projectId: input.project_id,
            fromDate: isoDateToUtcDate(input.from_date ?? utcDateToIsoDate(new Date())),
          },
        });
      }

      return toView(worker);
    });
  }

  /**
   * A wage change takes effect from today forward only. Past attendance keeps the
   * rate frozen on its own row, so nothing already earned moves (ADR 0003).
   */
  async update(actor: RequestUser, id: string, input: UpdateWorkerInput): Promise<WorkerView> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.worker.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw ApiError.notFound('Worker');

      if (input.contractor_id !== undefined) {
        await this.assertContractor(tx, input.contractor_id);
      }

      const worker = await tx.worker.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.trade === undefined ? {} : { trade: input.trade }),
          ...(input.contractor_id === undefined ? {} : { contractorId: input.contractor_id }),
          ...(input.skill_level === undefined ? {} : { skillLevel: input.skill_level }),
          ...(input.daily_wage === undefined ? {} : { dailyWage: input.daily_wage }),
          ...(input.overtime_rate_per_hour === undefined
            ? {}
            : { overtimeRatePerHour: input.overtime_rate_per_hour }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.id_proof_s3_key === undefined ? {} : { idProofS3Key: input.id_proof_s3_key }),
          ...(input.photo_s3_key === undefined ? {} : { photoS3Key: input.photo_s3_key }),
        },
        select: SELECT,
      });
      return toView(worker);
    });
  }

  /**
   * Soft delete a worker (spec §7).
   *
   * Refused while money is still owed. A worker sitting on an unpaid wage line is
   * someone who has worked and not been paid; removing the row would drop them off
   * the wage sheet and the debt would vanish without anyone deciding to cancel it.
   * Settle or discard the period first.
   *
   * This is not the same as taking someone off the rolls — that is `status:
   * 'inactive'`, which keeps every past wage sheet intact and is what you want for a
   * worker who has simply left. Deleting is for a row entered by mistake.
   */
  async archive(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const worker = await db.worker.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!worker) throw ApiError.notFound('Worker');

    const unpaid = await db.wageLine.findFirst({
      where: {
        workerId: id,
        wagePeriod: { status: { in: ['open', 'finalised'] } },
      },
      select: { wagePeriod: { select: { periodStart: true, periodEnd: true, status: true } } },
    });
    if (unpaid) {
      throw ApiError.conflict(
        `${worker.name} is on an unpaid wage sheet and cannot be deleted. Mark them inactive instead, or settle the period first.`,
        {
          period_start: utcDateToIsoDate(unpaid.wagePeriod.periodStart),
          period_end: utcDateToIsoDate(unpaid.wagePeriod.periodEnd),
          period_status: unpaid.wagePeriod.status,
        },
      );
    }

    await db.worker.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async assign(actor: RequestUser, workerId: string, input: AssignWorkerInput) {
    await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const worker = await tx.worker.findFirst({
        where: { id: workerId, deletedAt: null },
        select: { id: true },
      });
      if (!worker) throw ApiError.notFound('Worker');

      const assignment = await tx.workerProject.upsert({
        where: {
          workerId_projectId_fromDate: {
            workerId,
            projectId: input.project_id,
            fromDate: isoDateToUtcDate(input.from_date),
          },
        },
        create: {
          tenantId: actor.tenantId,
          workerId,
          projectId: input.project_id,
          fromDate: isoDateToUtcDate(input.from_date),
          toDate: input.to_date ? isoDateToUtcDate(input.to_date) : null,
        },
        update: { toDate: input.to_date ? isoDateToUtcDate(input.to_date) : null },
        select: { id: true, projectId: true, fromDate: true, toDate: true },
      });

      return {
        id: assignment.id,
        project_id: assignment.projectId,
        from_date: utcDateToIsoDate(assignment.fromDate),
        to_date: assignment.toDate ? utcDateToIsoDate(assignment.toDate) : null,
      };
    });
  }

  /**
   * Worker ledger (spec §8A): attendance and payments in one chronological list with
   * a running balance, which is the answer to "what do I owe this person today".
   */
  /**
   * A signed link for one worker, plus when it stops working.
   *
   * The worker is looked up first so that an id belonging to another tenant, or to somebody
   * already removed, cannot be turned into a working link — the token is only as careful as what
   * is put in it.
   *
   * `WEB_BASE_URL` is where the page lives. Left unset the API returns the path alone, which is
   * still usable: the site office pastes it after their own domain, and a half-built deployment
   * fails visibly rather than minting links to nowhere.
   */
  async selfServiceLink(actor: RequestUser, workerId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const worker = await db.worker.findFirst({
      where: { id: workerId, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });
    if (!worker) throw ApiError.notFound('Worker');

    const token = this.tokens.signWorkerLink({ tenantId: actor.tenantId, workerId: worker.id });
    const base = env().WEB_BASE_URL?.replace(/\/$/, '') ?? '';

    return {
      worker: { id: worker.id, name: worker.name, phone: worker.phone },
      url: `${base}/w/${token}`,
      expires_in: this.tokens.workerLinkTtlSeconds,
    };
  }

  async ledger(actor: RequestUser, workerId: string, range?: { from?: string; to?: string }) {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const worker = await db.worker.findFirst({
      where: { id: workerId, deletedAt: null },
      select: SELECT,
    });
    if (!worker) throw ApiError.notFound('Worker');

    const dateFilter = {
      ...(range?.from ? { gte: isoDateToUtcDate(range.from) } : {}),
      ...(range?.to ? { lte: isoDateToUtcDate(range.to) } : {}),
    };
    const hasRange = Object.keys(dateFilter).length > 0;

    const [attendance, payments] = await Promise.all([
      db.attendance.findMany({
        where: { workerId, ...(hasRange ? { attendanceDate: dateFilter } : {}) },
        select: {
          id: true,
          attendanceDate: true,
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { attendanceDate: 'asc' },
      }),
      db.labourPayment.findMany({
        where: { workerId, deletedAt: null, ...(hasRange ? { paidOn: dateFilter } : {}) },
        select: {
          id: true,
          paidOn: true,
          type: true,
          amount: true,
          mode: true,
          reference: true,
          note: true,
        },
        orderBy: { paidOn: 'asc' },
      }),
    ]);

    type Entry = {
      id: string;
      date: string;
      kind: 'attendance' | 'payment';
      label: string;
      earned: bigint;
      paid: bigint;
      detail: Record<string, unknown>;
    };

    const entries: Entry[] = [];

    for (const row of attendance) {
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });
      entries.push({
        id: row.id,
        date: utcDateToIsoDate(row.attendanceDate),
        kind: 'attendance',
        label: `${row.status.replace('_', ' ')} · ${row.project.name}`,
        earned: earning.totalPaise,
        paid: 0n,
        detail: {
          status: row.status,
          overtime_hours: oneDecimal(row.overtimeHours),
          base: earning.basePaise,
          overtime: earning.overtimePaise,
          project_id: row.project.id,
        },
      });
    }

    for (const row of payments) {
      // Bonus is money owed, so it lands on the earned side; everything else
      // reduces the balance.
      const isBonus = row.type === 'bonus';
      entries.push({
        id: row.id,
        date: utcDateToIsoDate(row.paidOn),
        kind: 'payment',
        label: row.type,
        earned: isBonus ? row.amount : 0n,
        paid: isBonus ? 0n : row.amount,
        detail: { type: row.type, mode: row.mode, reference: row.reference, note: row.note },
      });
    }

    entries.sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? -1 : 1));

    let running = 0n;
    const timeline = entries.map((entry) => {
      running += entry.earned - entry.paid;
      return {
        id: entry.id,
        date: entry.date,
        kind: entry.kind,
        label: entry.label,
        earned: entry.earned,
        paid: entry.paid,
        balance: running,
        detail: entry.detail,
      };
    });

    return {
      worker: toView(worker),
      outstanding: outstandingBalance(
        entries.map((e) => ({ earnedPaise: e.earned, paidPaise: e.paid })),
      ),
      total_earned: entries.reduce((sum, e) => sum + e.earned, 0n),
      total_paid: entries.reduce((sum, e) => sum + e.paid, 0n),
      entries: timeline,
    };
  }

  private async assertContractor(tx: TenantTx, contractorId: string | null): Promise<void> {
    if (!contractorId) return;
    const contractor = await tx.contractor.findFirst({
      where: { id: contractorId, deletedAt: null },
      select: { id: true },
    });
    if (!contractor) throw ApiError.notFound('Contractor');
  }
}

function toView(row: {
  id: string;
  name: string;
  phone: string | null;
  trade: string | null;
  skillLevel: string;
  status: string;
  contractorId: string | null;
  dailyWage: bigint;
  overtimeRatePerHour: bigint;
  photoS3Key: string | null;
  clientId: string | null;
  contractor: { name: string } | null;
}): WorkerView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    trade: row.trade,
    skill_level: row.skillLevel,
    status: row.status,
    contractor_id: row.contractorId,
    contractor_name: row.contractor?.name ?? null,
    daily_wage: row.dailyWage,
    overtime_rate_per_hour: row.overtimeRatePerHour,
    photo_s3_key: row.photoS3Key,
    client_id: row.clientId,
  };
}
