import type { z } from 'zod';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_CHARGE_BASES, EQUIPMENT_HIRE_BASES, EQUIPMENT_METER_TYPES, EQUIPMENT_OWNERSHIPS } from './equipment';
import { PAYMENT_TERMS, PROJECT_STATUSES, SKILL_LEVELS } from './enums';
import {
  excelNormaliseHeader,
  importCoerceBoolean,
  importCoerceDate,
  importCoerceDecimal,
  importCoerceEmail,
  importCoerceEnum,
  importCoerceInteger,
  importCoerceMoney,
  importCoercePhone,
  importCoerceText,
  importIsBlank,
  type ImportCell,
  type ImportCoerced,
  type ImportFieldSpec,
} from './excel';
import type { ModuleName } from './plans';
import type { Permission } from './permissions';
import { inviteUserSchema } from './schemas/auth';
import { costCodeImportRowSchema } from './schemas/cost-codes';
import { createEquipmentSchema } from './schemas/equipment';
import { createContractorSchema, createWorkerSchema, PAY_BASES } from './schemas/labour';
import { createVendorSchema } from './schemas/procurement';
import { createProjectSchema } from './schemas/project';
import { createMaterialSchema } from './schemas/site';
import { recordStockMovementSchema } from './schemas/stock';

/**
 * What can be imported from a spreadsheet, and how each row becomes the body of the endpoint that
 * creates one (roadmap Phase 3, item 4).
 *
 * A row is validated by the very zod schema its create endpoint uses, after the cells are read into
 * the shape that endpoint takes — so an import can never accept a worker the Add worker form would
 * refuse, nor refuse one it would accept. References by name (a worker's contractor, a machine's
 * vendor) are resolved to ids by the API, which can see the company's lists; until then they stand
 * in as a placeholder id so the schema's "a hired machine needs a vendor" rules still run.
 */

