# i18n tooling

Three scripts, run in order, that keep the interface translatable. They exist because the
translation covers ~800 strings across 150 files: doing that by hand once is a week, and doing it
again every time somebody adds a button is why half-translated apps stay half-translated.

All three are built on TypeScript's own parser. That is not fussiness — a regex cannot tell JSX text
from `Record<string, X>` or from `a > b`, and the first attempt at this duly offered to translate
half the type annotations in the codebase.

## The loop

```bash
# 1. What words are on screen?
node scripts/i18n-extract.mjs . strings.json

# 2. Translate whatever is new, and add it to lib/i18n-ta.ts.
#    (The dictionary is keyed by the English string, so there are no key names to invent.)

# 3. Wrap the strings that now have a translation, and give each component its `t`.
node scripts/i18n-rewrite.mjs . strings.json --apply
node scripts/i18n-bind.mjs . needs-binding.json --apply

# 4. The gate. A rewrite this size is only correct if all three pass.
npx tsc -p tsconfig.json --noEmit && npx eslint app components lib && npx next build
```

Steps 1–3 are a loop, not a sequence: **the rewriter only wraps strings that are already in the
dictionary**, so anything added to `i18n-ta.ts` after a rewrite needs another rewrite to take
effect. If a string is translated but still showing English, that is almost always why.

## The rule these scripts enforce

**The dictionary is consulted at render, never at definition.**

A constant array of tabs or statuses is evaluated when the module loads — no request, no React
context, no `t`. So a module-level constant keeps its English and the component that renders it
calls `t(tab.label)`. `i18n-unwrap-module.mjs` undoes the mistake in bulk if a wrapping pass ever
reaches module level again; learning this cost nine files of syntax errors and a revert.

## Where strings hide

Each of these was found by shipping without it, so the attribute lists in `i18n-extract.mjs` and
`i18n-rewrite.mjs` must stay in step:

| Shape | Example | Found by |
| --- | --- | --- |
| JSX text | `<span>Sign out</span>` | the obvious case |
| Prose attributes | `placeholder="Search"` | `PROSE_ATTRS` |
| Object properties | `{ label: 'Overview' }` | the navigation rail lives here |
| Table headers | `{ header: 'Client' }` | column definitions |
| Ternary branches | `{busy ? 'Saving…' : 'Save'}` | button labels |
| Enum labels | `{t(titleCase(row.status))}` | every badge in every table |

Comparison operands are deliberately never wrapped: `status === 'Approved'` wrapped in `t()` would
compare Tamil against English and silently render nothing.

## What stays English

- **Database content** — worker names, site addresses, material names, document titles, anything
  somebody typed. Translating what a user wrote is not translation.
- **Interpolated sentences** — `` `${n} urgent indent` ``. Tamil puts the verb last, so translating
  the fragments around a hole produces a sentence that reads backwards. Closing this needs
  whole-message formatting, which is the next real piece of work here.
