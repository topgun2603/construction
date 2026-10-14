import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  BOQ_DEFAULT_MAPPING,
  CSV_BOM,
  boqAbstractCsv,
  boqAutoMapCostCodes,
  boqFindHeaderRow,
  boqItemKey,
  boqItemsCsv,
  boqParseSheet,
  boqSheetRows,
  boqSuggestMapping,
  currencyMinorDigits,
  lineAmount,
  parseCsv,
  quantityToThousandths,
  taxRule,
  type BoqAutoMapInput,
  type BoqColumnMapping,
  type BoqExportItem,
  type BoqExportQuery,
  type BoqImportInput,
  type BoqImportProblem,
  type BoqTermsInput,
  type CreateBoqItemInput,
  type UpdateBoqItemInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { boqWorkbook, readBoqFile } from './boq-file';
import {
  BOQ_SETTLED,
  assertSite,
  boqForSite,
  boqItemById,
  decimal,
  loadBoq,
  type BoqLedger,
} from './boq-ledger';
import { boqView, emptyBoqView } from './boq-views';

/** Money is shown to whoever sees the BOQ or bills on it; a measurer works with quantities only. */
export const seesBoqMoney = (actor: RequestUser) => can(actor, 'boq.view') || can(actor, 'boq.bill');

/**
 * The bill of quantities itself (roadmap Phase 2, module 5): its terms, its items, importing it from
 * a spreadsheet, exporting it, and linking items to the site's cost codes.
 *
 * One BOQ per site, created the first time anybody writes to it — a site with no BOQ simply shows
 * an empty one, rather than every site carrying an empty row from the day it was made.
 */
@Injectable()
export class BoqService {
  constructor(private readonly tenantDb: TenantDb) {}