export const IMPORT_KINDS = [
  'workers',
  'contractors',
  'projects',
  'materials',
  'vendors',
  'equipment',
  'cost_codes',
  'opening_stock',
  'team',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** A reference by name, resolved by the API against the company's own list. */
export type ImportReferenceTarget = 'contractor' | 'project' | 'vendor' | 'material';

export interface ImportField extends ImportFieldSpec {
  /** The create body's key, when it differs from `key` (a reference: `contractor` → `contractor_id`). */
  target?: string;
  /** For `reference`: what it names. */
  references?: ImportReferenceTarget;
  /** For `reference`: several names, comma separated (a team member's sites). */
  many?: boolean;
  /** Text length limit, checked before the schema so the message names the column. */
  max?: number;
  /** Decimal places for a `decimal`. */
  places?: number;
  /** Extra spellings for enum options: `{ semi: ['semi skilled'] }`. */
  optionAliases?: Readonly<Record<string, readonly string[]>>;
  /** Labels for enum options in the template's dropdown, when the value alone reads badly. */
  optionLabels?: Readonly<Record<string, string>>;
}

export interface ImportKindSpec {
  kind: ImportKind;
  /** For headings and the audit entry: "Workers". */
  title: string;
  /** What the template's data sheet is called. */
  sheetName: string;
  /** The permission its create endpoint asks for; an import is that many creates. */
  permission: Permission;
  /** The plan module its create endpoint asks for, if any. */
  module?: ModuleName;
  /** `project`: the import is into one site, picked before the upload (cost codes). */
  scope: 'company' | 'project';
  fields: readonly ImportField[];
  /** Field sets that may not repeat — within the file or against what the company already has. */
  unique: readonly (readonly string[])[];
}

// --- headers people actually write ------------------------------------------------------------------

/** Tamil and Arabic headers for the columns a site office's own sheet is likely to have. */
const NAME = ['full name', 'பெயர்', 'الاسم'];
const PHONE = ['mobile', 'mobile number', 'phone number', 'contact number', 'கைபேசி', 'தொலைபேசி', 'الهاتف', 'رقم الجوال', 'الجوال'];
const TRADE = ['work type', 'occupation', 'தொழில்', 'المهنة'];
const SITE = ['site', 'project', 'site name', 'project name', 'தளம்', 'திட்டம்', 'الموقع', 'المشروع'];
const ADDRESS = ['முகவரி', 'العنوان'];
const UNIT = ['uom', 'அலகு', 'الوحدة'];
const CATEGORY = ['group', 'வகை', 'الفئة'];
const STATUS = ['நிலை', 'الحالة'];

const yesNo = { help: 'Yes or No.' };

const SPECS: Record<ImportKind, ImportKindSpec> = {
  workers: {
    kind: 'workers',
    title: 'Workers',
    sheetName: 'Workers',
    permission: 'workers.manage',
    module: 'labour',
    scope: 'company',
    unique: [['phone']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160, aliases: ['worker', 'worker name', ...NAME], example: 'Murugan K' },
      { key: 'phone', label: 'Phone', type: 'phone', aliases: PHONE, example: '9876543210', help: "Mobile number. Without a country code it is read in the company's country." },
      { key: 'trade', label: 'Trade', type: 'text', max: 80, aliases: TRADE, example: 'Mason' },
      {
        key: 'contractor',
        label: 'Contractor',
        type: 'reference',
        references: 'contractor',
        target: 'contractor_id',
        aliases: ['contractor name', 'gang', 'ஒப்பந்ததாரர்', 'المقاول'],
        example: '',
        help: 'The name of a contractor already in Settings → Contractors. Blank for direct labour.',
      },
      {
        key: 'skill_level',
        label: 'Skill level',
        aliases: ['skill', 'skill grade', 'grade'],
        type: 'enum',
        options: SKILL_LEVELS,
        optionAliases: { semi: ['semi skilled', 'semiskilled'], unskilled: ['helper', 'labour'] },
        optionLabels: { unskilled: 'Unskilled', semi: 'Semi-skilled', skilled: 'Skilled' },
        example: 'skilled',
        help: 'Unskilled, semi-skilled or skilled. Unskilled when blank.',
      },
      { key: 'pay_basis', label: 'Pay basis', type: 'enum', options: PAY_BASES, example: 'daily', help: 'Daily (a day rate) or monthly (a salary). Daily when blank.' },
      { key: 'daily_wage', label: 'Daily wage', type: 'money', aliases: ['wage', 'day rate', 'rate', 'தினக்கூலி', 'கூலி', 'الأجر اليومي'], example: '850', help: 'Needed for a daily worker.' },
      { key: 'overtime_rate_per_hour', label: 'Overtime per hour', type: 'money', aliases: ['ot', 'ot rate', 'ot per hour', 'overtime rate'], example: '120' },
      { key: 'basic_salary', label: 'Basic salary', type: 'money', aliases: ['salary', 'basic'], help: 'Needed for a monthly worker.' },
      { key: 'housing_allowance', label: 'Housing allowance', type: 'money', aliases: ['housing'] },
      { key: 'transport_allowance', label: 'Transport allowance', type: 'money', aliases: ['transport'] },
      { key: 'food_allowance', label: 'Food allowance', type: 'money', aliases: ['food'] },
      { key: 'wps_person_id', label: 'WPS person ID', type: 'text', max: 14, aliases: ['mol id', 'person id', 'labour card'] },
      { key: 'wps_agent_code', label: 'WPS agent code', type: 'text', max: 9, aliases: ['routing code', 'agent code'] },
      { key: 'wps_account', label: 'WPS account', type: 'text', max: 34, aliases: ['iban', 'salary card'] },
      { key: 'site', label: 'Site', type: 'reference', references: 'project', target: 'project_id', aliases: SITE, example: '', help: 'A site to put them on straight away, by its name.' },
      { key: 'from_date', label: 'On site from', type: 'date', aliases: ['from date', 'joining date', 'start date'], help: 'When they start on that site. Today when blank.' },
    ],
  },
  contractors: {
    kind: 'contractors',
    title: 'Contractors',
    sheetName: 'Contractors',
    permission: 'contractors.manage',
    module: 'labour',
    scope: 'company',
    unique: [['name']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160, aliases: ['contractor', 'contractor name', ...NAME], example: 'Selvam Masonry' },
      { key: 'trade', label: 'Trade', type: 'text', max: 80, aliases: TRADE, example: 'Masonry' },
      { key: 'phone', label: 'Phone', type: 'phone', aliases: PHONE, example: '9876501234' },
      { key: 'payment_terms', label: 'Payment terms', type: 'enum', options: PAYMENT_TERMS, aliases: ['terms', 'paid'], example: 'weekly', help: 'Weekly, fortnightly or monthly. Weekly when blank.' },
      { key: 'tax_id', label: 'Tax ID', type: 'text', max: 30, aliases: ['gstin', 'gst', 'trn', 'vat number'], help: 'GSTIN in India, TRN in the Gulf.' },
      { key: 'address', label: 'Address', type: 'text', max: 300, aliases: ADDRESS },
    ],
  },
  projects: {
    kind: 'projects',
    title: 'Sites',
    sheetName: 'Sites',
    permission: 'projects.manage',
    module: 'projects',
    scope: 'company',
    unique: [['name']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160, aliases: ['site', 'site name', 'project', 'project name', ...NAME], example: 'Harbour Point Villas' },
      { key: 'client_name', label: 'Client', type: 'text', max: 160, aliases: ['client name', 'customer', 'owner', 'வாடிக்கையாளர்', 'العميل'], example: 'Mr. Raghavan' },
      { key: 'address', label: 'Address', type: 'text', max: 500, aliases: ['location', ...ADDRESS], example: '12 Beach Road, Chennai' },
      { key: 'start_date', label: 'Start date', type: 'date', aliases: ['start', 'from'], example: '2026-11-01' },
      { key: 'target_end_date', label: 'Target end date', type: 'date', aliases: ['end date', 'finish', 'handover', 'due'], example: '2027-06-30' },
      { key: 'budget_amount', label: 'Budget', type: 'money', aliases: ['contract value', 'value', 'பட்ஜெட்', 'الميزانية'], example: '4500000' },
      {
        key: 'status',
        label: 'Status',
        type: 'enum',
        options: PROJECT_STATUSES,
        aliases: STATUS,
        optionAliases: { active: ['ongoing', 'running', 'in progress'], completed: ['done', 'handed over', 'finished'] },
        example: 'planning',
        help: 'Planning, active, on hold or completed. Planning when blank.',
      },
    ],
  },
  materials: {
    kind: 'materials',
    title: 'Materials',
    sheetName: 'Materials',
    permission: 'materials.manage',
    module: 'materials',
    scope: 'company',
    unique: [['name']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160, aliases: ['material', 'material name', 'item', 'description', 'பொருள்', 'المادة', ...NAME], example: 'OPC 53 cement' },
      { key: 'unit', label: 'Unit', type: 'text', required: true, max: 24, aliases: UNIT, example: 'bag' },
      { key: 'category', label: 'Category', type: 'text', max: 80, aliases: CATEGORY, example: 'Cement' },
    ],
  },
  vendors: {
    kind: 'vendors',
    title: 'Suppliers',
    sheetName: 'Suppliers',
    permission: 'vendors.manage',
    module: 'materials',
    scope: 'company',
    unique: [['name']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160, aliases: ['supplier', 'vendor', 'supplier name', 'vendor name', 'company', 'المورد', ...NAME], example: 'Sri Balaji Traders' },
      { key: 'contact_name', label: 'Contact person', type: 'text', max: 120, aliases: ['contact', 'contact name'], example: 'Balaji' },
      { key: 'phone', label: 'Phone', type: 'phone', aliases: PHONE, example: '9840012345' },
      { key: 'email', label: 'Email', type: 'email', aliases: ['email address', 'e-mail', 'மின்னஞ்சல்', 'البريد الإلكتروني'], example: 'sales@balaji.example' },
      { key: 'address', label: 'Address', type: 'text', max: 500, aliases: ADDRESS },
      { key: 'tax_id', label: 'Tax ID', type: 'text', max: 30, aliases: ['gstin', 'gst', 'trn', 'vat number'], help: 'GSTIN in India, TRN in the Gulf.' },
      { key: 'payment_terms_days', label: 'Payment terms (days)', type: 'integer', aliases: ['payment terms', 'credit days', 'terms'], example: '30' },
      { key: 'notes', label: 'Notes', type: 'text', max: 1000, aliases: ['note', 'remarks'] },
    ],
  },
  equipment: {
    kind: 'equipment',
    title: 'Equipment',
    sheetName: 'Equipment',
    permission: 'equipment.manage',
    module: 'projects',
    scope: 'company',
    unique: [['code'], ['registration_no']],
    fields: [
      { key: 'code', label: 'Code', type: 'text', max: 40, aliases: ['asset code', 'asset no', 'plant no', 'fleet no'], example: 'BH-001', help: 'Left blank, one is made up from the category.' },
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120, aliases: ['machine', 'equipment', 'description', ...NAME], example: 'JCB 3DX' },
      {
        key: 'category',
        label: 'Category',
        type: 'enum',
        required: true,
        options: EQUIPMENT_CATEGORIES,
        optionLabels: EQUIPMENT_CATEGORY_LABELS,
        optionAliases: Object.fromEntries(EQUIPMENT_CATEGORIES.map((category) => [category, [EQUIPMENT_CATEGORY_LABELS[category]]])),
        aliases: ['type', ...CATEGORY],
        example: 'backhoe',
      },
      { key: 'make', label: 'Make', type: 'text', max: 80, aliases: ['manufacturer', 'brand'], example: 'JCB' },
      { key: 'model', label: 'Model', type: 'text', max: 80, example: '3DX Super' },
      { key: 'registration_no', label: 'Registration no', type: 'text', max: 40, aliases: ['registration', 'reg no', 'number plate'], example: 'TN 09 AB 1234' },
      { key: 'serial_no', label: 'Serial no', type: 'text', max: 80, aliases: ['serial', 'chassis no'] },
      { key: 'year', label: 'Year', type: 'integer', aliases: ['year of manufacture', 'model year'], example: '2021' },
      { key: 'quantity', label: 'Quantity', type: 'integer', aliases: ['qty', 'count'], help: 'For a lot of small tools or scaffolding sets. 1 when blank.' },
      { key: 'ownership', label: 'Ownership', type: 'enum', required: true, options: EQUIPMENT_OWNERSHIPS, optionAliases: { owned: ['own'], hired: ['hire', 'rented', 'rental'] }, example: 'owned' },
      { key: 'vendor', label: 'Hired from', type: 'reference', references: 'vendor', target: 'vendor_id', aliases: ['vendor', 'supplier', 'hire vendor'], help: 'A supplier already in Procurement → Suppliers, by name. Needed for hired kit.' },
      { key: 'hire_basis', label: 'Hire basis', type: 'enum', options: EQUIPMENT_HIRE_BASES, optionAliases: { hour: ['hourly', 'per hour'], day: ['daily', 'per day'], month: ['monthly', 'per month'] }, help: 'Hour, day or month. Needed for hired kit.' },
      { key: 'hire_rate', label: 'Hire rate', type: 'money' },
      { key: 'min_hours', label: 'Minimum hours', type: 'decimal', places: 1, aliases: ['min hours'] },
      { key: 'operator_included', label: 'Operator included', type: 'boolean', ...yesNo },
      { key: 'operator_rate', label: 'Operator rate', type: 'money' },
      { key: 'fuel_included', label: 'Fuel included', type: 'boolean', ...yesNo },
      { key: 'mobilisation_charge', label: 'Mobilisation charge', type: 'money', aliases: ['mobilization charge', 'mobilisation'] },
      { key: 'charge_out_basis', label: 'Charge-out basis', type: 'enum', options: EQUIPMENT_CHARGE_BASES, optionAliases: { hour: ['hourly', 'per hour'], day: ['daily', 'per day'] } },
      { key: 'charge_out_rate', label: 'Charge-out rate', type: 'money', aliases: ['internal rate'] },
      { key: 'meter_type', label: 'Meter', type: 'enum', options: EQUIPMENT_METER_TYPES, aliases: ['meter type'], optionAliases: { hours: ['hour meter', 'hmr'], km: ['odometer', 'kilometres'] }, example: 'hours' },
      { key: 'meter_reading', label: 'Meter reading', type: 'decimal', places: 1, aliases: ['hmr reading', 'odometer reading'], example: '1250' },
      { key: 'notes', label: 'Notes', type: 'text', max: 2000, aliases: ['note', 'remarks'] },
    ],
  },
  cost_codes: {
    kind: 'cost_codes',
    title: 'Cost codes',
    sheetName: 'Cost codes',
    permission: 'cost_codes.manage',
    module: 'projects',
    scope: 'project',
    unique: [['code']],
    fields: [
      { key: 'code', label: 'Code', type: 'text', required: true, max: 30, aliases: ['cost code', 'wbs', 'குறியீடு', 'الرمز'], example: '02.01' },
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120, aliases: ['description', ...NAME], example: 'Excavation' },
      { key: 'parent_code', label: 'Parent code', type: 'text', max: 30, aliases: ['parent'], example: '02', help: 'Left blank, it is worked out from the code (02.01 sits under 02).' },
      { key: 'unit', label: 'Unit', type: 'text', max: 20, aliases: UNIT, example: 'm3' },
      { key: 'budget', label: 'Budget', type: 'money', aliases: ['amount', 'பட்ஜெட்', 'الميزانية'], example: '250000' },
    ],
  },
  opening_stock: {
    kind: 'opening_stock',
    title: 'Opening stock',
    sheetName: 'Opening stock',
    permission: 'stock.record',
    module: 'stock',
    scope: 'company',
    unique: [['site', 'material']],
    fields: [
      { key: 'site', label: 'Site', type: 'reference', references: 'project', target: 'project_id', aliases: SITE, example: 'Harbour Point Villas', help: 'Needed unless a site is picked for the whole import.' },
      { key: 'material', label: 'Material', type: 'reference', references: 'material', target: 'material_id', required: true, aliases: ['item', 'material name', 'பொருள்', 'المادة'], example: 'OPC 53 cement', help: 'A material already in Settings → Materials, by name.' },
      { key: 'quantity', label: 'Quantity', type: 'decimal', places: 3, required: true, aliases: ['qty', 'balance', 'stock', 'அளவு', 'الكمية'], example: '120' },
      { key: 'moved_on', label: 'As on', type: 'date', aliases: ['date', 'as of', 'தேதி', 'التاريخ'], example: '2026-10-01', help: 'The date the count was taken. Today when blank.' },
      { key: 'ref', label: 'Reference', type: 'text', max: 80, aliases: ['ref', 'challan'] },
      { key: 'note', label: 'Note', type: 'text', max: 500, aliases: ['notes', 'remarks'] },
    ],
  },
  team: {
    kind: 'team',
    title: 'Team members',
    sheetName: 'Team',
    permission: 'team.manage',
    scope: 'company',
    unique: [['phone']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120, aliases: NAME, example: 'Priya S' },
      { key: 'phone', label: 'Phone', type: 'phone', required: true, aliases: PHONE, example: '9876512345' },
      {
        key: 'role',
        label: 'Role',
        type: 'enum',
        required: true,
        // Not `owner`: a spreadsheet is the wrong place to hand someone the whole company. Owners are
        // invited one at a time, from the Team screen, by somebody who means it.
        options: ['project_manager', 'site_supervisor', 'accounts', 'client'],
        optionAliases: { project_manager: ['pm', 'manager'], site_supervisor: ['supervisor', 'engineer'], accounts: ['accountant'] },
        optionLabels: { project_manager: 'Project manager', site_supervisor: 'Site supervisor', accounts: 'Accounts', client: 'Client' },
        example: 'site_supervisor',
      },
      { key: 'sites', label: 'Sites', type: 'reference', references: 'project', target: 'project_ids', many: true, aliases: ['site', 'projects', ...SITE], help: 'Site names, separated by commas.' },
    ],
  },
};

