// Table column definitions live at module level, where a hook cannot go. This turns each one into a
// function of `t` and updates its call site, and wraps the `header:` labels that the JSX pass could
// not see because they are object properties rather than markup.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
const DICT = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const APPLY = process.argv.includes('--apply');

const FILES = [
  'app/(dashboard)/labour/payments/payments-table.tsx',
  'app/(dashboard)/labour/wage-periods/periods-table.tsx',
  'app/(dashboard)/labour/wage-periods/[id]/lines-table.tsx',
  'app/(dashboard)/labour/workers/workers-table.tsx',
  'app/(dashboard)/projects/projects-table.tsx',
  'app/(platform)/admin/tenants/tenants-table.tsx',
  'app/(dashboard)/expenses/expenses-table.tsx',
];

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  let src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  const visit = (node) => {
    // `header: 'Client'` and the like — an object property, invisible to a JSX-only pass.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      ['header', 'label', 'title'].includes(node.name.text) &&
      ts.isStringLiteral(node.initializer) &&
      DICT[node.initializer.text]
    ) {
      edits.push({
        start: node.initializer.getStart(),
        end: node.initializer.getEnd(),
        text: `t(${quote(node.initializer.text)})`,
      });
    }

    // `const columns: ColumnDef<X>[] = [ ... ]` at module level becomes a builder.
    if (
      ts.isVariableStatement(node) &&
      node.parent === sf &&
      node.declarationList.declarations.length === 1
    ) {
      const decl = node.declarationList.declarations[0];
      const name = decl.name.getText();
      if (name === 'columns' && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        const type = decl.type ? decl.type.getText() : 'unknown[]';
        edits.push({
          start: node.getStart(),
          end: decl.initializer.getStart(),
          text: `function buildColumns(t: Translator): ${type} {\n  return `,
        });
        edits.push({ start: decl.initializer.getEnd(), end: node.getEnd(), text: ';\n}' });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  let out = src;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  // Call sites.
  out = out.replace(/columns=\{columns\}/g, 'columns={buildColumns(t)}');
  out = out.replace(
    /function buildColumns\(canDelete: boolean\)/,
    'function buildColumns(canDelete: boolean, t: Translator)',
  );
  out = out.replace(/buildColumns\(canDelete\)/g, 'buildColumns(canDelete, t)');
  out = out.replace(
    /const columnsFor = \(planNames: Record<string, string>\)/,
    'const columnsFor = (planNames: Record<string, string>, t: Translator)',
  );
  out = out.replace(/columnsFor\(planNames\)/g, 'columnsFor(planNames, t)');
  out = out.replace(/useMemo\(\(\) => columnsFor\(planNames, t\), \[planNames\]\)/,
    'useMemo(() => columnsFor(planNames, t), [planNames, t])');

  if (/\bTranslator\b/.test(out) && !out.includes("type Translator }") && !out.includes('Translator,')) {
    const last = [...out.matchAll(/^import .*?;$/gms)].pop();
    const line = "import type { Translator } from '@/lib/i18n';";
    if (!out.includes(line)) {
      out = out.slice(0, last.index + last[0].length) + `\n${line}` + out.slice(last.index + last[0].length);
    }
  }

  if (APPLY) fs.writeFileSync(file, out);
  console.log(`${rel}: ${edits.length} edits`);
}

function quote(value) {
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
}