  async get(actor: RequestUser, projectId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const project = await assertSite(tx, actor, projectId);
      const ledger = await boqForSite(tx, actor, projectId);
      return ledger
        ? boqView(ledger, actor.taxRegime, seesBoqMoney(actor))
        : emptyBoqView(project, actor.taxRegime, seesBoqMoney(actor));
    });
  }

  async updateTerms(actor: RequestUser, projectId: string, input: BoqTermsInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const boqId = await ensureBoq(tx, actor, projectId);
      await tx.boq.update({
        where: { id: boqId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.retention_bp === undefined ? {} : { retentionBp: input.retention_bp }),
          ...(input.advance_amount === undefined ? {} : { advanceAmount: input.advance_amount }),
          ...(input.advance_recovery_bp === undefined ? {} : { advanceRecoveryBp: input.advance_recovery_bp }),
          ...(input.tax_rate_bp === undefined ? {} : { taxRateBp: input.tax_rate_bp }),
        },
      });
    });
    return this.get(actor, projectId);
  }

  // --- items -------------------------------------------------------------------------------------

  async addItem(actor: RequestUser, projectId: string, input: CreateBoqItemInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const boqId = await ensureBoq(tx, actor, projectId);
      const ledger = await loadBoq(tx, boqId);
      assertNumberFree(ledger, input.item_no);
      if (input.parent_id && !ledger.items.some((item) => item.id === input.parent_id)) {
        throw ApiError.validationFailed({ parent_id: input.parent_id }, 'That section is not in this BOQ');
      }
      if (input.cost_code_id) await assertCostCode(tx, projectId, input.cost_code_id);
      const last = ledger.items.reduce((max, item) => Math.max(max, item.sortOrder), -1);
      const isItem = input.kind === 'item';
      const quantity = isItem ? quantityToThousandths(input.quantity!) : null;
      await tx.boqItem.create({
        data: {
          tenantId: actor.tenantId,
          boqId,
          parentId: input.parent_id ?? null,
          costCodeId: input.cost_code_id ?? null,
          kind: input.kind,
          itemNo: input.item_no,
          description: input.description,
          unit: isItem ? input.unit! : null,
          quantity: quantity === null ? null : decimal(quantity),
          rate: isItem ? input.rate! : null,
          amount: quantity === null ? null : lineAmount(quantity, input.rate!),
          sortOrder: last + 1,
        },
      });
    });
    return this.get(actor, projectId);
  }

  async updateItem(actor: RequestUser, itemId: string, input: UpdateBoqItemInput) {
    const projectId = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, item } = await boqItemById(tx, actor, itemId);
      if (input.item_no && boqItemKey(input.item_no) !== boqItemKey(item.itemNo)) assertNumberFree(ledger, input.item_no);
      if (input.cost_code_id) await assertCostCode(tx, ledger.projectId, input.cost_code_id);
      const figures = input.unit !== undefined || input.quantity !== undefined || input.rate !== undefined;
      if (item.kind === 'section' && figures) {
        throw ApiError.validationFailed({ kind: 'section' }, 'A section has no unit, quantity or rate');
      }
      // A rate the client has already certified work at is the contract; changing it would re-price
      // the bills already paid on the next one. That is a variation, not an edit.
      if (input.rate !== undefined && input.rate !== item.rate && onSettledBill(ledger, itemId)) {
        throw ApiError.conflict(
          `${item.itemNo} has been certified at its current rate; record the new rate as a variation`,
        );
      }
      const quantity = input.quantity === undefined ? null : quantityToThousandths(input.quantity);
      const rate = input.rate ?? item.rate ?? 0n;
      const finalQuantity = quantity ?? (item.quantity ? quantityToThousandths(item.quantity.toString()) : null);
      await tx.boqItem.update({
        where: { id: itemId },
        data: {
          ...(input.item_no === undefined ? {} : { itemNo: input.item_no }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
          ...(quantity === null ? {} : { quantity: decimal(quantity) }),
          ...(input.rate === undefined ? {} : { rate: input.rate }),
          ...(figures && finalQuantity !== null ? { amount: lineAmount(finalQuantity, rate) } : {}),
        },
      });
      return ledger.projectId;
    });
    return this.get(actor, projectId);
  }

  async removeItem(actor: RequestUser, itemId: string) {
    const projectId = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const { ledger, item } = await boqItemById(tx, actor, itemId);
      if (ledger.items.some((row) => row.parentId === itemId)) {
        throw ApiError.conflict(`${item.itemNo} has items under it. Remove or move those first.`);
      }
      if ((ledger.measured.get(itemId) ?? 0n) !== 0n || (await tx.boqMeasurement.count({ where: { itemId } })) > 0) {
        throw ApiError.conflict(`${item.itemNo} has measurements recorded against it`);
      }
      if (ledger.bills.some((bill) => bill.lines.some((line) => line.itemId === itemId))) {
        throw ApiError.conflict(`${item.itemNo} is on a bill to the client`);
      }
      await tx.boqItem.delete({ where: { id: itemId } });
      return ledger.projectId;
    });
    return this.get(actor, projectId);
  }

  /**
   * Propose — and with `apply`, write — a cost code for each item, by code, then name, then words
   * in the description, then the section's code. Items already coded keep theirs unless `overwrite`.
   */
  async autoMapCostCodes(actor: RequestUser, projectId: string, input: BoqAutoMapInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ledger = await boqForSite(tx, actor, projectId);
      if (!ledger) return { proposals: [], applied: 0 };
      const codes = await tx.costCode.findMany({
        where: { projectId },
        select: { id: true, code: true, name: true },
      });
      const proposed = boqAutoMapCostCodes(
        ledger.items.map((item) => ({
          id: item.id,
          parentId: item.parentId,
          itemNo: item.itemNo,
          description: item.description,
        })),
        codes,
      );
      const byId = new Map(codes.map((code) => [code.id, code]));
      const proposals = ledger.items
        .filter((item) => proposed.has(item.id) && (input.overwrite || !item.costCodeId))
        .filter((item) => item.costCodeId !== proposed.get(item.id))
        .map((item) => ({
          item_id: item.id,
          item_no: item.itemNo,
          description: item.description,
          cost_code: byId.get(proposed.get(item.id)!)!,
        }));
      if (input.apply) {
        const byCode = new Map<string, string[]>();
        for (const proposal of proposals) {
          byCode.set(proposal.cost_code.id, [...(byCode.get(proposal.cost_code.id) ?? []), proposal.item_id]);
        }
        for (const [costCodeId, ids] of byCode) {
          await tx.boqItem.updateMany({ where: { id: { in: ids }, boqId: ledger.id }, data: { costCodeId } });
        }
      }
      return { proposals, applied: input.apply ? proposals.length : 0 };
    });
  }

  // --- import ------------------------------------------------------------------------------------

  /**
   * Read the file and show what an import would do: the headings found, the mapping (guessed or
   * given), every row as it would be stored, every problem with its line, and what was skipped.
   * Writes nothing.
   */
  async previewImport(actor: RequestUser, projectId: string, input: BoqImportInput) {
    const ledger = await this.tenantDb.transaction(actor.tenantId, (tx) => boqForSite(tx, actor, projectId));
    const sheet = await this.readSheet(actor, input, ledger);
    return {
      sheets: sheet.sheets,
      sheet: sheet.sheet,
      header_row: sheet.headerRow,
      headers: sheet.headers,
      sample: sheet.rows.slice(sheet.headerRow + 1, sheet.headerRow + 9),
      mapping: sheet.mapping,
      rows: sheet.parsed.rows,
      errors: sheet.errors,
      skipped: sheet.parsed.skipped,
      total: sheet.parsed.total,
      items: sheet.parsed.rows.filter((row) => row.kind === 'item').length,
      sections: sheet.parsed.rows.filter((row) => row.kind === 'section').length,
      can_replace: !ledger || (ledger.measured.size === 0 && ledger.bills.length === 0),
      can_import: sheet.errors.length === 0 && sheet.parsed.rows.length > 0,
    };
  }

  /**
   * Import all or nothing. Any problem anywhere in the sheet refuses the whole file, with every
   * problem listed: half a BOQ is worse than none, because the missing half is not obvious.
   */
  async import(actor: RequestUser, projectId: string, input: BoqImportInput) {
    const existing = await this.tenantDb.transaction(actor.tenantId, (tx) => boqForSite(tx, actor, projectId));
    const sheet = await this.readSheet(actor, input, existing);
    if (sheet.errors.length > 0 || sheet.parsed.rows.length === 0) {
      throw ApiError.validationFailed(
        { errors: sheet.errors, skipped: sheet.parsed.skipped },
        sheet.parsed.rows.length === 0 && sheet.errors.length === 0
          ? 'There are no BOQ items in that sheet'
          : `${sheet.errors.length} ${sheet.errors.length === 1 ? 'row has a problem' : 'rows have problems'}; nothing was imported`,
      );
    }

    const imported = await this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        const boqId = await ensureBoq(tx, actor, projectId);
        const ledger = await loadBoq(tx, boqId);
        if (input.mode === 'replace') {
          if (ledger.measured.size > 0 || ledger.bills.length > 0) {
            throw ApiError.conflict(
              'Work has been measured or billed against this BOQ, so it cannot be replaced. Import the new items with "add to the BOQ" instead.',
            );
          }
          await tx.boqItem.deleteMany({ where: { boqId } });
        }
        const keep = input.mode === 'replace' ? [] : ledger.items;
        const ids = new Map(keep.map((item) => [boqItemKey(item.itemNo), item.id]));
        let order = keep.reduce((max, item) => Math.max(max, item.sortOrder), -1);
        const data = sheet.parsed.rows.map((row) => {
          // Ids made here so a child row can point at a parent in the same insert.
          const id = randomUUID();
          ids.set(boqItemKey(row.item_no), id);
          order += 1;
          return {
            id,
            tenantId: actor.tenantId,
            boqId,
            parentId: row.parent_item_no ? (ids.get(row.parent_item_no) ?? null) : null,
            kind: row.kind,
            itemNo: row.item_no,
            description: row.description,
            unit: row.unit,
            quantity: row.quantity === null ? null : decimal(BigInt(row.quantity)),
            rate: row.rate === null ? null : BigInt(row.rate),
            amount: row.amount === null ? null : BigInt(row.amount),
            sortOrder: order,
          };
        });
        await tx.boqItem.createMany({ data });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorId: actor.userId,
            action: 'boq.imported',
            entity: 'boqs',
            entityId: boqId,
            after: {
              file: input.file_name,
              mode: input.mode,
              items: data.length,
              total: sheet.parsed.total,
            },
          },
        });
        return data.length;
      },
      { timeout: 60_000 },
    );
    return { imported, boq: await this.get(actor, projectId) };
  }

  private async readSheet(actor: RequestUser, input: BoqImportInput, ledger: BoqLedger | null) {
    const grid = await readBoqFile(input.file_name, input.content_base64, input.sheet);
    const headerRow = input.header_row ?? boqFindHeaderRow(grid.rows);
    const headers = headerRow >= 0 ? (grid.rows[headerRow] ?? []) : columnLetters(grid.rows);
    const mapping: BoqColumnMapping =
      input.mapping ?? (headerRow >= 0 ? boqSuggestMapping(headers) : { ...BOQ_DEFAULT_MAPPING });
    const parsed = boqParseSheet(grid.rows, {
      mapping,
      headerRow,
      currencyDigits: currencyMinorDigits(actor.currency),
    });

    const errors: BoqImportProblem[] = [];
    for (const field of ['item_no', 'description'] as const) {
      if (mapping[field] === undefined) errors.push({ line: 0, field, message: `Choose the column that holds the ${field === 'item_no' ? 'item number' : 'description'}` });
    }
    if (mapping.quantity === undefined) errors.push({ line: 0, field: 'quantity', message: 'Choose the column that holds the quantity' });
    if (mapping.rate === undefined && mapping.amount === undefined) {
      errors.push({ line: 0, field: 'rate', message: 'Choose the column that holds the rate or the amount' });
    }
    errors.push(...parsed.errors);
    // Adding to a BOQ: a number already in it is the same item twice.
    if (ledger && input.mode === 'append') {
      const taken = new Set(ledger.items.map((item) => boqItemKey(item.itemNo)));
      for (const row of parsed.rows) {
        if (taken.has(boqItemKey(row.item_no))) {
          errors.push({ line: row.line, field: 'item_no', message: `${row.item_no}: is already in the BOQ` });
        }
      }
    }
    return { ...grid, headerRow, headers, mapping, parsed, errors };
  }

  // --- export ------------------------------------------------------------------------------------

  async export(actor: RequestUser, projectId: string, query: BoqExportQuery) {
    const { ledger, project } = await this.tenantDb.transaction(actor.tenantId, async (tx) => ({
      project: await assertSite(tx, actor, projectId),
      ledger: await boqForSite(tx, actor, projectId),
    }));
    const view = ledger ? boqView(ledger, actor.taxRegime, true) : emptyBoqView(project, actor.taxRegime, true);
    const digits = currencyMinorDigits(actor.currency);
    const items: BoqExportItem[] = view.items.map((item) => ({
      depth: item.depth,
      kind: item.kind,
      item_no: item.item_no,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount ?? '0',
      cost_code: item.cost_code?.code ?? null,
      measured_quantity: item.measured_quantity,
      billed_quantity: item.billed_quantity,
      measured_value: item.measured_value ?? '0',
      billed_value: item.billed_value ?? '0',
      percent_bp: item.percent_bp,
    }));
    const sections = view.items.filter((item) => item.kind === 'section');
    const abstractCsv = boqAbstractCsv(
      sections.map((item) => ({
        item_no: item.item_no,
        description: `${'  '.repeat(item.depth)}${item.description}`,
        depth: item.depth,
        contract: item.amount ?? '0',
        measured: item.measured_value ?? '0',
        billed: item.billed_value ?? '0',
        balance: item.balance ?? '0',
        percent_bp: item.percent_bp,
      })),
      {
        contract: view.totals?.contract ?? '0',
        measured: view.totals?.measured ?? '0',
        billed: view.totals?.billed ?? '0',
        balance: view.totals?.balance ?? '0',
        percent_bp: view.totals?.percent_bp ?? 0,
      },
      digits,
    );
    const slug = project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'site';

    if (query.format === 'csv') {
      return {
        fileName: `${slug}-${query.report === 'abstract' ? 'boq-abstract' : 'boq'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(CSV_BOM + (query.report === 'abstract' ? abstractCsv : boqItemsCsv(items, digits)), 'utf8'),
      };
    }
    const body = await boqWorkbook({
      title: view.title,
      rows: boqSheetRows(items, digits),
      depths: items.map((item) => item.depth),
      sections: items.map((item) => item.kind === 'section'),
      // The abstract sheet is the CSV's rows: one source for both, so they cannot disagree.
      abstract: parseCsv(abstractCsv).filter((row) => row.some((cell) => cell !== '')),
    });
    return {
      fileName: `${slug}-boq.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body,
    };
  }
}