export const IMPORT_KIND_SPECS: Readonly<Record<ImportKind, ImportKindSpec>> = SPECS;

export function importKindSpec(kind: ImportKind): ImportKindSpec {
  return SPECS[kind];
}

/** The create schemas, by kind: the same rules as the endpoints. */
const SCHEMAS: Record<ImportKind, z.ZodTypeAny> = {
  workers: createWorkerSchema,
  contractors: createContractorSchema,
  projects: createProjectSchema,
  materials: createMaterialSchema,
  vendors: createVendorSchema,
  equipment: createEquipmentSchema,
  cost_codes: costCodeImportRowSchema,
  opening_stock: recordStockMovementSchema,
  team: inviteUserSchema,
};

/**
 * Stands in for a referenced id until the API resolves the name, so the schema's own checks on that
 * field (a hired machine needs a vendor) still run on the preview. Never stored.
 */
export const IMPORT_REFERENCE_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

// --- reading one row ------------------------------------------------------------------------------------

export interface ImportContext {
  /** The company's currency's minor digits: 2 for INR and AED, 3 for KWD. */
  currencyDigits: number;
  /** ISO country, for reading a phone number without its code. */
  country: string;
  /** The company's time zone, for "today". */
  timeZone: string;
  now?: Date;
}

export interface ImportIssue {
  /** The field's key, or null for the row as a whole. */
  field: string | null;
  message: string;
}

