import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ServiceWorkerGuard } from '@/components/service-worker-guard';
import { directionOf } from '@/lib/i18n';
import { getLanguage } from '@/lib/i18n-server';
import { ACCENT_COOKIE, parseAccent, parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

/*
 * IBM Plex Sans and Plex Mono, self-hosted by next/font — no CDN request, no
 * layout shift. Plex has Devanagari and Tamil siblings at the same weights, which
 * is why the design picked it: localisation lands without a type change.
 *
 * The files live in ./fonts rather than coming from next/font/google: that one
 * downloads from Google at compile time, and a single failed fetch bakes the
 * fallback face into the build. Latin subset, from @fontsource; OFL in ./fonts.
 */
const plexSans = localFont({
  src: [
    { path: './fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-sans',
  display: 'swap',
});

/*
 * Plex Sans Arabic, for Arabic text. It sits after Plex Sans in the stack rather than replacing it:
 * the Latin face has no Arabic glyphs, so the browser falls through to this one character by
 * character, and a number or a brand name inside an Arabic sentence stays in the Latin face.
 */
const plexArabic = localFont({
  src: [
    {
      path: './fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-plex-arabic',
  display: 'swap',
  // Only Arabic pages need it; preloading it on every English page would be 43 KB for nothing.
  preload: false,
});

const plexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BUILDR',
  description: 'Daily site reporting, attendance and labour cost for builders',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Owners check this on a phone in the car; let them pinch to read a number.
  maximumScale: 5,
};

/**
 * `lang`, `dir` and `data-theme` come from the reader's cookies, so an Arabic page is right to left from
 * its first paint rather than flipping after hydration.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await getLanguage();
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const accent = parseAccent(jar.get(ACCENT_COOKIE)?.value);
  return (
    <html
      lang={language}
      dir={directionOf(language)}
      data-theme={theme}
      data-accent={accent}
      className={`${plexSans.variable} ${plexArabic.variable} ${plexMono.variable}`}
    >
      <body>
        <ServiceWorkerGuard />
        {children}
      </body>
    </html>
  );
}
