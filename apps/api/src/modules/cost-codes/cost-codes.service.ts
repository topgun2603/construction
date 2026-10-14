import { Injectable } from '@nestjs/common';
import {
  STANDARD_TEMPLATE_ID,
  STANDARD_TEMPLATE_NAME,
  STANDARD_WBS,
  compareCostCodes,
  impliedParentCode,
  orderCostCodeTree,
  type CostCodeTemplateLine,
  type CreateCostCodeInput,
  type CreateCostCodeTemplateInput,
  type ImportCostCodesInput,
  type UpdateCostCodeInput,
  type UpdateCostCodeTemplateInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

export interface CostCodeView {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  unit: string | null;
  /** Minor units. Null for somebody who may pick a code but not see what the line is priced at. */
  budget: string | null;
  labour_default: boolean;
  depth: number;
}

export interface CostCodeTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  builtin: boolean;
  items: number;
}

/** A line to merge into a site: from a template (no budget) or a spreadsheet (maybe one). */
interface MergeRow {
  code: string;
  name: string;
  parent_code?: string | null;
  unit?: string | null;
  budget?: bigint | null;
}

/**
 * Cost codes per site, and the company's library of templates to start them from (roadmap Phase 2,
 * module 1). The report is `CostReportService`; what is committed is `CostCommitmentsService`.
 */
