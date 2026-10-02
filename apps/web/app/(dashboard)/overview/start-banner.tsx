import Image from 'next/image';
import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import siteIllustration from '@/public/hero_bg.png';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n-server';

/**
 * The empty overview: an account with no sites yet.
 *
 * It replaces a one-line empty state, and the extra weight is deliberate. This screen is the first
 * thing a builder sees after signing up, when nothing in the product has any data in it and every
 * number above reads zero — the question it has to answer is "what do I do first", and a sentence
 * in a dashed box answers it less well than the order of work laid out.
 *
 * The checklist is static on purpose. Ticking items off as the account fills would make it a
 * progress tracker, which is a different and much larger thing; this is a table of contents.
 */

const WHAT_COMES_NEXT = [
  { label: 'Daily reports', done: true },
  { label: 'Worker attendance', done: false },
  { label: 'Wage processing', done: false },
  { label: 'Expense tracking', done: false },
  { label: 'Project documents', done: false },
];

export async function StartBanner() {
  const t = await getT();
  return (
    <section className="relative isolate overflow-hidden rounded-card border border-line bg-gradient-to-br from-accent-soft/50 via-surface to-surface">
      {/* The illustration bleeds off the right edge; at narrow widths it is dropped rather than
          squeezed, because a 2048px drawing at 300px wide is a smudge. */}
      <Image
        src={siteIllustration}
        alt=""
        aria-hidden
        priority
        sizes="(min-width: 1280px) 60vw, 0px"
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden h-full w-[62%] object-cover object-left xl:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 hidden bg-gradient-to-r from-surface via-surface/85 via-35% to-transparent xl:block"
      />

      <div className="flex flex-col gap-5 p-7 sm:p-9 xl:max-w-[54%]">
        <span className="w-fit rounded-full bg-neutral-bg px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
          {t('Sites')}
        </span>

        <h2 className="text-[clamp(26px,2.6vw,34px)] font-bold leading-[1.12] tracking-[-0.025em]">
          {t('Start managing')}
          <br />
          your <span className="text-accent">construction sites</span>
        </h2>

        <p className="max-w-[420px] text-[14.5px] leading-relaxed text-ink-soft">
          {t('Create your first project to start filing daily reports, attendance, expenses and more.')}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/projects">
              <Plus className="size-4" /> {t('Go to sites')}
            </Link>
          </Button>
        </div>

        {/* Below the fold of the illustration on narrow screens, beside it on wide ones. */}
        <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 xl:hidden">
          {WHAT_COMES_NEXT.map((step) => (
            <li key={t(step.label)} className="flex items-center gap-2 text-[13px] text-ink-soft">
              <Check className="size-3.5 text-ink-faint" />
              {t(step.label)}
            </li>
          ))}
        </ul>
      </div>

      <div className="pointer-events-none absolute right-8 top-1/2 hidden -translate-y-1/2 xl:block">
        <ul className="flex flex-col gap-3 rounded-card border border-line bg-surface/90 p-5 shadow-float backdrop-blur-sm">
          {WHAT_COMES_NEXT.map((step) => (
            <li key={t(step.label)} className="flex items-center gap-2.5 text-[13.5px]">
              <span
                className={
                  step.done
                    ? 'flex size-[18px] flex-none items-center justify-center rounded-full bg-done text-white'
                    : 'size-[18px] flex-none rounded-full border-[1.5px] border-line-strong'
                }
              >
                {step.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={step.done ? 'font-medium text-ink' : 'text-ink-muted'}>
                {t(step.label)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
