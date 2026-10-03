import Image from 'next/image';
import { longDate, todayIso } from '@/lib/format';

/**
 * The day, over the site.
 *
 * Everything else on this page is a figure. Opening with a photograph of a building under a crane
 * is what makes the figures underneath read as a summary of a place rather than as a wall of
 * numbers — and it is the one thing on the screen that says what this product is *about* to
 * somebody who has just been given a login and does not yet know.
 *
 * The same photograph the phone opens with, so the two halves of the product are recognisably one.
 */
export function OverviewBanner({
  name,
  siteCount,
  headcount,
}: {
  name: string;
  siteCount: number;
  headcount: number;
}) {
  const first = name.trim().split(' ')[0] ?? '';
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="relative overflow-hidden rounded-panel">
      <Image
        src="/illustrations/photo_site_hero.webp"
        alt=""
        aria-hidden
        width={1400}
        height={700}
        priority
        className="h-[150px] w-full object-cover sm:h-[170px]"
      />
      {/*
        Darkened, not washed out. The sign-in hero is pale artwork under dark type, so that one
        opens the gap by lightening; this is a bright midday sky under white type, so it opens the
        other way. Stronger on the left, where the words are.
      */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/55 to-ink/20" />
      <div className="absolute inset-0 flex flex-col justify-center gap-0.5 px-6">
        <span className="text-[13px] text-white/70">{part},</span>
        <span className="text-[24px] font-bold leading-tight text-white">{first}</span>
        <span className="text-[12.5px] text-white/70">
          {longDate(todayIso())} · {siteCount} {siteCount === 1 ? 'site' : 'sites'} ·{' '}
          {headcount} on site today
        </span>
      </div>
    </div>
  );
}
