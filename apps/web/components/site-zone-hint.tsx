'use client';

import { Clock } from 'lucide-react';
import { siteTimeZoneHint } from '@sitebook/shared';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { cn } from '@/lib/utils';

/**
 * A small "Dubai · GMT+4" beside a site whose clock is not the company's (a separate time zone per
 * site). Renders nothing for a site on the company's zone — which is nearly all of them, and a hint
 * on every card would be noise.
 */
export function SiteZoneHint({
  zone,
  className,
}: {
  /** The site's own zone; null or the company's own renders nothing. */
  zone: string | null | undefined;
  className?: string;
}) {
  const { settings } = useFormat();
  const { t } = useLanguage();
  if (!zone || zone === settings.timezone) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-neutral-bg px-2 py-0.5 text-[11.5px] font-medium text-neutral-fg',
        className,
      )}
      title={t('This site keeps its own time zone')}
    >
      <Clock className="size-3" />
      <span dir="ltr">{siteTimeZoneHint(zone)}</span>
    </span>
  );
}
