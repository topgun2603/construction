import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_SYSTEM_LABELS,
  accountingBuildVouchers,
  accountingExportFiles,
  accountingExternalId,
  accountingMasterAccounts,
  accountingPartiesOf,
  accountingSiteCode,
  accountingTotalsByAccount,
  currencyMinorDigits,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type AccountingAccount,
  type AccountingCategory,
  type AccountingExportInput,
  type AccountingMasters,
  type AccountingParty,
  type AccountingSourceType,
  type AccountingVoucher,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { contractorParty, customerParty, loadAccountingSources, sourceDate, vendorParty } from './accounting-sources';
import { readAccountingMap, readAccountingSettings, type AccountingSettingsView } from './accounting-settings.service';

/** Most voucher rows a preview lists; the totals always cover all of them. */
const PREVIEW_ROWS = 500;

interface PriorExport {
  number: number;
  system: string;
  at: Date;
}

interface Built {
  settings: AccountingSettingsView;
  map: Record<string, AccountingAccount>;
  vouchers: AccountingVoucher[];
  missing: { key: string; label: string; example: string }[];
  /** Transactions left out because an earlier batch carried them. */
  skipped: { externalId: string; sourceType: AccountingSourceType; date: string; batch: PriorExport }[];
  /** The last batch each exported voucher went out in, when "include previously exported" is ticked. */
  prior: Map<string, PriorExport>;
  masters: AccountingMasters | null;
  /** Wage periods are company-wide: left out of an export of some sites only. */
  payrollLeftOut: boolean;
}

const sourceKey = (type: string, id: string) => `${type}:${id}`;

/**
 * Exports to the accounting system (Reports → Export to accounts).
 *
 * A preview and an export run the same steps: read the period's transactions, leave out what an
 * earlier batch already carried (unless asked not to), turn the rest into balanced vouchers through
 * the company's mapping, and lay them out in the chosen system's files. The export then refuses an
 * incomplete mapping with the list of what is missing, and otherwise records the batch — its files,
 * and a row per transaction — in one transaction under a per-company lock, so two people pressing
 * Export at once cannot both carry the same bill.
 */
@Injectable()
export class AccountingExportService {
  constructor(private readonly tenantDb: TenantDb) {}

  /** `POST /accounting/preview`. Writes nothing. */
  async preview(actor: RequestUser, input: AccountingExportInput) {
    const built = await this.tenantDb.transaction(actor.tenantId, (tx) => this.build(tx, actor, input));
    const digits = currencyMinorDigits(actor.currency);
    const totals = accountingTotalsByAccount(built.vouchers);
    return {
      system: input.system,
      system_label: ACCOUNTING_SYSTEM_LABELS[input.system],
      from: input.from,
      to: input.to,
      currency: actor.currency,
      digits,
      complete: built.missing.length === 0,
      missing: built.missing,
      counts: countsOf(built.vouchers),
      documents: documentsOf(built.vouchers),
      debit_total: totals.reduce((sum, row) => sum + row.debit, 0n).toString(),
      credit_total: totals.reduce((sum, row) => sum + row.credit, 0n).toString(),
      accounts: totals.map((row) => ({ key: row.key, code: row.code, name: row.name, debit: row.debit.toString(), credit: row.credit.toString() })),
      voucher_count: built.vouchers.length,
      vouchers: built.vouchers.slice(0, PREVIEW_ROWS).map((voucher) => presentVoucher(voucher, built.prior.get(sourceKey(voucher.sourceType, voucher.sourceId)))),
      skipped_count: built.skipped.length,
      skipped: built.skipped.slice(0, PREVIEW_ROWS).map((item) => ({
        external_id: item.externalId,
        source_type: item.sourceType,
        date: item.date,
        exported_in: presentPrior(item.batch),
      })),
      payroll_left_out: built.payrollLeftOut,
      masters: built.masters ? { parties: built.masters.parties.length, accounts: built.masters.accounts.length } : null,
    };
  }

