// Wraps every user-facing JSX string in `t(...)`, and gives each component the `t` it now needs.
//
// Driven by TypeScript's parser, not by regex: the AST is what distinguishes JSX text from
// `Record<string, X>`, and its exact source offsets are what make a 150-file rewrite a mechanical
// edit rather than a hopeful one. Edits are applied back to front so earlier offsets stay valid.
//
// Deliberately conservative. Anything it is unsure of it leaves alone — a string left in English is
// a gap somebody notices and fixes, while a string wrongly rewritten is a build that does not
// compile, or worse, one that does.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
const DICT = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const APPLY = process.argv.includes('--apply');

const PROSE_ATTRS = new Set([
  'title',
  'placeholder',
  'label',
  'aria-label',
  'hint',
  'body',
  'emptyText',
  'description',
  'confirmLabel',
  'cancelLabel',
  'note',
  'caption',
  'subtitle',
  'heading',
  'empty',
]);

/** Files whose words are not the product's: the extractor's own fixtures, tests, and the console. */
const SKIP_FILES = [/\.test\.tsx$/, /\/__tests__\//];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist', '.turbo', 'scripts'].includes(entry.name)) continue;
      walk(full, files);
    } else if (entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

let filesChanged = 0;
let stringsWrapped = 0;
const needsBinding = [];

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_FILES.some((re) => re.test(rel))) continue;

  const original = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  /** Is this node inside any function, or is it evaluated when the module loads? */
  const insideFunction = (node) => {
    let current = node.parent;
    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isMethodDeclaration(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText();
      const trimmed = raw.trim();
      // Only strings we actually have Tamil for. Wrapping the rest would add noise to every file
      // for no gain — `t('Cash')` and `Cash` render identically when nothing is translated.
      if (trimmed && DICT[collapse(trimmed)]) {
        const start = node.getStart() + raw.indexOf(trimmed);
        // Whitespace around the text is layout — a space before a `<span>` is a real space — so it
        // is preserved outside the braces rather than swallowed into the string.
        edits.push({ start, end: start + trimmed.length, text: `{t(${quote(collapse(trimmed))})}` });
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const value = collapse(node.initializer.text);
      if (PROSE_ATTRS.has(name) && DICT[value]) {
        edits.push({
          start: node.initializer.getStart(),
          end: node.initializer.getEnd(),
          text: `{t(${quote(value)})}`,
        });
      }
    }

    /*
     * `label: 'Cards'` in a plain object rather than in markup.
     *
     * Tab lists, toggle groups and column definitions keep their words here, which is why the first
     * pass produced a Tamil app whose tabs were still English. Only wrapped where `t` can actually
     * be in scope — the binder reports anything at module level, and those are handled by hand.
     */
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      PROSE_ATTRS.has(node.name.text) &&
      ts.isStringLiteral(node.initializer) &&
      DICT[collapse(node.initializer.text)] &&
      // Only where `t` can exist. A constant array of tabs at module level is evaluated when the
      // file loads, nowhere near a request or a React context — it keeps its English, and the
      // component that renders it calls `t(tab.label)` instead.
      insideFunction(node)
    ) {
      edits.push({
        start: node.initializer.getStart(),
        end: node.initializer.getEnd(),
        text: `t(${quote(collapse(node.initializer.text))})`,
      });
    }

    /*
     * A string inside a JSX expression: `{pending ? 'Saving…' : 'Save roll call'}`.
     *
     * Deliberately narrow. Only the two branches of a conditional, or a string that *is* the whole
     * expression — never an operand of a comparison, because `{status === 'Approved' && …}` wrapped
     * in `t()` would compare the Tamil against the English and silently render nothing. Being in
     * the dictionary is the other guard: a className or a key is never in there.
     */
    if (
      ts.isStringLiteral(node) &&
      DICT[collapse(node.text)] &&
      insideFunction(node) &&
      (ts.isJsxExpression(node.parent) ||
        (ts.isConditionalExpression(node.parent) &&
          (node.parent.whenTrue === node || node.parent.whenFalse === node)))
    ) {
      edits.push({
        start: node.getStart(),
        end: node.getEnd(),
        text: `t(${quote(collapse(node.text))})`,
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) continue;

  let out = original;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  filesChanged += 1;
  stringsWrapped += edits.length;
  needsBinding.push(rel);
  if (APPLY) fs.writeFileSync(file, out);
}

/** JSX text collapses runs of whitespace when rendered, so the key is the collapsed form. */
function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** Single quotes unless the string contains one, matching how the rest of this codebase quotes. */
function quote(value) {
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
}

console.log(`${stringsWrapped} strings wrapped in ${filesChanged} files${APPLY ? '' : ' (dry run)'}`);
fs.writeFileSync(
  path.join(path.dirname(process.argv[3]), 'needs-binding.json'),
  JSON.stringify(needsBinding, null, 1),
);
