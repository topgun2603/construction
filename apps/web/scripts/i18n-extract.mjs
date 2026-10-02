// Every user-facing string in the web app's JSX, found with TypeScript's own parser.
//
// A regex cannot do this: `Record<string, X>` and `a > b` look exactly like JSX text to one, and
// the first pass duly offered to translate half the type annotations in the codebase. The AST knows
// the difference, and it also gives exact source positions - which is what makes the rewrite that
// follows safe rather than hopeful.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
const OUT = process.argv[3];

/** Attributes that carry prose a person reads. Everything else is markup or wiring. */
const PROSE_ATTRS = new Set([
  'title',
  'placeholder',
  'label',
  'aria-label',
  'hint',
  'body',
  'emptyText',
  'description',
  'alt',
  'confirmLabel',
  'cancelLabel',
  // Kept in step with `i18n-rewrite.mjs`: an attribute this one does not know about is a string
  // that never gets translated, which is how the first pass shipped English `note=` hints under
  // Tamil headings.
  'note',
  'caption',
  'subtitle',
  'heading',
  'empty',
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist', '.turbo'].includes(entry.name)) continue;
      walk(full, files);
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      files.push(full);
    }
  }
  return files;
}

/** Worth translating? Numbers, symbols and single punctuation are not. */
function isProse(value) {
  const v = value.trim();
  if (v.length < 2 || v.length > 200) return false;
  if (!/[A-Za-z]{2}/.test(v)) return false;
  // "·", "—", "⌘K", "%", "/" and friends on their own.
  if (!/[A-Za-z]{2,}/.test(v)) return false;
  return true;
}

const found = new Map();
const files = walk(ROOT);

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText();
      const text = raw.replace(/\s+/g, ' ').trim();
      if (isProse(text)) record(text, rel);
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText();
      if (PROSE_ATTRS.has(name) && ts.isStringLiteral(node.initializer)) {
        const text = node.initializer.text.replace(/\s+/g, ' ').trim();
        if (isProse(text)) record(text, rel);
      }
    }

    /*
     * `label: 'Overview'` in a plain object, not markup.
     *
     * This is where the navigation rail keeps its words, and a table keeps its column headings —
     * and leaving it out is exactly how the first pass shipped a Tamil app with an English rail.
     * The words that structure the whole interface happen to be the ones that are never JSX text.
     */
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      PROSE_ATTRS.has(node.name.text) &&
      ts.isStringLiteral(node.initializer)
    ) {
      const text = node.initializer.text.replace(/\s+/g, ' ').trim();
      if (isProse(text)) record(text, rel);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function record(text, file) {
  if (!found.has(text)) found.set(text, new Set());
  found.get(text).add(file);
}

const out = {};
for (const [text, files] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) {
  out[text] = [...files].sort();
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${found.size} strings across ${files.length} files`);