@Injectable()
export class CostCodesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  // --- a site's codes --------------------------------------------------------------------------

  /**
   * The site's codes in tree order. Anyone recording an expense needs the list to pick from; only
   * `cost_codes.view` sees the budgets.
   */
  async list(actor: RequestUser, projectId: string): Promise<CostCodeView[]> {
    await this.access.assertAccess(actor, projectId);
    const rows = await this.tenantDb
      .clientFor(actor.tenantId)
      .costCode.findMany({ where: { projectId } });
    const showBudget = can(actor, 'cost_codes.view');
    return orderCostCodeTree(rows).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      parent_id: row.parentId,
      unit: row.unit,
      budget: showBudget ? row.budget.toString() : null,
      labour_default: row.labourDefault,
      depth: row.depth,
    }));
  }

  async create(actor: RequestUser, projectId: string, input: CreateCostCodeInput) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await assertCodeFree(tx, projectId, input.code);
      if (input.parent_id) await findCode(tx, projectId, input.parent_id);
      if (input.labour_default) await clearLabourDefault(tx, projectId);
      const row = await tx.costCode.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          code: input.code,
          name: input.name,
          parentId: input.parent_id ?? null,
          unit: input.unit ?? null,
          budget: input.budget ?? 0n,
          labourDefault: input.labour_default ?? false,
        },
      });
      return toPlain(row);
    });
  }

  async update(actor: RequestUser, projectId: string, id: string, input: UpdateCostCodeInput) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await findCode(tx, projectId, id);
      if (input.code !== undefined && input.code !== current.code) {
        await assertCodeFree(tx, projectId, input.code);
      }
      if (input.parent_id) {
        await findCode(tx, projectId, input.parent_id);
        await assertNotUnder(tx, projectId, id, input.parent_id);
      }
      if (input.labour_default) await clearLabourDefault(tx, projectId);
      const row = await tx.costCode.update({
        where: { id },
        data: {
          ...(input.code === undefined ? {} : { code: input.code }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parent_id === undefined ? {} : { parentId: input.parent_id }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.budget === undefined ? {} : { budget: input.budget }),
          ...(input.labour_default === undefined ? {} : { labourDefault: input.labour_default }),
        },
      });
      return toPlain(row);
    });
  }

  /**
   * Remove a line nobody has used. One with children or with spend booked to it is refused: its
   * history is the point of having it, and silently un-coding a month of expenses would move them
   * to "Unallocated" without anybody deciding that.
   */
  async remove(actor: RequestUser, projectId: string, id: string): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await findCode(tx, projectId, id);
      const [children, expenses, subcontractLines, deductions, orderLines] = await Promise.all([
        tx.costCode.count({ where: { parentId: id } }),
        tx.expense.count({ where: { costCodeId: id, deletedAt: null } }),
        tx.subcontractLine.count({ where: { costCodeId: id } }),
        tx.subcontractDeduction.count({ where: { costCodeId: id } }),
        // A purchase order commits money against the line; the foreign key would refuse anyway,
        // but with a message about a missing record rather than the order that holds it.
        tx.purchaseOrderLine.count({ where: { costCodeId: id } }),
      ]);
      if (children > 0) {
        throw ApiError.conflict('This line has lines under it. Remove or move those first.', {
          children,
        });
      }
      if (expenses > 0) {
        throw ApiError.conflict(
          'Expenses are booked to this line. Rename it, or move the expenses, instead.',
          { expenses },
        );
      }
      // A subcontract line carries its commitment and its certified cost on this code; the foreign
      // key refuses too, but this says why.
      if (subcontractLines + deductions > 0) {
        throw ApiError.conflict('Subcontract work is booked to this line. Rename it instead.', {
          subcontract_lines: subcontractLines,
          deductions,
        });
      }
      if (orderLines > 0) {
        throw ApiError.conflict(
          'Purchase orders are booked to this line. Rename it, or change the orders, instead.',
          { purchase_order_lines: orderLines },
        );
      }
      await tx.costCode.delete({ where: { id } });
    });
  }

  /**
   * Copy a template into a site. Codes the site already has are left exactly as they are — budgets
   * included — so applying a template twice, or after somebody has started, never undoes work.
   */
  async applyTemplate(actor: RequestUser, projectId: string, templateId: string) {
    await this.access.assertAccess(actor, projectId);
    const lines = await this.templateLines(actor, templateId);
    return this.tenantDb.transaction(actor.tenantId, (tx) =>
      merge(tx, actor.tenantId, projectId, lines, 'add_only'),
    );
  }

  /**
   * Codes and budgets from a spreadsheet. A code the site has is updated — name, unit when given,
   * budget when given, parent when given — and anything new is added. All or nothing.
   */
  async import(actor: RequestUser, projectId: string, input: ImportCostCodesInput) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, (tx) =>
      merge(tx, actor.tenantId, projectId, input.rows, 'upsert'),
    );
  }

  // --- the template library --------------------------------------------------------------------

  async listTemplates(actor: RequestUser): Promise<CostCodeTemplateSummary[]> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).costCodeTemplate.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return [
      {
        id: STANDARD_TEMPLATE_ID,
        name: STANDARD_TEMPLATE_NAME,
        description: 'Built in. Copy it to make one of your own.',
        builtin: true,
        items: STANDARD_WBS.length,
      },
      ...rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        builtin: false,
        items: row._count.items,
      })),
    ];
  }

  async getTemplate(actor: RequestUser, id: string) {
    const summary = (await this.listTemplates(actor)).find((template) => template.id === id);
    if (!summary) throw ApiError.notFound('Template');
    return { ...summary, lines: await this.templateLines(actor, id) };
  }

  async createTemplate(actor: RequestUser, input: CreateCostCodeTemplateInput) {
    const lines = input.from_template_id
      ? await this.templateLines(actor, input.from_template_id)
      : input.from_project_id
        ? await this.projectLines(actor, input.from_project_id)
        : (input.items ?? []).map(normaliseLine);
    assertTemplateTree(lines);

    const id = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const template = await tx.costCodeTemplate.create({
        data: {
          tenantId: actor.tenantId,
          name: input.name,
          description: input.description ?? null,
        },
      });
      await writeTemplateItems(tx, actor.tenantId, template.id, lines);
      return template.id;
    });
    return this.getTemplate(actor, id);
  }

  async updateTemplate(actor: RequestUser, id: string, input: UpdateCostCodeTemplateInput) {
    if (id === STANDARD_TEMPLATE_ID) {
      throw ApiError.conflict('The built-in template cannot be changed. Copy it and edit the copy.');
    }
    const lines = input.items?.map(normaliseLine);
    if (lines) assertTemplateTree(lines);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const template = await tx.costCodeTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!template) throw ApiError.notFound('Template');
      await tx.costCodeTemplate.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
        },
      });
      if (lines) {
        await tx.costCodeTemplateItem.deleteMany({ where: { templateId: id } });
        await writeTemplateItems(tx, actor.tenantId, id, lines);
      }
    });
    return this.getTemplate(actor, id);
  }

  /** Sites already started from it keep their codes: applying a template copies, never links. */
  async removeTemplate(actor: RequestUser, id: string): Promise<void> {
    if (id === STANDARD_TEMPLATE_ID) {
      throw ApiError.conflict('The built-in template cannot be deleted.');
    }
    const deleted = await this.tenantDb
      .clientFor(actor.tenantId)
      .costCodeTemplate.deleteMany({ where: { id } });
    if (deleted.count === 0) throw ApiError.notFound('Template');
  }

  // --- helpers --------------------------------------------------------------------------------

  private async templateLines(actor: RequestUser, id: string): Promise<CostCodeTemplateLine[]> {
    if (id === STANDARD_TEMPLATE_ID) return STANDARD_WBS.map((line) => ({ ...line }));
    const template = await this.tenantDb.clientFor(actor.tenantId).costCodeTemplate.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!template) throw ApiError.notFound('Template');
    return template.items
      .map((item) => ({
        code: item.code,
        name: item.name,
        parent_code: item.parentCode,
        unit: item.unit,
      }))
      .sort((a, b) => compareCostCodes(a.code, b.code));
  }

  /** A site's codes as template lines: "save this site's breakdown for the next job". */
  private async projectLines(actor: RequestUser, projectId: string): Promise<CostCodeTemplateLine[]> {
    await this.access.assertAccess(actor, projectId);
    const rows = await this.tenantDb
      .clientFor(actor.tenantId)
      .costCode.findMany({ where: { projectId } });
    const codeOf = new Map(rows.map((row) => [row.id, row.code]));
    return orderCostCodeTree(rows).map((row) => ({
      code: row.code,
      name: row.name,
      parent_code: row.parentId ? (codeOf.get(row.parentId) ?? null) : null,
      unit: row.unit,
    }));
  }
}

