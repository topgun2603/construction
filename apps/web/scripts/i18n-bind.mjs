// Gives every component that now calls `t(...)` the `t` it needs, and the import that defines it.
//
// Run after `i18n-rewrite.mjs`. Splitting the two is what keeps either one understandable: the
// first decides which words are words, this one deals with scope.
//
// The scope question is the whole job. `t` comes from React context in a client component and from
// the request's cookie in a server one, so which binding to insert depends on the file — and a
// helper function that is not a component can take neither, because a hook cannot be called there
// and `await` would change its signature. Those are reported rather than guessed at.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
const FILES = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const APPLY = process.argv.includes('--apply');

const CLIENT_IMPORT = "import { useLanguage } from '@/components/language-provider';";
const SERVER_IMPORT = "import { getT } from '@/lib/i18n-server';";

let bound = 0;
const manual = [];

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  let src = fs.readFileSync(file, 'utf8');
  const isClient = /^\s*['"]use client['"]/m.test(src);

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** Every function that calls `t(...)` without already having a `t` of its own. */
  const owners = new Map();

  const enclosing = (node) => {
    let current = node.parent;
    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isMethodDeclaration(current)
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const fn = enclosing(node);
      if (fn) owners.set(fn, (owners.get(fn) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  /*
   * The binding goes on the nearest enclosing *component*, not on the nearest function.
   *
   * Most of the calls that need `t` are inside a `.map()` callback or a table's `cell` renderer.
   * Those are ordinary closures: they already see whatever the component declared, so they need
   * nothing of their own — and giving them their own would be calling a hook in a callback.
   *
   * What is left after that walk is the genuinely hard case: a function at module level, outside
   * any component, which can neither call a hook nor be awaited. Those are reported.
   */
  const components = new Set();
  for (const fn of owners.keys()) {
    let current = fn;
    let component = null;
    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current)
      ) {
        const name = nameOf(current);
        if ((name && /^[A-Z]/.test(name)) || isDefaultExported(current)) {
          component = current;
          break;
        }
      }
      current = current.parent;
    }
    if (component) components.add(component);
    else manual.push(`${rel}: ${nameOf(fn) ?? '(module level)'} uses t() outside any component`);
  }

  const edits = [];
  for (const fn of components) {
    const name = nameOf(fn);

    const body = fn.body;
    if (!body || !ts.isBlock(body)) {
      manual.push(`${rel}: ${name} has an expression body; needs converting by hand`);
      continue;
    }
    if (/const\s*\{\s*t\s*[,}]|const\s+t\s*=/.test(body.getText().slice(0, 400))) continue;

    const insertAt = body.getStart() + 1;
    if (isClient) {
      edits.push({ at: insertAt, text: `\n  const { t } = useLanguage();` });
    } else {
      edits.push({ at: insertAt, text: `\n  const t = await getT();` });
      if (!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        /*
         * `async`, inserted as a keyword rather than by rewriting the function.
         *
         * The first version replaced the whole function's text with an asyncified copy, which
         * silently discarded the binding the previous edit had put inside its body — nine files came
         * out as syntax errors. A single-point insertion cannot overlap anything.
         *
         * If a component made async here turns out to be imported by a client component, the build
         * says so. That is a better answer than this script trying to guess which it is.
         */
        const after = fn.modifiers?.length
          ? fn.modifiers[fn.modifiers.length - 1].getEnd()
          : fn.getStart();
        const keyword = src.indexOf('function', after);
        if (keyword === -1) manual.push(`${rel}: no function keyword for ${name}`);
        else edits.push({ at: keyword, text: 'async ' });
      }
    }
    bound += 1;
  }

  if (edits.length === 0) continue;

  let out = src;
  // Back to front, so earlier offsets stay valid. Every edit is a pure insertion at one point, so
  // two of them can never overlap.
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  }

  const needed = isClient ? CLIENT_IMPORT : SERVER_IMPORT;
  if (!out.includes(needed)) {
    // After the last import, so the file keeps one import block.
    const lastImport = [...out.matchAll(/^import .*?;$/gms)].pop();
    out = lastImport
      ? out.slice(0, lastImport.index + lastImport[0].length) +
        `\n${needed}` +
        out.slice(lastImport.index + lastImport[0].length)
      : `${needed}\n${out}`;
  }

  if (APPLY) fs.writeFileSync(file, out);
}

function nameOf(fn) {
  if (fn.name) return fn.name.getText();
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText();
  return null;
}

function isDefaultExported(fn) {
  return Boolean(fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
}

console.log(`${bound} components bound${APPLY ? '' : ' (dry run)'}`);
if (manual.length > 0) {
  console.log(`\n${manual.length} need a hand:`);
  for (const line of manual) console.log(`  ${line}`);
}
