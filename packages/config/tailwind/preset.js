/**
 * Shared Tailwind preset — SiteBook UI System.
 *
 * Tokens come from the Claude Design export (artboards 1a/1b: colour tokens and
 * type scale). Components consume them by semantic name only — never a raw hex and
 * never a stock Tailwind palette class like `bg-blue-600`, which is how the design
 * stays swappable from one place.
 *
 * Two rules from the design that the token names are shaped to enforce:
 *   - Status colour appears only in pills, bars and dots. There is no
 *     `bg-done`/`bg-blocked` surface token, only the pill pairs.
 *   - Accent is the only colour used for action.
 *
 * Light and dark palettes are both in apps/web/app/globals.css, as variables.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      // Every colour is a variable, set per theme in apps/web/app/globals.css. The names are
      // the design's; the values live in one place per theme, so a component never knows which
      // theme it is in. Space-separated RGB channels, so `bg-accent/25` still works.
      colors: {
        // Surfaces
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',

        // Text
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
        },

        // Lines: neutral on surface, stronger on canvas, softest for dividers
        line: {
          DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
          strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
          soft: 'rgb(var(--c-line-soft) / <alpha-value>)',
        },

        // The single action colour
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
          onDark: 'rgb(var(--c-accent-on-dark) / <alpha-value>)',
        },

        // Status — pill fill + pill text + the dot, nothing else
        done: {
          DEFAULT: 'rgb(var(--c-done) / <alpha-value>)',
          bg: 'rgb(var(--c-done-bg) / <alpha-value>)',
          fg: 'rgb(var(--c-done-fg) / <alpha-value>)',
        },
        pending: {
          DEFAULT: 'rgb(var(--c-pending) / <alpha-value>)',
          bg: 'rgb(var(--c-pending-bg) / <alpha-value>)',
          fg: 'rgb(var(--c-pending-fg) / <alpha-value>)',
          line: 'rgb(var(--c-pending-line) / <alpha-value>)',
        },
        blocked: {
          DEFAULT: 'rgb(var(--c-blocked) / <alpha-value>)',
          bg: 'rgb(var(--c-blocked-bg) / <alpha-value>)',
          fg: 'rgb(var(--c-blocked-fg) / <alpha-value>)',
        },
        neutral: {
          bg: 'rgb(var(--c-neutral-bg) / <alpha-value>)',
          fg: 'rgb(var(--c-neutral-fg) / <alpha-value>)',
        },

        // Dark navigation rail
        nav: {
          DEFAULT: 'rgb(var(--c-nav) / <alpha-value>)',
          active: 'rgb(var(--c-nav-active) / <alpha-value>)',
          card: 'rgb(var(--c-nav-card) / <alpha-value>)',
          // The rail's gradient, tinted by the chosen accent.
          tint: 'rgb(var(--c-nav-tint) / <alpha-value>)',
          glow: 'rgb(var(--c-nav-glow) / <alpha-value>)',
        },

        // Progress track
        track: 'rgb(var(--c-track) / <alpha-value>)',

        // Always dark, in every theme: the scrim under white text on a photograph, and the
        // backdrop behind a dialog. `ink` turns light in the dark theme; a scrim must not.
        shade: 'rgb(var(--c-shade) / <alpha-value>)',
      },

      borderRadius: {
        // The design's 9 / 14 / 26 scale, plus the control sizes it uses
        control: '9px',
        card: '14px',
        sheet: '26px',
        btn: '11px',
        panel: '12px',
      },

      fontFamily: {
        sans: [
          'var(--font-plex-sans)',
          'var(--font-plex-arabic)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        // Every number — counts, ₹, %, dates — is set in mono so columns align.
        mono: ['var(--font-plex-mono)', 'var(--font-plex-arabic)', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        // Body never drops below 16px on mobile (design note, artboard 1b)
        display: ['32px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        metric: ['26px', { lineHeight: '1.05', fontWeight: '700' }],
        h1: ['21px', { lineHeight: '1.2', fontWeight: '600' }],
        h2: ['18px', { lineHeight: '1.25', fontWeight: '600' }],
        h3: ['17px', { lineHeight: '1.25', fontWeight: '600' }],
        body: ['17px', { lineHeight: '1.45' }],
        base: ['15px', { lineHeight: '1.45' }],
        sm: ['13.5px', { lineHeight: '1.3' }],
        xs: ['12.5px', { lineHeight: '1.4' }],
        label: ['12px', { lineHeight: '1.2', letterSpacing: '0.09em', fontWeight: '600' }],
      },

      boxShadow: {
        // Shadows only on floating layers — toast, sheet, browser chrome.
        float: '0 6px 18px rgba(28,33,38,.22)',
        panel: '0 3px 14px rgba(27,26,46,.08)',
        seg: '0 1px 2px rgba(28,33,38,.1)',
      },
    },
  },
  plugins: [],
};
