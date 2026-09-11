import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { ServiceWorkerGuard } from '@/components/service-worker-guard';
import './globals.css';

/*
 * IBM Plex Sans and Plex Mono, self-hosted by next/font — no CDN request, no
 * layout shift. Plex has Devanagari and Tamil siblings at the same weights, which
 * is why the design picked it: localisation lands without a type change.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
