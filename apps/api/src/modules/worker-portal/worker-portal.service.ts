import { Injectable } from '@nestjs/common';
import { attendanceEarning, utcDateToIsoDate } from '@sitebook/shared';
import { oneDecimal } from '../../common/decimal';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ApiError } from '../../common/errors/api-error';
import { TokenService } from '../../common/auth/token.service';

/**
 * What a worker sees about themselves (spec §3 item 15).
 *
 * No account, no password, no app. A mason is handed a link on WhatsApp by the site office and it
 * opens a page showing the days they were marked present and the money they have drawn against
 * them. That is the whole feature, and its value is entirely in the argument it prevents: "I worked
 * twenty-two days", "we have you down for nineteen" — settled by both of them looking at the same
 * list instead of two memories.
 *
 * Three properties this has to hold, because the reader is unauthenticated:
 *
 *   * **One person only.** Every query is filtered by the worker id inside the token. There is no
 *     parameter a reader could change, because there is nothing to change — the id is signed.
 *   * **Nothing the worker should not see.** Not the site budget, not another worker's wage, not
 *     the contractor's bill. Their own attendance and their own payments.
 *   * **It stops working.** The token expires, and a worker removed from the books or a tenant
 *     suspended is refused before any data is read.
 */
@Injectable()
export class WorkerPortalService {
  constructor(
    private readonly tokens: TokenService,
    private readonly tenantDb: TenantDb,
  ) {}

  async summary(token: string) {
    const claims = this.tokens.verifyWorkerLink(token);
    const db = this.tenantDb.clientFor(claims.tenantId);

    // Checked before anything is read, and checked together: a suspended builder's workers should
    // not keep browsing a link after the account stopped being paid for.
    const [tenant, worker] = await Promise.all([
      db.tenant.findUnique({
        where: { id: claims.tenantId },
        select: { name: true, status: true, logoUrl: true },
      }),
      db.worker.findFirst({
        where: { id: claims.workerId, deletedAt: null },
        select: {
          id: true,
          name: true,
          trade: true,
          dailyWage: true,
          status: true,
          contractor: { select: { name: true } },
        },
      }),
    ]);

    if (!tenant || tenant.status !== 'active') throw ApiError.notFound('This link is not active');
    if (!worker) throw ApiError.notFound('This link is not active');

    // Ninety days. A worker asking about their money is asking about this month or last; a year of
    // rows would be slower to load on a cheap phone and no easier to argue from.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [attendance, payments] = await Promise.all([
      db.attendance.findMany({
        where: { workerId: worker.id, attendanceDate: { gte: since } },
        select: {
          id: true,
          attendanceDate: true,
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
          project: { select: { name: true } },
        },
        orderBy: { attendanceDate: 'desc' },
      }),
      db.labourPayment.findMany({
        where: { workerId: worker.id, deletedAt: null, paidOn: { gte: since } },
        select: { id: true, paidOn: true, type: true, amount: true, mode: true },
        orderBy: { paidOn: 'desc' },
      }),
    ]);

    let earned = 0n;
    let present = 0;
    let halfDays = 0;

    const days = attendance.map((row) => {
      // The same function the wage sheet runs on, not a second implementation of it. A worker
      // shown a number that disagrees with the one they are paid from would be worse than showing
      // them nothing at all.
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });
      earned += earning.totalPaise;
      if (row.status === 'present') present += 1;
      if (row.status === 'half_day') halfDays += 1;

      return {
        date: utcDateToIsoDate(row.attendanceDate),
        status: row.status,
        site: row.project.name,
        overtime_hours: oneDecimal(row.overtimeHours),
        earned: earning.totalPaise.toString(),
      };
    });

    let drawn = 0n;
    for (const payment of payments) {
      // Bonus is money owed to them, not money taken off what they are owed.
      if (payment.type === 'bonus') earned += payment.amount;
      else drawn += payment.amount;
    }

    return {
      company: { name: tenant.name, logo_url: tenant.logoUrl },
      worker: {
        name: worker.name,
        trade: worker.trade,
        contractor: worker.contractor?.name ?? null,
        daily_wage: worker.dailyWage.toString(),
        status: worker.status,
      },
      totals: {
        since: utcDateToIsoDate(since),
        days_present: present,
        half_days: halfDays,
        earned: earned.toString(),
        drawn: drawn.toString(),
        // Can be negative when somebody has drawn more than they have worked so far this period,
        // which is normal on an advance and should be shown as it is rather than floored at zero.
        balance: (earned - drawn).toString(),
      },
      days,
      payments: payments.map((payment) => ({
        date: utcDateToIsoDate(payment.paidOn),
        type: payment.type,
        mode: payment.mode,
        amount: payment.amount.toString(),
      })),
    };
  }
}
