// Un-wraps `label: t('X')` where it sits at module level, and translates at the render site instead.
//
// A constant array of tabs or statuses is evaluated once, when the module loads — long before any
// request, and nowhere near a React context. `t` cannot exist there. The constant therefore keeps
// its English, and the component that renders it calls `t(tab.label)`, which is what the navigation
// rail already did.
//
// This is the general rule for this codebase: **the dictionary is consulted at render, not at
// definition.** Anything that defines a word outside a component defines it in English.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
const APPLY = process.argv.includes('--apply');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist', 'scripts'].includes(entry.name)) continue;
      walk(full, files);
    } else if (entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

let unwrapped = 0;
const touched = [];

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('t(')) continue;

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

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
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      !insideFunction(node)
    ) {
      edits.push({
        start: node.getStart(),
        end: node.getEnd(),
        text: node.arguments[0].getText(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) continue;

  let out = src;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  unwrapped += edits.length;
  touched.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  if (APPLY) fs.writeFileSync(file, out);
}

console.log(`${unwrapped} module-level t() calls unwrapped in ${touched.length} files`);
for (const f of touched) console.log(`  ${f}`);
