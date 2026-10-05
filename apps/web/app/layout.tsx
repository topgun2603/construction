import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { ServiceWorkerGuard } from '@/components/service-worker-guard';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <ServiceWorkerGuard />
        {children}
      </body>
    </html>
  );
}
