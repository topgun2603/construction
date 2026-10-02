'use client';

import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { HardHat, IndianRupee, WifiOff } from 'lucide-react';
import siteAtDusk from '@/public/bg.jpg';
import { useLanguage } from '@/components/language-provider';

/*
 * The dark half of the login screen.
 *
 * The photograph is the bottom two-thirds and the type sits above it, which is the only way a
 * picture and a headline share a panel without either being hard to read: the image is pushed
 * behind a navy-to-transparent gradient so the words always land on flat colour, never on sky.
 *
 * It goes through `next/image` rather than a CSS background, from a 270 KB JPEG rather than the
 * 2.3 MB PNG it arrived as. A photograph has no business in a lossless format: the PNG was storing
 * a sunset gradient pixel by pixel, and re-encoding it on every dev request is what ran the dev
 * server out of heap. `priority` because this is the largest contentful paint on the route —
 * lazy-loading the one image above the fold just moves the delay to where the user is looking.
 *
 * The blueprint grid that used to sit over all this is gone: with the photograph behind the type
 * there were two patterns competing for the same space, and the wireframe towers in the image say
 * "drawing" better than a CSS grid ever did.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

/** What the product does, in the order a builder meets it. */
const STAGES = ['Plan', 'Track', 'Manage', 'Grow'];

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
    title: 'Accurate wages',
    body: 'The rate is frozen the day it is earned, so a raise never rewrites last week.',
  },
];

export function HeroPanel() {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate hidden overflow-hidden bg-nav lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* The site at dusk, anchored to the bottom so the cranes rise into the headline's space. */}
      <Image
        src={siteAtDusk}
        alt=""
        aria-hidden
        priority
        placeholder="blur"
        sizes="(min-width: 1024px) 55vw, 0px"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-[66%] w-full object-cover object-top"
      />
      {/*
       * Three scrims, because one is never enough over a photograph with a sunset in it.
       *
       * Solid navy down to the headline so the type is on flat colour; a dark veil over the whole
       * image so the feature list keeps its contrast against cranes and lit windows; and navy back
       * up from the floor so the footer line does not land in the brightest part of the sky.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-nav via-nav/90 via-[38%] to-transparent"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-nav/55" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-56 bg-gradient-to-t from-nav via-nav/80 to-transparent"
      />

      {/* Accent bloom, anchored behind the headline */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/3 -z-10 size-[520px] rounded-full bg-accent/25 blur-[120px]"
        initial={{ opacity: 0.35, scale: 0.92 }}
        animate={
          reduceMotion
            ? { opacity: 0.35 }
            : { opacity: [0.3, 0.5, 0.3], scale: [0.92, 1.04, 0.92] }
        }
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <header className="flex items-center justify-between gap-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[11px] bg-accent text-[17px] font-bold leading-none text-white shadow-[0_6px_18px_rgba(108,76,224,0.45)]">
            B
          </span>
          <span className="text-[19px] font-bold tracking-[-0.01em] text-white">BUILDR</span>
        </div>

        <nav aria-label={t('What BUILDR covers')} className="flex items-center gap-2">
          {STAGES.map((stage, index) => (
            <span key={stage} className="flex items-center gap-2">
              {index > 0 && <span className="font-mono text-[12px] text-white/25">/</span>}
              <span
                className={
                  // The last one is where a builder is going, so it is the one that is lit.
                  index === STAGES.length - 1
                    ? 'border-b-[1.5px] border-accent-onDark pb-0.5 font-mono text-[12px] uppercase tracking-[0.16em] text-accent-onDark'
                    : 'font-mono text-[12px] uppercase tracking-[0.16em] text-white/45'
                }
              >
                {stage}
              </span>
            </span>
          ))}
        </nav>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex max-w-[560px] flex-col gap-7 py-10"
      >
        <span className="font-mono text-[12.5px] uppercase tracking-[0.22em] text-accent-onDark">
          {t('Site management for builders')}
        </span>

        <h1 className="text-[clamp(40px,4.4vw,60px)] font-bold leading-[1.04] tracking-[-0.03em] text-white">
          {t('Every site.')}
          <br />
          {t('Every day.')}
          <br />
          <span className="text-accent-onDark">{t('Every rupee.')}</span>
        </h1>

        <p className="max-w-[460px] text-[16px] leading-relaxed text-white/80">
          {t('Daily reports, named attendance and wage sheets — from the site to your screen before you finish your morning tea.')}
        </p>

        <ul className="flex flex-col gap-5 pt-2">
          {PROOF.map(({ icon: Icon, title, body }, index) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + index * 0.08, ease: EASE }}
              className="flex items-start gap-4"
            >
              <span className="flex size-11 flex-none items-center justify-center rounded-[13px] border border-white/10 bg-nav-card/80 backdrop-blur-sm">
                <Icon className="size-[18px] text-accent-onDark" />
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold text-white">{title}</span>
                <span className="max-w-[400px] text-[13.5px] leading-relaxed text-white/75">
                  {body}
                </span>
              </div>
            </motion.li>
          ))}
        </ul>
      </motion.div>

      <footer className="flex flex-col gap-3">
        <span aria-hidden className="h-px w-16 bg-accent/70" />
        <span className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-white/50">
          {t('Built for sites in India · ₹ in paise, never rounded')}
        </span>
      </footer>
    </section>
  );
}