// --- free functions, inside a tenant transaction ------------------------------------------------

/** The site's BOQ id, creating it with the regime's standard tax rate the first time. */
export async function ensureBoq(tx: TenantTx, actor: RequestUser, projectId: string): Promise<string> {
  await assertSite(tx, actor, projectId);
  const found = await tx.boq.findUnique({ where: { projectId }, select: { id: true } });
  if (found) return found.id;
  const created = await tx.boq.create({
    data: {
      tenantId: actor.tenantId,
      projectId,
      // 5% VAT in the UAE; India's GST on works contracts depends on the work, so it is never guessed.
      taxRateBp: taxRule(actor.taxRegime).standardRateBp ?? 0,
    },
    select: { id: true },
  });
  return created.id;
}

function assertNumberFree(ledger: BoqLedger, itemNo: string): void {
  const key = boqItemKey(itemNo);
  if (ledger.items.some((item) => boqItemKey(item.itemNo) === key)) {
    throw ApiError.conflict(`There is already an item ${itemNo} in this BOQ`, { item_no: itemNo });
  }
}

function onSettledBill(ledger: BoqLedger, itemId: string): boolean {
  return ledger.bills.some(
    (bill) => BOQ_SETTLED.has(bill.status) && bill.lines.some((line) => line.itemId === itemId),
  );
}

export async function assertCostCode(tx: TenantTx, projectId: string, id: string): Promise<void> {
  const found = await tx.costCode.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!found) throw ApiError.validationFailed({ cost_code_id: id }, 'That cost code is not on this site');
}

/** `A`, `B`, … for a sheet with no header row, so the mapping step still has something to show. */
function columnLetters(rows: readonly (readonly string[])[]): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, index) => {
    let label = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    return label;
  });
}
