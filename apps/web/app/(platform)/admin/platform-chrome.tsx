'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { PlatformNav } from './platform-nav';

/**
 * The console header, and the decision of when there should not be one.
 *
 * Returns nothing on the sign-in route. The layout used to render this unconditionally, so a
 * signed-out operator was shown Overview, Tenants and a Sign out button — three controls that
 * either bounce straight back to the login they are already on, or offer to sign out somebody who
 * is already out. It read as a session that had not really ended, which on a console that can
 * suspend any account on the platform is precisely the wrong impression.
 *
 * A client component because a server layout cannot read the path, and a nested layout cannot
 * remove chrome its parent rendered.
 */
export function PlatformChrome() {
  const pathname = usePathname();
  if (pathname === '/admin/login') return null;

  return (
    <header className="flex h-14 flex-none items-center gap-5 bg-nav px-6">
      <Link href="/admin" className="flex flex-none items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-control bg-accent text-white">
          <ShieldCheck className="size-[18px]" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[13.5px] font-semibold tracking-[0.02em] text-white">BUILDR</span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-accent-onDark">
            Platform
          </span>
        </span>
      </Link>

      <PlatformNav />
    </header>
  );
}