  /** `POST /accounting/exports`. */
  async create(actor: RequestUser, input: AccountingExportInput) {
    const batchId = await this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        // One export at a time per company: the second waits, then sees what the first carried.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actor.tenantId}:accounting-export`}))`;
        const built = await this.build(tx, actor, input);
        if (built.missing.length > 0) {
          throw ApiError.conflict(
            `The account mapping for ${ACCOUNTING_SYSTEM_LABELS[input.system]} is incomplete: map ${built.missing.length === 1 ? 'this account' : `these ${built.missing.length} accounts`} in Settings → Accounting first.`,
            { missing: built.missing },
          );
        }
        if (built.vouchers.length === 0 && !built.masters) {
          throw ApiError.conflict(
            built.skipped.length > 0
              ? 'Everything in this period has already been exported. Tick "include previously exported" to export it again.'
              : 'There is nothing to export in this period.',
            { skipped: built.skipped.length },
          );
        }

        const digits = currencyMinorDigits(actor.currency);
        const files = accountingExportFiles({
          system: input.system,
          regime: actor.taxRegime,
          currency: actor.currency,
          digits,
          vouchers: built.vouchers,
          masters: built.masters,
          map: built.map,
          settings: {
            tallyCompany: built.settings.tally_company,
            qboSiteDimension: built.settings.qbo_site_dimension,
            xeroTrackingName: built.settings.xero_tracking_name,
            netsuiteSubsidiary: built.settings.netsuite_subsidiary,
            netsuiteSiteDimension: built.settings.netsuite_site_dimension,
          },
        });
        const totals = accountingTotalsByAccount(built.vouchers);
        const last = await tx.accountingExportBatch.aggregate({ _max: { number: true } });
        const number = (last._max.number ?? 0) + 1;
        const batch = await tx.accountingExportBatch.create({
          data: {
            tenantId: actor.tenantId,
            number,
            system: input.system,
            periodFrom: isoDateToUtcDate(input.from),
            periodTo: isoDateToUtcDate(input.to),
            projectIds: input.project_ids,
            include: ACCOUNTING_CATEGORIES.filter((category) => input.include.includes(category)),
            includeExported: input.include_exported,
            voucherCount: built.vouchers.length,
            summary: {
              counts: countsOf(built.vouchers),
              documents: documentsOf(built.vouchers),
              debit_total: totals.reduce((sum, row) => sum + row.debit, 0n).toString(),
              credit_total: totals.reduce((sum, row) => sum + row.credit, 0n).toString(),
              skipped: built.skipped.length,
              masters: built.masters ? { parties: built.masters.parties.length, accounts: built.masters.accounts.length } : null,
              currency: actor.currency,
            } satisfies Prisma.InputJsonObject,
            createdBy: actor.userId,
          },
          select: { id: true },
        });
        if (built.vouchers.length > 0) {
          await tx.accountingExportItem.createMany({
            data: built.vouchers.map((voucher) => ({
              tenantId: actor.tenantId,
              batchId: batch.id,
              sourceType: voucher.sourceType,
              sourceId: voucher.sourceId,
              externalId: voucher.externalId,
            })),
          });
        }
        const prefix = `batch-${String(number).padStart(4, '0')}`;
        await tx.accountingExportFile.createMany({
          data: files.map((file) => ({
            tenantId: actor.tenantId,
            batchId: batch.id,
            name: `${prefix}-${file.name}`,
            contentType: file.contentType,
            content: file.content,
            sizeBytes: Buffer.byteLength(file.content, 'utf8'),
          })),
        });
        return batch.id;
      },
      // A year of a busy company's transactions is a lot of rows to read and write.
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.get(actor, batchId);
  }

  /** `GET /accounting/exports`: the batch history, newest first. */
  async list(actor: RequestUser) {
    const batches = await this.tenantDb.clientFor(actor.tenantId).accountingExportBatch.findMany({
      orderBy: { number: 'desc' },
      take: 100,
      select: BATCH_SELECT,
    });
    return { items: batches.map(presentBatch) };
  }

  /** `GET /accounting/exports/:id`. */
  async get(actor: RequestUser, id: string) {
    const batch = await this.tenantDb.clientFor(actor.tenantId).accountingExportBatch.findUnique({ where: { id }, select: BATCH_SELECT });
    if (!batch) throw ApiError.notFound('Export');
    return presentBatch(batch);
  }

  /** `GET /accounting/exports/:id/files/:fileId`: the file exactly as it was first written. */
  async file(actor: RequestUser, batchId: string, fileId: string) {
    const file = await this.tenantDb.clientFor(actor.tenantId).accountingExportFile.findFirst({
      where: { id: fileId, batchId },
      select: { name: true, contentType: true, content: true },
    });
    if (!file) throw ApiError.notFound('File');
    return file;
  }

  private async build(tx: TenantTx, actor: RequestUser, input: AccountingExportInput): Promise<Built> {
    const projectIds = this.scopeProjects(actor, input.project_ids);
    const include = new Set<AccountingCategory>(input.include);
    const [settings, map] = await Promise.all([readAccountingSettings(tx), readAccountingMap(tx, input.system)]);

    const sources = await loadAccountingSources(tx, {
      from: input.from,
      to: input.to,
      projectIds,
      include,
      timezone: actor.timezone,
    });

    // The last batch each of these went out in, if any.
    const prior = new Map<string, PriorExport>();
    if (sources.length > 0) {
      const items = await tx.accountingExportItem.findMany({
        where: { sourceId: { in: sources.map((source) => source.id) } },
        select: { sourceType: true, sourceId: true, batch: { select: { number: true, system: true, createdAt: true } } },
      });
      for (const item of items) {
        const key = sourceKey(item.sourceType, item.sourceId);
        const current = prior.get(key);
        if (!current || current.number < item.batch.number) {
          prior.set(key, { number: item.batch.number, system: item.batch.system, at: item.batch.createdAt });
        }
      }
    }
    const skipped: Built['skipped'] = [];
    const fresh = sources.filter((source) => {
      const batch = prior.get(sourceKey(source.type, source.id));
      if (!batch || input.include_exported) return true;
      skipped.push({ externalId: accountingExternalId(source.type, source.id), sourceType: source.type, date: sourceDate(source), batch });
      return false;
    });

    // A site mapped to its own cost centre (or SAP project code) uses it; any other goes by its name.
    const costCentres: Record<string, AccountingAccount> = {};
    for (const [key, account] of Object.entries(map)) {
      if (key.startsWith('site:')) costCentres[key.slice(5)] = account;
    }
    const { vouchers, missing } = accountingBuildVouchers(fresh, {
      system: input.system,
      regime: actor.taxRegime,
      map,
      homeStateCode: settings.gst_home_state,
      costCentres,
    });

    const masters = include.has('masters') ? await this.masters(tx, vouchers, map, projectIds, costCentres, actor.taxRegime) : null;
    return {
      settings,
      map,
      vouchers,
      missing,
      skipped,
      prior,
      masters,
      payrollLeftOut: include.has('payroll') && projectIds !== null,
    };
  }

  /**
   * The sites an export reads: those asked for, or every site. Someone who sees only their own sites
   * exports only those — and never the company-wide wage periods, which `null` alone brings in.
   */
  private scopeProjects(actor: RequestUser, requested: string[]): string[] | null {
    if (actor.seesAllProjects) return requested.length > 0 ? requested : null;
    for (const id of requested) {
      if (!actor.projectIds.includes(id)) throw ApiError.projectNotAssigned(id);
    }
    return requested.length > 0 ? requested : [...actor.projectIds];
  }

  /**
   * Masters: every party the vouchers name, every active supplier, the subcontractors and clients of
   * the sites in scope; the mapped accounts; and the sites as cost centres.
   */
  private async masters(
    tx: TenantTx,
    vouchers: AccountingVoucher[],
    map: Record<string, AccountingAccount>,
    projectIds: string[] | null,
    costCentres: Record<string, AccountingAccount>,
    regime: string,
  ): Promise<AccountingMasters> {
    const projectWhere = projectIds ? { id: { in: projectIds } } : {};
    const [vendors, subcontracts, projects] = await Promise.all([
      tx.vendor.findMany({ where: { active: true }, select: { id: true, name: true, taxId: true, email: true, phone: true, address: true } }),
      tx.subcontract.findMany({
        where: projectIds ? { projectId: { in: projectIds } } : {},
        select: { contractor: { select: { id: true, name: true, taxId: true, phone: true, address: true } } },
      }),
      tx.project.findMany({ where: { deletedAt: null, ...projectWhere }, select: { id: true, name: true, clientName: true }, orderBy: { name: 'asc' } }),
    ]);
    const parties = new Map<string, AccountingParty>();
    const add = (party: AccountingParty) => parties.set(`${party.kind}:${party.code}`, party);
    for (const vendor of vendors) add(vendorParty(vendor));
    for (const subcontract of subcontracts) add(contractorParty(subcontract.contractor));
    for (const project of projects) add(customerParty(project));
    for (const party of accountingPartiesOf(vouchers)) add(party);
    return {
      parties: [...parties.values()].sort((a, b) => a.name.localeCompare(b.name)),
      accounts: accountingMasterAccounts(map, regime),
      costCentres: projects.map((project) => {
        const mapped = costCentres[project.id];
        const name = mapped?.name.trim() || project.name;
        return { code: mapped?.code.trim() || accountingSiteCode(name), name };
      }),
    };
  }
}

