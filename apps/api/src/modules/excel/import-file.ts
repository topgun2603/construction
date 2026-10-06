import ExcelJS from 'exceljs';
import { IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS, IMPORT_MAX_ROWS, parseCsv, type ImportCell } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';

/**
 * Reading an uploaded spreadsheet for an import.
 *
 * Done on the server, from the same bytes, for both the preview and the commit — a browser parser
 * and a server re-check would be two readings of one sheet that can disagree on exactly the cell
 * that matters (the BOQ import's reasoning). Unlike the BOQ reader this keeps a workbook's cells
 * typed: a date cell stays a date and a number a number, so "05/06/2026" typed as text and a real
 * date cell are each read for what they are.
 */
export interface ImportGrid {
  rows: ImportCell[][];
  /** Worksheet names, for the picker; empty for a CSV. */
  sheets: string[];
  sheet: string | null;
}

export async function readImportFile(fileName: string, base64: string, sheetName?: string): Promise<ImportGrid> {
  const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  if (bytes.length === 0) throw ApiError.validationFailed({ file: fileName }, 'The file is empty');
  if (bytes.length > IMPORT_MAX_BYTES) {
    throw ApiError.validationFailed({ max_bytes: IMPORT_MAX_BYTES }, 'The file is larger than 5 MB. Split it into smaller files.');
  }

  if (/\.csv$/i.test(fileName)) {
    const rows = parseCsv(bytes.toString('utf8'));
    assertRowCap(rows.length);
    return { rows: rows.map((row) => row.slice(0, IMPORT_MAX_COLUMNS)), sheets: [], sheet: null };
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
  // The template's Instructions sheet is for people; a data sheet is any other.
  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : (workbook.worksheets.find((sheet) => sheet.name !== 'Instructions' && sheet.name !== 'Lists') ?? workbook.worksheets[0]);
  if (!worksheet) {
    throw ApiError.validationFailed({ sheet: sheetName ?? null, sheets }, 'That worksheet is not in the file');
  }
  assertRowCap(worksheet.actualRowCount);

  const rows: ImportCell[][] = [];
  const width = Math.min(worksheet.columnCount, IMPORT_MAX_COLUMNS);
  for (let r = 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const cells: ImportCell[] = [];
    for (let c = 1; c <= width; c += 1) cells.push(cellValue(row.getCell(c).value));
    rows.push(cells);
  }
  return { rows, sheets, sheet: worksheet.name };
}

function assertRowCap(count: number): void {
  // One header row on top of the data.
  if (count > IMPORT_MAX_ROWS + 1) {
    throw ApiError.validationFailed(
      { max_rows: IMPORT_MAX_ROWS },
      `An import can have at most ${IMPORT_MAX_ROWS.toLocaleString('en')} rows. Split the file and import it in parts.`,
    );
  }
}

/** A cell's value as typed: a formula is its last calculated result, never the formula text. */
function cellValue(value: ExcelJS.CellValue): ImportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('formula' in value || 'sharedFormula' in value) {
      return cellValue((value as { result?: ExcelJS.CellValue }).result ?? null);
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return null;
  }
  return String(value);
}

/** A cell as the text the preview shows. */
export function cellText(cell: ImportCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}