export interface ImportBuiltRow {
  /** The create body, references as the placeholder id. */
  input: Record<string, unknown>;
  /** Names to resolve: field key → names (one, or several for a `many` reference). */
  refs: Record<string, string[]>;
  /** Normalised values of the `unique` fields, for spotting duplicates. */
  keys: Record<string, string>;
  issues: ImportIssue[];
}

function coerce(field: ImportField, cell: ImportCell, ctx: ImportContext): ImportCoerced<unknown> {
  switch (field.type) {
    case 'text':
    case 'reference':
      return importCoerceText(cell, field.max ?? (field.many ? 2000 : 200));
    case 'money':
      return importCoerceMoney(cell, ctx.currencyDigits);
    case 'date':
      return importCoerceDate(cell, ctx.timeZone, ctx.now);
    case 'phone':
      return importCoercePhone(cell, ctx.country);
    case 'email':
      return importCoerceEmail(cell);
    case 'integer':
      return importCoerceInteger(cell);
    case 'decimal':
      return importCoerceDecimal(cell, field.places ?? 2);
    case 'boolean':
      return importCoerceBoolean(cell);
    case 'enum':
      return importCoerceEnum(cell, field.options ?? [], {
        ...Object.fromEntries(Object.entries(field.optionLabels ?? {}).map(([option, label]) => [option, [label]])),
        ...(field.optionAliases ?? {}),
      } as Record<string, string[]>);
  }
}