const BATCH_SELECT = {
  id: true,
  number: true,
  system: true,
  periodFrom: true,
  periodTo: true,
  projectIds: true,
  include: true,
  includeExported: true,
  voucherCount: true,
  summary: true,
  createdBy: true,
  createdAt: true,
  files: { select: { id: true, name: true, contentType: true, sizeBytes: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.AccountingExportBatchSelect;

type BatchRow = Prisma.AccountingExportBatchGetPayload<{ select: typeof BATCH_SELECT }>;

function presentBatch(batch: BatchRow) {
  return {
    id: batch.id,
    number: batch.number,
    system: batch.system,
    system_label: ACCOUNTING_SYSTEM_LABELS[batch.system as keyof typeof ACCOUNTING_SYSTEM_LABELS] ?? batch.system,
    from: utcDateToIsoDate(batch.periodFrom),
    to: utcDateToIsoDate(batch.periodTo),
    project_ids: batch.projectIds,
    include: batch.include,
    include_exported: batch.includeExported,
    voucher_count: batch.voucherCount,
    summary: batch.summary,
    created_by: batch.createdBy,
    created_at: batch.createdAt.toISOString(),
    // Names in the order the system's import screens want them: masters before transactions.
    files: batch.files.map((file) => ({ id: file.id, name: file.name, content_type: file.contentType, size_bytes: file.sizeBytes })),
  };
}

function presentPrior(prior: PriorExport) {
  return { number: prior.number, system: prior.system, at: prior.at.toISOString() };
}

function presentVoucher(voucher: AccountingVoucher, prior: PriorExport | undefined) {
  const debit = voucher.lines.reduce((sum, line) => (line.amount > 0n ? sum + line.amount : sum), 0n);
  return {
    external_id: voucher.externalId,
    source_type: voucher.sourceType,
    source_id: voucher.sourceId,
    category: voucher.category,
    kind: voucher.kind,
    document: voucher.document,
    date: voucher.date,
    reference: voucher.reference,
    party: voucher.party?.name ?? null,
    site: voucher.siteName,
    narration: voucher.narration,
    amount: debit.toString(),
    lines: voucher.lines.map((line) => ({
      account: line.account.name,
      code: line.account.code,
      debit: line.amount > 0n ? line.amount.toString() : '0',
      credit: line.amount < 0n ? (-line.amount).toString() : '0',
    })),
    exported_in: prior ? presentPrior(prior) : null,
  };
}

function countsOf(vouchers: readonly AccountingVoucher[]): Record<Exclude<AccountingCategory, 'masters'>, number> {
  const counts = { purchases: 0, payroll: 0, subcontract_bills: 0, sales: 0, payments: 0 };
  for (const voucher of vouchers) counts[voucher.category] += 1;
  return counts;
}

function documentsOf(vouchers: readonly AccountingVoucher[]): Record<AccountingVoucher['document'], number> {
  const documents = { bill: 0, invoice: 0, journal: 0 };
  for (const voucher of vouchers) documents[voucher.document] += 1;
  return documents;
}
