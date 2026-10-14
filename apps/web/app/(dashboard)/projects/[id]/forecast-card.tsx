'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { describeDriver, type ForecastDriver } from '@sitebook/shared';
import type { ForecastDriverView, SiteForecast } from '@/lib/api-types';
import { refreshForecast } from '@/lib/actions';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SEVERITY = {
  critical: { tone: 'blocked', label: 'Over budget' },
  warning: { tone: 'pending', label: 'At risk' },
  watch: { tone: 'neutral', label: 'Watch' },
  ok: { tone: 'done', label: 'On track' },
} as const;

const METHOD_NOTE = {
  progress: 'Projected from the milestones done so far.',
  burn_rate: 'Projected from the last four weeks of spending, carried to the handover date.',
  spend_only: 'Add a handover date or milestones to the site to get a forecast.',
} as const;

/**
 * Where this site's money is heading, and why (overrun early warning).
 *
 * Every figure on the card is one the owner can trace: spend comes from the roll calls and
 * expenses, the projection from milestones or the recent spending rate, and each reason names the
 * cost line or material behind it. When a language model reworded the sentence, the card says so —
 * the figures beneath are the ones it was given, so the wording can be checked against them.
 */
export function ForecastCard({
  forecast,
  projectId,
}: {
  forecast: SiteForecast;
  projectId: string;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const severity = SEVERITY[forecast.severity];

  function refresh() {
    start(async () => {
      const result = await refreshForecast(projectId);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not refresh the forecast'));
        return;
      }
      router.refresh();
    });
  }

  const over = forecast.overrun_pct !== null && forecast.overrun_pct > 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {over ? (
            <TrendingUp className="size-4 text-blocked-fg" />
          ) : (
            <TrendingDown className="size-4 text-done-fg" />
          )}
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Cost forecast')}
          </span>
          <Badge tone={severity.tone}>{t(severity.label)}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-faint">
            {t('As of')} {format.shortDate(forecast.as_of)}
          </span>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={pending}>
            <RefreshCw className={cn('size-3.5', pending && 'animate-spin')} />
            {t('Refresh')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[14.5px] leading-relaxed">{forecast.explanation}</p>
        {forecast.explained_by === 'ai' && (
          <span className="flex items-center gap-1 text-[11.5px] text-ink-faint">
            <Sparkles className="size-3" />
            {t('Worded by AI from the figures below')}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label={t('Spent so far')} value={format.moneyShort(forecast.spent)} />
        <Figure
          label={t('Forecast at end')}
          value={forecast.forecast ? format.moneyShort(forecast.forecast) : '—'}
          tone={over ? 'blocked' : undefined}
        />
        <Figure
          label={t('Budget')}
          value={forecast.budget ? format.moneyShort(forecast.budget) : '—'}
        />
        <Figure
          label={t('Work done')}
          value={forecast.progress_pct === null ? '—' : `${forecast.progress_pct}%`}
          note={
            forecast.elapsed_pct === null
              ? undefined
              : `${forecast.elapsed_pct}% ${t('of the time gone')}`
          }
        />
      </dl>

      {forecast.drivers.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
          {forecast.drivers.map((driver, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
              <span aria-hidden className="mt-[7px] size-1.5 flex-none rounded-full bg-ink-faint" />
              {describeDriver(toDriver(driver), format.settings)}
            </li>
          ))}
        </ul>
      )}

      <span className="text-[12px] text-ink-faint">{t(METHOD_NOTE[forecast.method])}</span>
    </Card>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'blocked';
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={cn(
          'font-mono text-[17px] font-semibold',
          tone === 'blocked' && 'text-blocked-fg',
        )}
      >
        {value}
      </dd>
      {note && <dd className="text-[11.5px] text-ink-muted">{note}</dd>}
    </div>
  );
}

/** Amounts cross the wire as strings; the shared wording wants them back as bigints. */
function toDriver(driver: ForecastDriverView): ForecastDriver {
  return driver.kind === 'spend_trend'
    ? { ...driver, recent: BigInt(driver.recent), previous: BigInt(driver.previous) }
    : driver;
}
