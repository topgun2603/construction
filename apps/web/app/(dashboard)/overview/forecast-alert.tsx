import Link from 'next/link';
import { ArrowRight, TrendingUp } from 'lucide-react';
import type { SiteForecast } from '@/lib/api-types';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';

/**
 * Sites heading over budget, with the reason in a sentence.
 *
 * Like the material alert beside it, this renders only when something is flagged: the overview is
 * an inbox of exceptions, and a card that says "all fine" every morning teaches people to skip it.
 * Worst first, so the site that has already spent its budget is the one read.
 */
export async function ForecastAlert({ forecasts }: { forecasts: SiteForecast[] }) {
  const t = await getT();
  const { moneyShort } = await getFormat();
  const flagged = forecasts
    .filter((forecast) => forecast.severity === 'critical' || forecast.severity === 'warning')
    .sort((a, b) => rank(b) - rank(a));
  if (flagged.length === 0) return null;

  return (
    <FadeIn delay={0.04}>
      <Card className="flex flex-col gap-3 p-4">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <TrendingUp className="size-3.5 text-blocked-fg" />
          {t('Heading over budget')}
        </span>

        <ul className="flex flex-col divide-y divide-line-soft">
          {flagged.slice(0, 4).map((forecast) => (
            <li
              key={forecast.project_id}
              className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/projects/${forecast.project_id}`}
                  className="flex items-center gap-1 text-[14px] font-semibold hover:underline"
                >
                  {forecast.project_name} <ArrowRight className="size-3.5 text-ink-muted" />
                </Link>
                <Badge tone={forecast.severity === 'critical' ? 'blocked' : 'pending'}>
                  {forecast.overrun_pct !== null && forecast.overrun_pct > 0
                    ? `${forecast.overrun_pct}% ${t('over')}`
                    : forecast.severity === 'critical'
                      ? t('Over budget')
                      : t('Behind')}
                </Badge>
              </div>
              <p className="text-[13.5px] leading-relaxed text-ink-soft">{forecast.explanation}</p>
              {forecast.forecast && forecast.budget && (
                <span className="font-mono text-[12px] text-ink-muted">
                  {moneyShort(forecast.forecast)} {t('forecast')} · {moneyShort(forecast.budget)}{' '}
                  {t('budget')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </FadeIn>
  );
}

function rank(forecast: SiteForecast): number {
  return (forecast.severity === 'critical' ? 1000 : 0) + (forecast.overrun_pct ?? 0);
}
