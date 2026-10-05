/**
 * Light, dark, or whatever the device is set to.
 *
 * Kept in a cookie rather than localStorage for the same reason the language is: the server reads
 * it and renders `<html data-theme>` with the page, so a dark-theme reader never sees a white flash
 * before the script catches up. "System" is resolved in CSS (`prefers-color-scheme`), not here, so
 * it follows the phone when it switches to dark at sunset without a reload.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'buildr_theme';

export function parseTheme(value: string | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : 'light';
}

/** Client only. Applies at once — the palette is CSS variables, so nothing has to re-render. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // A year, `SameSite=Lax`: a display preference, not a credential.
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The action colour. Violet is the design's own and the default; the others swap only the three
 * accent variables (see globals.css), so every button, link and focus ring follows at once.
 */
export const ACCENTS = ['violet', 'blue', 'teal', 'rose', 'graphite'] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_COOKIE = 'buildr_accent';

/** The swatch in the picker: the light-theme accent, matching globals.css. */
export const ACCENT_SWATCH: Record<Accent, string> = {
  violet: '#6C4CE0',
  blue: '#2563EB',
  teal: '#0F7F80',
  rose: '#CC3A74',
  graphite: '#3F4456',
};

export function parseAccent(value: string | undefined): Accent {
  return ACCENTS.includes(value as Accent) ? (value as Accent) : 'violet';
}

export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
  document.cookie = `${ACCENT_COOKIE}=${accent}; path=/; max-age=31536000; samesite=lax`;
}
