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
 * The system is deliberately light-only, so there is no dark palette here.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: '#F2F1F9',
        surface: '#FFFFFF',
        raised: '#FAFAFE',

        // Text
        ink: {
          DEFAULT: '#1B1A2E',
          soft: '#4A4870',
          muted: '#6B6A8C',
          faint: '#9694B4',
        },

        // Lines: neutral on surface, stronger on canvas, softest for dividers
        line: {
          DEFAULT: '#E6E5F0',
          strong: '#D9D7E8',
          soft: '#EFEEF7',
        },

        // The single action colour
        accent: {
          DEFAULT: '#6C4CE0',
          soft: '#DCD6F8',
          onDark: '#B9A6FF',
        },

        // Status — pill fill + pill text + the dot, nothing else
        done: { DEFAULT: '#12805C', bg: '#E3F6EF', fg: '#0E6B4E' },
        pending: { DEFAULT: '#A86A08', bg: '#FCF1E1', fg: '#85510A', line: '#F3DCB6' },
        blocked: { DEFAULT: '#D8443C', bg: '#FDEAE9', fg: '#A32A2F' },
        neutral: { bg: '#EDECF6', fg: '#4A4870' },

        // Dark navigation rail
        nav: {
          DEFAULT: '#1B1A2E',
          active: '#363357',
          card: '#2A2846',
        },

        // Progress track
        track: '#E7E5F2',
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
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Every number — counts, ₹, %, dates — is set in mono so columns align.
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
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
