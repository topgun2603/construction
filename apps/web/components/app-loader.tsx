'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import mark from '@/public/logo.png';
import { cn } from '@/lib/utils';

/**
 * The wait, with the mark on it.
 *
 * Two decisions worth stating, because both are about not being annoying:
 *
 * **It arrives late.** The whole thing is held at zero opacity for 400ms. Most navigations in this
 * app finish well inside that, and a loader that flashes on every click is worse than no loader —
 * it makes a fast app feel busy. What is left is the case this exists for: a wage sheet, a report
 * over a month of attendance, a dashboard on a bad connection.
 *
 * **The line changes, slowly.** One line every five seconds, which is long enough to read and far
 * too slow to be a slot machine. They are about the work rather than about waiting: somebody
 * staring at this is already waiting, and telling them so is not company.
 */

/** Site sense, not fortune cookies. Each one is something a builder would actually say. */
const LINES = [
  'Measure twice. Pour once.',
  'A slab is only as good as its shuttering.',
  'The best site diary is the one written today.',
  'Count the heads before you count the bags.',
  'Rain stops the pour, not the records.',
  'Steel is bought by weight and lost by inches.',
  'The gate register is the first line of the ledger.',
  'A wage frozen the day it was earned never has to be argued about.',
  'Cement sets whether or not the paperwork does.',
  'Every rupee on this site has a name.',
];

export function AppLoader({
  label = 'Loading',
  className,
}: {
  /** What is being waited for, for anybody using a screen reader. */
  label?: string;
  className?: string;
}) {
  // A random starting point, so somebody who waits twice in a row does not read the same line
  // twice. Set in an effect rather than during render: the server and the client would otherwise
  // pick different numbers and React would complain about the mismatch.
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    setIndex(Math.floor(Math.random() * LINES.length));
    const timer = setInterval(() => {
      setIndex((current) => ((current ?? 0) + 1) % LINES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-5 px-6 py-20',
        // Held invisible, then faded in. `forwards` keeps it visible once it arrives.
        'animate-[app-loader-in_300ms_ease-out_400ms_forwards] opacity-0',
        className,
      )}
    >
      <div className="relative flex size-20 items-center justify-center">
        {/* The ring is the moving part; the mark stays still. A spinning logo is a logo nobody can
            read, and this one is a building — turning it would throw away the thing it depicts. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-[2.5px] border-accent/15 border-t-accent motion-safe:animate-spin"
          style={{ animationDuration: '1.1s' }}
        />
        {/* The app's own icon, the same one on the phone's home screen — so a wait looks like this
            product rather than like a generic spinner. `priority` because it is the only thing on
            the screen while it is up. */}
        <Image src={mark} alt="" aria-hidden priority width={48} height={48} className="size-12" />
      </div>

      <div className="flex min-h-[2.5rem] max-w-[34ch] items-start justify-center text-center">
        {index !== null && (
          <p
            key={index}
            className="animate-[app-loader-line_400ms_ease-out] text-[13.5px] leading-relaxed text-ink-muted"
          >
            {LINES[index]}
          </p>
        )}
      </div>
    </div>
  );
}
