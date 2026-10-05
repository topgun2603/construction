// A translator's sheet in, a dictionary out.
//
// Translators work in spreadsheets, not in TypeScript. This turns a dictionary into a CSV with the
// English, the current draft and an empty "corrected" column, and reads the sheet back: a filled-in
// correction wins, an empty one keeps the draft. Every string the interface translates is on the
// sheet — the Tamil dictionary is the list of what the UI wraps in `t()`, so its keys are the keys
// any other language needs — and a row with no draft yet is just English waiting for a translator.
//
//   node scripts/i18n-review.mjs export ar ar-review.csv
//   node scripts/i18n-review.mjs import ar ar-review.csv
//
// The CSV starts with a byte-order mark: without one Excel opens UTF-8 as Windows-1252 and every
// Arabic or Tamil cell arrives as mojibake.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const [mode, language, file] = process.argv.slice(2);
if (!['export', 'import'].includes(mode) || !/^[a-z]{2}$/.test(language ?? '') || !file) {
  console.error('usage: node scripts/i18n-review.mjs export|import <language> <file.csv>');
  process.exit(1);
}

/** The object literal in a generated dictionary file; it is JSON apart from the trailing comma. */
function readDictionary(code) {
  const source = path.join(LIB, `i18n-${code}.ts`);
  if (!fs.existsSync(source)) return { header: '', entries: {} };
  const text = fs.readFileSync(source, 'utf8');
  const start = text.indexOf('{', text.indexOf('export const'));
  const body = text.slice(start, text.lastIndexOf('}') + 1).replace(/,\s*}$/, '}');
  return { header: text.slice(0, text.indexOf('export const')), entries: JSON.parse(body) };
}

const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((cells) => cells.some((value) => value !== ''));
}

const keys = Object.keys(readDictionary('ta').entries).sort();
const current = readDictionary(language);

if (mode === 'export') {
  const lines = [['english', 'draft', 'corrected'].map(cell).join(',')];
  for (const key of keys) {
    lines.push([key, current.entries[key] ?? '', ''].map(cell).join(','));
  }
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n');
  const drafted = keys.filter((key) => current.entries[key]).length;
  console.log(`${keys.length} strings, ${drafted} with a draft -> ${file}`);
} else {
  const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const at = (name) => head.indexOf(name);
  if (at('english') < 0 || at('draft') < 0 || at('corrected') < 0) {
    console.error('the sheet needs english, draft and corrected columns');
    process.exit(1);
  }
  const entries = {};
  let corrected = 0;
  for (const cells of rows) {
    const english = cells[at('english')];
    const fixed = cells[at('corrected')]?.trim();
    const value = fixed || cells[at('draft')]?.trim();
    if (!english || !value) continue;
    if (fixed) corrected++;
    entries[english] = value;
  }
  const header =
    current.header ||
    `/** ${language} for the interface, keyed by the English string. Imported from a review sheet. */\n`;
  const body = Object.keys(entries)
    .sort()
    .map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(entries[key])},`)
    .join('\n');
  const name = language.toUpperCase();
  fs.writeFileSync(
    path.join(LIB, `i18n-${language}.ts`),
    `${header}export const ${name}: Record<string, string> = {\n${body}\n};\n`,
  );
  console.log(`${Object.keys(entries).length} strings (${corrected} corrected) -> lib/i18n-${language}.ts`);
}
