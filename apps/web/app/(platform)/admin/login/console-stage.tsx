'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Building2, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';

/*
 * The dark stage behind the console sign-in.
 *
 * Same materials as the tenant login — blueprint grid, one accent bloom, type doing the work — so the
 * two read as one product. What differs is the message: the tenant login sells, this one warns. The
 * three lines below are the console's actual powers, stated plainly, which is both the most
 * impressive thing about the screen and the most useful.
 *
 * The grid and the bloom are gradients, not images: nothing to download, crisp at any density.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

const POWERS = [
  {
    icon: Building2,
    title: 'Every tenant, one list',
    body: 'Read across every builder on the platform — the only place in the product that can.',
  },
  {
    icon: ShieldAlert,
    title: 'Plans and suspension',
    body: 'Change what an account may do, or stop it working entirely, in one click.',
  },
  {
    icon: ScrollText,
    title: 'Recorded against you',
    body: 'Every change is written to the platform audit trail with your number on it.',
  },
];

export function ConsoleStage({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-nav">
      {/* Blueprint grid, the same construction cue the tenant login uses. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 72px), repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 72px)',
        }}
      />

      {/* A single accent bloom. Slow enough to read as light rather than animation. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-[-10%] -z-10 size-[620px] rounded-full bg-accent/25 blur-[140px]"
        initial={{ opacity: 0.3, scale: 0.94 }}
        animate={
          reduceMotion
            ? { opacity: 0.3 }
            : { opacity: [0.25, 0.5, 0.25], scale: [0.94, 1.05, 0.94] }
        }
        transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* A hard rule of accent along the top: the one piece of chrome, and it says "restricted". */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-accent" />

      <div className="mx-auto grid min-h-dvh w-full max-w-[1180px] items-center gap-12 px-6 py-14 lg:grid-cols-[1.05fr_minmax(360px,420px)] lg:gap-16">
        <section className="flex flex-col gap-10">
          <motion.div
            className="flex flex-col gap-5"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-[12px] bg-accent text-white">
                <ShieldCheck className="size-5" />
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[22px] font-bold tracking-[0.04em] text-white">BUILDR</span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-onDark">
                  Platform console
                </span>
              </span>
            </span>

            <h1 className="max-w-[15ch] text-[clamp(2.4rem,4.4vw,3.6rem)] font-semibold leading-[1.03] tracking-[-0.03em] text-white">
              The room behind
              <span className="block text-accent-onDark">every account.</span>
            </h1>

            <p className="max-w-[46ch] text-[15px] leading-relaxed text-[#B9B7D0]">
              Not the builder&rsquo;s app. This console reads across every tenant on the platform and
              can change what any of them is allowed to do.
            </p>
          </motion.div>

          <motion.ul
            className="flex max-w-[46ch] flex-col gap-5"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
          >
            {POWERS.map((power) => {
              const Icon = power.icon;
              return (
                <li key={power.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] bg-white/[0.06] text-accent-onDark ring-1 ring-inset ring-white/[0.08]">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[14.5px] font-semibold leading-tight text-white">
                      {power.title}
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-[#9C9AB8]">
                      {power.body}
                    </span>
                  </span>
                </li>
              );
            })}
          </motion.ul>
        </section>

        <motion.section
          className="w-full"
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06, ease: EASE }}
        >
          {children}
        </motion.section>
      </div>
    </div>
  );
}
