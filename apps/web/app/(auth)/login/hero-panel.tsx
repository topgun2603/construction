'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { HardHat, IndianRupee, WifiOff } from 'lucide-react';

/*
 * The dark half of the login screen.
 *
 * The drama is carried by type, depth and one accent — not by a stock photo of a
 * building site. Three reasons: a photo would fight the violet accent, it would be
 * the heaviest asset on the page a supervisor loads over 3G, and the product's
 * actual promise is legible numbers, which is what the panel shows instead.
 *
 * The blueprint grid is two repeating-linear-gradients, so the whole background
 * costs nothing to download and stays crisp at any density.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

const PROOF = [
  {
    icon: WifiOff,
    title: 'Works with no signal',
    body: 'Reports and attendance save on the phone and sync when the bars come back.',
  },
  {
    icon: HardHat,
    title: 'Named attendance',
    body: 'Every worker, every day, grouped by contractor — not a headcount guess.',
  },
  {
    icon: IndianRupee,
    title: 'Wages that tie out',
    body: 'The rate is frozen the day it is earned, so a raise never rewrites last week.',
  },
];

export function HeroPanel() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate hidden overflow-hidden bg-nav lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Blueprint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 64px)',
        }}
      />

      {/* Accent bloom, anchored behind the headline */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/3 -z-10 size-[520px] rounded-full bg-accent/30 blur-[120px]"
        initial={{ opacity: 0.35, scale: 0.92 }}
        animate={reduceMotion ? { opacity: 0.35 } : { opacity: [0.3, 0.55, 0.3], scale: [0.92, 1.04, 0.92] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex items-center gap-3"
      >
        <span className="flex size-9 items-center justify-center rounded-control bg-white text-[14px] font-bold text-ink">
          SB
        </span>
        <span className="text-[15px] font-semibold text-white">BUILDR</span>
      </motion.div>

      <div className="relative max-w-[520px]">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
          className="mb-5 font-mono text-[12px] uppercase tracking-[0.18em] text-accent-onDark"
        >
          Site management for builders
        </motion.p>

        <h2 className="text-[clamp(2.5rem,4.2vw,3.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-white">
          {['Every site.', 'Every day.', 'Every rupee.'].map((line, index) => (
            <motion.span
              key={line}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16 + index * 0.09, ease: EASE }}
              className="block"
            >
              {/* The last line is the promise the product is actually sold on. */}
              <span className={index === 2 ? 'text-accent-onDark' : undefined}>{line}</span>
            </motion.span>
          ))}
        </h2>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.46, ease: EASE }}
          className="mt-6 max-w-[420px] text-[16px] leading-relaxed text-[#B9B7D0]"
        >
          Daily reports, named attendance and wage sheets — from the site to your screen
          before you finish your morning tea.
        </motion.p>

        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.6 } } }}
          className="mt-10 flex flex-col gap-5 border-t border-white/[0.08] pt-8"
        >
          {PROOF.map((item) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.title}
                variants={{
                  hidden: { opacity: 0, x: -12 },
                  show: { opacity: 1, x: 0, transition: { duration: 0.45, ease: EASE } },
                }}
                className="flex gap-3.5"
              >
                <span className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-btn bg-white/[0.06] text-accent-onDark">
                  <Icon className="size-4" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14.5px] font-semibold text-white">{item.title}</span>
                  {/* Held to ~46 characters a line: past that the eye loses the
                      return sweep, and a one-word last line reads as a mistake. */}
                  <span className="max-w-[330px] text-[13.5px] leading-relaxed text-[#9C9AB8]">
                    {item.body}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        // #8B89A8 on the navy clears 4.5:1; the dimmer grey it replaced did not,
        // and this line is 11.5px.
        className="font-mono text-[11.5px] tracking-[0.08em] text-[#8B89A8]"
      >
        BUILT FOR SITES IN INDIA · ₹ IN PAISE, NEVER ROUNDED
      </motion.p>
    </section>
  );
}
