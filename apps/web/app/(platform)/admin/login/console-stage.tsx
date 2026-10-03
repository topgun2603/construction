'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { Building2, ScrollText, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';

/*
 * The dark stage behind the console sign-in.
 *
 * A photograph of a real site, graded purple and held behind a heavy scrim, rather than the
 * blueprint-grid gradient this used to draw. The gradient was cheap and nothing to download, which
 * was the argument for it; what it could not do is say in one glance what the platform is for. The
 * console is the room behind a construction product, and the room should look like it.
 *
 * The grade is done in CSS, not in the asset. One photograph serves this page at any accent colour,
 * and a designer changing the brand purple does not have to re-export an image to match it — the
 * overlays below reference the same `accent` token the rest of the product does.
 *
 * What survives from the old stage: the message. The tenant login sells, this one warns. The three
 * lines are the console's actual powers, stated plainly, which is both the most impressive thing
 * on the screen and the most useful.
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
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[#140F2B]">
      {/*
        The photograph. `priority` because it is the largest paint on the page and the only one
        above the fold — lazy-loading it would show the flat purple first and then swap, which reads
        as a page that loaded wrong.
      */}
      <Image
        src="/photo_console_hero.webp"
        alt=""
        aria-hidden
        fill
        priority
        sizes="100vw"
        className="object-cover object-[60%_center]"
      />

      {/*
        Three overlays doing three different jobs, which is why they are not one gradient:
        a flat purple multiply that grades the whole photograph to the brand, a left-to-right
        darkening so the headline has something to sit on, and a bottom vignette so the card's
        lower edge does not float on a bright patch of hi-vis jacket.
      */}
      <div aria-hidden className="absolute inset-0 bg-[#2A1A5E] mix-blend-multiply" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[#120D26] via-[#120D26]/85 to-[#120D26]/30"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[#0E0A1E] via-transparent to-[#0E0A1E]/60"
      />

      {/* A single accent bloom, kept from the old stage. Slow enough to read as light. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-[18%] size-[560px] rounded-full bg-accent/30 blur-[150px]"
        initial={{ opacity: 0.3, scale: 0.94 }}
        animate={
          reduceMotion ? { opacity: 0.3 } : { opacity: [0.2, 0.45, 0.2], scale: [0.94, 1.06, 0.94] }
        }
        transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* A hard rule of accent along the top: the one piece of chrome, and it says "restricted". */}
      <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-[3px] bg-accent" />

      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1240px] items-center gap-12 px-6 py-14 lg:grid-cols-[1.1fr_minmax(380px,440px)] lg:gap-16">
        <section className="flex flex-col gap-9">
          <motion.div
            className="flex flex-col gap-5"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <span className="flex items-center gap-3.5">
              {/* The wordmark, not a generic shield. This is the product's own console. */}
              <Image
                src="/logo.png"
                alt=""
                aria-hidden
                width={52}
                height={52}
                className="size-[52px] rounded-[14px]"
              />
              <span className="flex flex-col leading-none">
                <span className="text-[26px] font-bold tracking-[0.06em] text-white">BUILDR</span>
                <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.26em] text-accent-onDark">
                  {t('Platform console')}
                </span>
              </span>
            </span>

            {/*
              The eyebrow. Four words for what the platform holds, which is the one piece of
              context a stranger landing here has no other way to get.
            */}
            <span className="text-[11.5px] font-medium uppercase tracking-[0.3em] text-white/45">
              {t('Construction')} · {t('Projects')} · {t('People')} · {t('Progress')}
            </span>

            <h1 className="max-w-[14ch] text-[clamp(2.5rem,4.8vw,3.9rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">
              {t('The room behind')}
              <span className="block text-accent-onDark">every account.</span>
            </h1>

            <p className="max-w-[44ch] text-[15.5px] leading-relaxed text-white/70">
              {t('Not the builder’s app. This console reads across every tenant on the platform and can change what any of them is allowed to do.')}
            </p>
          </motion.div>

          <motion.ul
            className="flex max-w-[46ch] flex-col gap-4"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
          >
            {POWERS.map((power) => {
              const Icon = power.icon;
              return (
                <li key={power.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex size-11 flex-none items-center justify-center rounded-[13px] bg-white/[0.07] text-accent-onDark ring-1 ring-inset ring-white/[0.1] backdrop-blur-sm">
                    <Icon className="size-[19px]" />
                  </span>
                  <span className="flex flex-col gap-1 pt-0.5">
                    <span className="text-[14.5px] font-semibold leading-tight text-white">
                      {power.title}
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-white/55">
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