/**
 * One sheet row → the create body for its kind, with every problem found on the way. Cells are by
 * field key; a field the sheet does not have is simply absent.
 */
export function importBuildRow(kind: ImportKind, cells: Readonly<Record<string, ImportCell>>, ctx: ImportContext): ImportBuiltRow {
  const spec = SPECS[kind];
  const input: Record<string, unknown> = {};
  const refs: Record<string, string[]> = {};
  const keys: Record<string, string> = {};
  const issues: ImportIssue[] = [];

  for (const field of spec.fields) {
    const cell = cells[field.key];
    if (importIsBlank(cell)) {
      if (field.required) issues.push({ field: field.key, message: `${field.label} is required` });
      continue;
    }
    const result = coerce(field, cell, ctx);
    if (!result.ok) {
      issues.push({ field: field.key, message: `${field.label} ${result.error}` });
      continue;
    }
    if (result.value === null) continue;

    if (field.type === 'reference') {
      const names = field.many
        ? String(result.value)
            .split(/[,;\n]/)
            .map((name) => name.trim())
            .filter(Boolean)
        : [String(result.value)];
      refs[field.key] = names;
      input[field.target ?? field.key] = field.many ? names.map(() => IMPORT_REFERENCE_PLACEHOLDER) : IMPORT_REFERENCE_PLACEHOLDER;
      keys[field.key] = names.map(excelNormaliseHeader).join(',');
    } else {
      input[field.target ?? field.key] = result.value;
      keys[field.key] = field.type === 'text' ? excelNormaliseHeader(String(result.value)) : String(result.value);
    }
  }

  // What each kind's endpoint takes beyond the columns.
  if (kind === 'opening_stock') {
    input.type = 'in';
    const today = importCoerceDate('today', ctx.timeZone, ctx.now);
    if (today.ok) input.moved_on ??= today.value;
    input.note ??= 'Opening stock';
    // Picked for the whole import when the sheet has no site column; the API fills it in.
    input.project_id ??= IMPORT_REFERENCE_PLACEHOLDER;
  }
  if (kind === 'team') input.project_ids ??= [];

  if (issues.length === 0) issues.push(...importValidateInput(kind, input));
  return { input, refs, keys, issues };
}

