import ExcelJS from 'exceljs';
import { BOQ_EXPORT_HEADINGS, boqNumberCellText, parseCsv } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';

/**
 * Reading and writing BOQ spreadsheets.
 *
 * Done on the server, not in the browser, so the preview a person checks and the import that is
 * stored are read by the same code from the same bytes — a browser parser and a server re-check
 * would be two readings of one sheet that can disagree on exactly the cell that matters.
 *
 * `.xlsx` through exceljs (MIT, maintained, reads and writes). The npm `xlsx` package is frozen at a
 * version with published advisories, which is not something to feed files from strangers to.
 */

/** A sheet's cells as text, row by row: what `boqParseSheet` reads. */
export interface BoqGrid {
  rows: string[][];
  /** Worksheet names, for a picker; empty for a CSV. */
  sheets: string[];
  sheet: string | null;
}

/** Enough for any BOQ; a "sheet" larger than this is something else. */
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 60;

export async function readBoqFile(fileName: string, base64: string, sheetName?: string): Promise<BoqGrid> {
  const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  if (bytes.length === 0) throw ApiError.validationFailed({ file: fileName }, 'The file is empty');

  if (/\.csv$/i.test(fileName)) {
    const rows = parseCsv(bytes.toString('utf8'));
    if (rows.length > MAX_ROWS) throw tooBig();
    return { rows: rows.map((row) => row.slice(0, MAX_COLUMNS)), sheets: [], sheet: null };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw ApiError.validationFailed(
      { file: fileName },
      'That file could not be read as an Excel workbook. Save it as .xlsx (not .xls) or as CSV.',
    );
  }
  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) {
    throw ApiError.validationFailed({ sheet: sheetName ?? null, sheets }, 'That worksheet is not in the file');
  }
  if (worksheet.rowCount > MAX_ROWS) throw tooBig();

  const rows: string[][] = [];
  const width = Math.min(worksheet.columnCount, MAX_COLUMNS);
  for (let r = 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c += 1) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return { rows, sheets, sheet: worksheet.name };
}

function tooBig(): ApiError {
  return ApiError.validationFailed({ max_rows: MAX_ROWS }, `A BOQ can have at most ${MAX_ROWS} rows per import`);
}

/**
 * One cell as the text a person sees. Numbers lose their float noise; a formula is its last
 * calculated result (what Excel saved), never the formula text.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return boqNumberCellText(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('formula' in value || 'sharedFormula' in value) {
      return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return '';
  }
  return String(value);
}

// --- export ----------------------------------------------------------------------------------------

/** Columns that hold numbers, so a spreadsheet sums them; the rest stay text (item numbers above all). */
const NUMERIC_COLUMNS = new Set([3, 4, 5, 7, 8, 9, 10, 11]);

/**
 * The BOQ as a workbook: the items with their progress, and the abstract by section on a second
 * sheet. `rows` are `boqSheetRows` (headings first); `depth` indents the description like the tree.
 */
export async function boqWorkbook(input: {
  title: string;
  rows: string[][];
  depths: number[];
  sections: boolean[];
  abstract: string[][];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BUILDR';
  const sheet = workbook.addWorksheet('BOQ', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = BOQ_EXPORT_HEADINGS.map((heading, index) => ({
    header: heading,
    width: index === 1 ? 60 : index === 0 ? 12 : 14,
  }));
  sheet.getRow(1).font = { bold: true };
  input.rows.slice(1).forEach((cells, index) => {
    const row = sheet.addRow(cells.map((cell, column) => asCell(cell, column)));
    row.getCell(2).alignment = { indent: input.depths[index] ?? 0, wrapText: true };
    if (input.sections[index]) row.font = { bold: true };
  });

  const abstract = workbook.addWorksheet('Abstract');
  input.abstract.forEach((cells, index) => {
    const row = abstract.addRow(cells.map((cell, column) => (index > 0 && column >= 2 ? asNumber(cell) : cell)));
    if (index === 0 || index === input.abstract.length - 1) row.font = { bold: true };
  });
  abstract.getColumn(2).width = 50;
  for (const column of [3, 4, 5, 6, 7]) abstract.getColumn(column).width = 16;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function asCell(cell: string, column: number): string | number {
  return NUMERIC_COLUMNS.has(column) ? asNumber(cell) : cell;
}

function asNumber(cell: string): string | number {
  if (cell === '') return '';
  const value = Number(cell);
  return Number.isFinite(value) ? value : cell;
}
