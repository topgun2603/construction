# ADR 0002 — Design tokens live in the Tailwind preset, never in components

Status: accepted (superseded the placeholder-palette version)
Date: 2026-09-09

## Context

The visual design lives in a Claude Design project, "SiteBook UI System". The
`DesignSync` tool could not read it: it needs a design-system authorization that
only `/design-login` can grant from an interactive session.

The design was instead delivered as a published artifact — a bundled `.dc.html`
canvas. Its manifest is gzipped base64, so it was unpacked locally
(`scratchpad/unbundle.mjs` + `split.mjs`) into one file per artboard, and the tokens
were read from artboards 1a (colour), 1b (type scale) and 1c (components).

## Decision

Every colour, radius, type step and shadow in `apps/web` is declared once, in
`packages/config/tailwind/preset.js`, and consumed by semantic name:
`bg-surface`, `text-ink-muted`, `border-line`, `rounded-panel`, `font-mono`.

Components never carry a literal hex and never use a stock Tailwind palette class
such as `bg-blue-600`.

Three rules from the design are encoded in the token names themselves, so following
the naming is the same thing as following the design:

- **Status colour appears only in pills, bars and dots.** There is deliberately no
  `bg-done` surface token — only the `done-bg` / `done-fg` / `done` pill triple. A
  component that wants a green panel cannot spell one without reaching around the
  system.
- **Accent is the only colour used for action.** One `accent`, used for primary
  buttons, the active nav mark and progress fill. The single sanctioned exception is
  the `approve` button, which is a commitment rather than navigation.
- **A status is always dot + word + colour.** `StatusPill` renders the dot by
  default, because the design's note is explicit: three signals, so the pill still
  reads for colour-blind users and on a phone in direct sun.

Numbers — counts, ₹, %, dates — are set in IBM Plex Mono with tabular figures, so
cost columns and wage sheets align on the decimal.

The system is **light-only**. Status colour carries meaning here, and a second
palette would need all four status pairs re-derived for contrast. No dark blocks are
defined rather than half-defined.

## Consequences

- Retheming is one file. Changing the accent is one line in the preset.
- A component that hard-codes `bg-white` or `text-gray-500` silently opts out of the
  system. Treat it as a review comment.
- Fonts are self-hosted through `next/font/google` rather than a stylesheet link: no
  third-party request, no layout shift. Plex was chosen because it has Devanagari
  and Tamil siblings at the same weights, so localisation lands without a type
  change.
- The design's artboards show two meters the API cannot yet fill — work progress and
  spend vs budget. `SiteCard` renders the meters it can source and omits the rest
  rather than inventing figures; the slots are built so steps 3 and 9 drop in
  without a redesign.

## Follow-up

Artboards not yet built: 3c (Reports & approvals), 3d (Settings — team & plan), 4a
(client portal), 5a (SaaS admin console), 6b (cash payout report). The supervisor
artboards (2a–2f, 6a) belong to the Flutter app, build order step 7.

If the design changes, prefer re-exporting the artifact and re-reading the tokens
over hand-patching the preset — and run `/design-login` once so `DesignSync` can
read the project directly next time.