/** The create schema's verdict on a body, as issues against the sheet's fields. */
export function importValidateInput(kind: ImportKind, input: Record<string, unknown>): ImportIssue[] {
  const result = SCHEMAS[kind].safeParse(input);
  if (result.success) return [];
  const spec = SPECS[kind];
  return result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? '');
    const field = spec.fields.find((candidate) => (candidate.target ?? candidate.key) === key) ?? null;
    return {
      field: field?.key ?? null,
      message: field ? `${field.label}: ${issue.message}` : issue.message,
    };
  });
}

/** The parsed create body, after the API has put real ids in for the references. */
export function importParseInput<T = unknown>(kind: ImportKind, input: Record<string, unknown>): T {
  return SCHEMAS[kind].parse(input) as T;
}

/**
 * Rows that repeat an earlier row's unique fields, by index → the message. The first row of a pair
 * is kept; the repeat is the error, as a person reading the sheet top to bottom would say it.
 */
export function importFindDuplicates(
  kind: ImportKind,
  rows: ReadonlyArray<{ keys: Record<string, string>; row: number } | null>,
): Map<number, string> {
  const spec = SPECS[kind];
  const out = new Map<number, string>();
  for (const fields of spec.unique) {
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      if (!row) return;
      const values = fields.map((field) => row.keys[field]);
      if (values.some((value) => value === undefined || value === '')) return;
      const key = values.join('\u0000');
      const first = seen.get(key);
      if (first === undefined) seen.set(key, row.row);
      else if (!out.has(index)) {
        const labels = fields.map((field) => spec.fields.find((f) => f.key === field)?.label ?? field).join(' and ');
        out.set(index, `same ${labels.toLowerCase()} as row ${first}`);
      }
    });
  }
  return out;
}

