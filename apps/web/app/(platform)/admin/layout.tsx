import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { PlatformChrome } from './platform-chrome';

export const metadata = { title: 'BUILDR platform' };

/**
 * The platform console shell.
 *
 * Visually distinct from the tenant dashboard on purpose — dark chrome, the word "Platform" always
 * on screen. An operator with the power to suspend any account must never be in doubt about which of
 * the two windows they are typing into, and the cost of that confusion is somebody's business going
 * offline.
 *
 * Tabs in the header rather than a sidebar rail: the console is two screens plus a detail view, and a
 * rail copied from the tenant app would be the main thing making the two look alike.
 *
 * `PlatformChrome` decides whether there is a header at all — there is none on the sign-in route,
 * which has its own full-bleed treatment and no session to navigate with.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <PlatformChrome />
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  );
}
