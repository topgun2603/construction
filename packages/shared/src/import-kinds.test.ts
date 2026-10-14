import { describe, expect, it } from 'vitest';
import { importMatchColumns } from './excel';
import {
  IMPORT_KINDS,
  IMPORT_KIND_SPECS,
  IMPORT_REFERENCE_PLACEHOLDER,
  importBuildRow,
  importExampleRow,
  importFindDuplicates,
  importIsExampleRow,
  importValidateInput,
} from './import-kinds';

const india = { currencyDigits: 2, country: 'IN', timeZone: 'Asia/Kolkata', now: new Date('2026-10-06T06:00:00Z') };

describe('import kinds', () => {
  it('every kind has a required field, unique keys that exist and an example that validates', () => {
    for (const kind of IMPORT_KINDS) {
      const spec = IMPORT_KIND_SPECS[kind];
      expect(spec.fields.some((field) => field.required)).toBe(true);
      for (const unique of spec.unique) {
        for (const key of unique) expect(spec.fields.map((field) => field.key)).toContain(key);
      }
      const built = importBuildRow(kind, importExampleRow(kind), india);
      // The example must be importable as it stands, or the template teaches a mistake.
      expect({ kind, issues: built.issues }).toEqual({ kind, issues: [] });
    }
  });

  it("matches a template's own headers to every field", () => {
    for (const kind of IMPORT_KINDS) {
      const fields = IMPORT_KIND_SPECS[kind].fields;
      expect(Object.keys(importMatchColumns(fields.map((field) => field.label), fields))).toHaveLength(fields.length);
    }
  });
});

describe('building a row', () => {
  it('reads a worker into the create body', () => {
    const built = importBuildRow(
      'workers',
      { name: ' Ravi ', phone: '98765 43210', trade: 'Mason', skill_level: 'Semi-skilled', daily_wage: '1,250.50', contractor: 'Selvam Masonry' },
      india,
    );
    expect(built.issues).toEqual([]);
    expect(built.input).toMatchObject({
      name: 'Ravi',
      phone: '919876543210',
      skill_level: 'semi',
      daily_wage: '125050',
      contractor_id: IMPORT_REFERENCE_PLACEHOLDER,
    });
    expect(built.refs).toEqual({ contractor: ['Selvam Masonry'] });
    expect(built.keys.phone).toBe('919876543210');
  });

  it('names the column in every problem', () => {
    const built = importBuildRow('workers', { phone: '123', daily_wage: 'lots' }, india);
    expect(built.issues.map((issue) => issue.field)).toEqual(['name', 'phone', 'daily_wage']);
    expect(built.issues[0]!.message).toBe('Name is required');
    expect(built.issues[1]!.message).toMatch(/^Phone is not a mobile number/);
  });

  it("applies the create endpoint's own rules", () => {
    // A daily worker needs a daily wage — the schema's refine, not a rule of the import.
    const built = importBuildRow('workers', { name: 'Ravi' }, india);
    expect(built.issues).toHaveLength(1);
    expect(built.issues[0]!.field).toBe('daily_wage');

    // A hired machine needs a vendor and a hire basis.
    const machine = importBuildRow('equipment', { name: 'JCB', category: 'Backhoe loader (JCB)', ownership: 'hired' }, india);
    expect(machine.issues.map((issue) => issue.field).sort()).toEqual(['hire_basis', 'vendor']);
  });

  it('fills what an opening stock row leaves out', () => {
    const built = importBuildRow('opening_stock', { material: 'Cement', quantity: 120 }, india);
    expect(built.issues).toEqual([]);
    expect(built.input).toMatchObject({ type: 'in', quantity: '120', moved_on: '2026-10-06', note: 'Opening stock' });
  });

  it('splits a list of sites', () => {
    const built = importBuildRow('team', { name: 'Priya', phone: '9876512345', role: 'Supervisor', sites: 'Harbour Point, Quiet Meadows' }, india);
    expect(built.issues).toEqual([]);
    expect(built.refs.sites).toEqual(['Harbour Point', 'Quiet Meadows']);
    expect(built.input.project_ids).toHaveLength(2);
    expect(built.input.role).toBe('site_supervisor');
  });

  it('refuses owners from a spreadsheet', () => {
    const built = importBuildRow('team', { name: 'Priya', phone: '9876512345', role: 'owner' }, india);
    expect(built.issues[0]!.field).toBe('role');
  });

  it('reads money in the company currency', () => {
    const kuwait = { ...india, currencyDigits: 3, country: 'KW' };
    expect(importBuildRow('projects', { name: 'Tower', budget_amount: '1,000.125' }, kuwait).input.budget_amount).toBe('1000125');
    expect(importBuildRow('projects', { name: 'Tower', budget_amount: '1,000.125' }, india).issues[0]!.field).toBe('budget_amount');
  });

  it('maps schema problems back to fields', () => {
    expect(importValidateInput('projects', { name: 'Tower', start_date: '2026-10-10', target_end_date: '2026-10-01' })).toEqual([
      { field: 'target_end_date', message: 'Target end date: target_end_date cannot be before start_date' },
    ]);
  });
});

describe('duplicates and the example row', () => {
  it('reports the repeat, naming the first row', () => {
    const rows = [
      { keys: { phone: '919876543210' }, row: 2 },
      { keys: { phone: '919876543211' }, row: 3 },
      null,
      { keys: { phone: '919876543210' }, row: 5 },
      { keys: {}, row: 6 },
    ];
    expect([...importFindDuplicates('workers', rows)]).toEqual([[3, 'same phone as row 2']]);
  });

  it('compares composite keys', () => {
    const rows = [
      { keys: { site: 'a', material: 'cement' }, row: 2 },
      { keys: { site: 'b', material: 'cement' }, row: 3 },
      { keys: { site: 'a', material: 'cement' }, row: 4 },
    ];
    expect([...importFindDuplicates('opening_stock', rows)]).toEqual([[2, 'same site and material as row 2']]);
  });

  it("recognises the template's example row, with dropdown labels", () => {
    const example = { ...importExampleRow('equipment'), category: 'Backhoe loader (JCB)', year: 2021 };
    expect(importIsExampleRow('equipment', example)).toBe(true);
    expect(importIsExampleRow('equipment', { ...example, name: 'JCB 4DX' })).toBe(false);
    expect(importIsExampleRow('workers', { name: 'Murugan K' })).toBe(false);
  });
});