// --- free functions, all inside a tenant transaction ---------------------------------------------

async function findCode(tx: TenantTx, projectId: string, id: string) {
  const row = await tx.costCode.findFirst({ where: { id, projectId } });
  if (!row) throw ApiError.notFound('Cost code');
  return row;
}

async function assertCodeFree(tx: TenantTx, projectId: string, code: string): Promise<void> {
  const taken = await tx.costCode.findFirst({ where: { projectId, code }, select: { id: true } });
  if (taken) throw ApiError.conflict(`This site already has a line ${code}`, { code });
}

/** Only one line per site takes unbooked labour; choosing a new one releases the old. */
async function clearLabourDefault(tx: TenantTx, projectId: string): Promise<void> {
  await tx.costCode.updateMany({
    where: { projectId, labourDefault: true },
    data: { labourDefault: false },
  });
}

/** Refuses a move that would put a line beneath itself. */
async function assertNotUnder(
  tx: TenantTx,
  projectId: string,
  id: string,
  newParentId: string,
): Promise<void> {
  const rows = await tx.costCode.findMany({
    where: { projectId },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  let at: string | null = newParentId;
  const seen = new Set<string>();
  while (at && !seen.has(at)) {
    if (at === id) throw ApiError.conflict('A line cannot be moved under itself or its own lines');
    seen.add(at);
    at = parentOf.get(at) ?? null;
  }
}

function toPlain(row: {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  unit: string | null;
  budget: bigint;
  labourDefault: boolean;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parent_id: row.parentId,
    unit: row.unit,
    budget: row.budget.toString(),
    labour_default: row.labourDefault,
  };
}

function normaliseLine(item: {
  code: string;
  name: string;
  parent_code?: string | null;
  unit?: string | null;
}): CostCodeTemplateLine {
  return {
    code: item.code,
    name: item.name,
    parent_code: item.parent_code ?? null,
    unit: item.unit ?? null,
  };
}

/** Every code once, every named parent present, and no loops. */
function assertTemplateTree(lines: readonly CostCodeTemplateLine[]): void {
  const parentOf = new Map<string, string | null>();
  for (const line of lines) {
    if (parentOf.has(line.code)) {
      throw ApiError.validationFailed({ code: line.code }, `${line.code} appears twice`);
    }
    parentOf.set(line.code, line.parent_code);
  }
  for (const line of lines) {
    if (line.parent_code && !parentOf.has(line.parent_code)) {
      throw ApiError.validationFailed(
        { parent_code: line.parent_code },
        `${line.code} sits under ${line.parent_code}, which is not in the template`,
      );
    }
    const seen = new Set<string>();
    let at: string | null = line.code;
    while (at) {
      if (seen.has(at)) {
        throw ApiError.validationFailed({ code: line.code }, `${line.code} sits under itself`);
      }
      seen.add(at);
      at = parentOf.get(at) ?? null;
    }
  }
}

async function writeTemplateItems(
  tx: TenantTx,
  tenantId: string,
  templateId: string,
  lines: readonly CostCodeTemplateLine[],
): Promise<void> {
  if (lines.length === 0) return;
  await tx.costCodeTemplateItem.createMany({
    data: lines.map((line) => ({
      tenantId,
      templateId,
      code: line.code,
      name: line.name,
      parentCode: line.parent_code,
      unit: line.unit,
    })),
  });
}

/**
 * Merge lines into a site's codes, parents before children.
 *
 * A row's parent is the code it names, or — when it names none — the code its own shape implies
 * (`03.20` → `03`) if the site or the sheet has one; otherwise it is a top-level line. A named
 * parent that exists nowhere is an error, not a guess.
 */
async function merge(
  tx: TenantTx,
  tenantId: string,
  projectId: string,
  rows: readonly MergeRow[],
  mode: 'add_only' | 'upsert',
): Promise<{ created: number; updated: number; skipped: number }> {
  const existing = await tx.costCode.findMany({ where: { projectId } });
  const idOf = new Map(existing.map((row) => [row.code, row.id]));
  const incoming = new Set(rows.map((row) => row.code));
  const known = (code: string) => idOf.has(code) || incoming.has(code);

  const errors: string[] = [];
  const seen = new Set<string>();
  const resolved = rows.map((row) => {
    if (seen.has(row.code)) errors.push(`${row.code} appears twice`);
    seen.add(row.code);
    let parent: string | null = null;
    if (row.parent_code) {
      if (row.parent_code === row.code) errors.push(`${row.code} cannot sit under itself`);
      else if (!known(row.parent_code)) {
        errors.push(`${row.code} sits under ${row.parent_code}, which does not exist`);
      } else parent = row.parent_code;
    } else {
      const implied = impliedParentCode(row.code);
      parent = implied && known(implied) ? implied : null;
    }
    return { ...row, parent, explicitParent: Boolean(row.parent_code) };
  });
  if (errors.length > 0) {
    throw ApiError.validationFailed({ rows: errors.slice(0, 20) }, errors[0]);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let pending = resolved;
  while (pending.length > 0) {
    const ready = pending.filter((row) => row.parent === null || idOf.has(row.parent));
    if (ready.length === 0) {
      throw ApiError.validationFailed(
        { rows: pending.map((row) => row.code).slice(0, 20) },
        'Those lines sit under each other in a loop',
      );
    }
    for (const row of ready) {
      const parentId = row.parent ? idOf.get(row.parent)! : null;
      const current = existing.find((code) => code.code === row.code);
      if (!current) {
        const made = await tx.costCode.create({
          data: {
            tenantId,
            projectId,
            code: row.code,
            name: row.name,
            parentId,
            unit: row.unit ?? null,
            budget: row.budget ?? 0n,
          },
          select: { id: true },
        });
        idOf.set(row.code, made.id);
        created += 1;
      } else if (mode === 'add_only') {
        skipped += 1;
      } else {
        await tx.costCode.update({
          where: { id: current.id },
          data: {
            name: row.name,
            ...(row.unit ? { unit: row.unit } : {}),
            ...(row.budget === null || row.budget === undefined ? {} : { budget: row.budget }),
            ...(row.explicitParent ? { parentId } : {}),
          },
        });
        updated += 1;
      }
    }
    const done = new Set(ready);
    pending = pending.filter((row) => !done.has(row));
  }

  // Re-parenting existing lines can close a loop the ordering above cannot see.
  const after = await tx.costCode.findMany({
    where: { projectId },
    select: { id: true, code: true, parentId: true },
  });
  const parentOf = new Map(after.map((row) => [row.id, row.parentId]));
  for (const row of after) {
    const path = new Set<string>();
    let at: string | null = row.id;
    while (at) {
      if (path.has(at)) {
        throw ApiError.validationFailed({ code: row.code }, `${row.code} would sit under itself`);
      }
      path.add(at);
      at = parentOf.get(at) ?? null;
    }
  }
  return { created, updated, skipped };
}