/** The template's example row, by field key — what `importIsExampleRow` recognises and skips. */
export function importExampleRow(kind: ImportKind): Record<string, string> {
  return Object.fromEntries(SPECS[kind].fields.filter((field) => field.example).map((field) => [field.key, field.example!]));
}

/**
 * True for the example row the template ships with, left in by mistake — importing "Murugan K" with
 * a made-up phone number would be worse than skipping him.
 */
export function importIsExampleRow(kind: ImportKind, cells: Readonly<Record<string, ImportCell>>): boolean {
  const spec = SPECS[kind];
  const example = importExampleRow(kind);
  const keys = Object.keys(example);
  // Every example value must be there: a real row that shares one value with it is not the example.
  if (keys.length === 0 || keys.some((key) => importIsBlank(cells[key]))) return false;
  return keys.every((key) => {
    const field = spec.fields.find((candidate) => candidate.key === key)!;
    if (field.type === 'enum') {
      // A dropdown cell holds the option's label, not its value.
      const read = coerce(field, cells[key], { currencyDigits: 2, country: 'IN', timeZone: 'UTC' });
      return read.ok && read.value === example[key];
    }
    const read = importCoerceText(cells[key], 10_000);
    return read.ok && excelNormaliseHeader(read.value ?? '') === excelNormaliseHeader(example[key]!);
  });
}
