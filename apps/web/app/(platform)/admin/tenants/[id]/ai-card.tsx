import { AI_FEATURES, type AiFeature, type AiFeatureStates } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getT } from '@/lib/i18n-server';

/** `GET /admin/tenants/:id/ai`. */
export interface PlatformTenantAi {
  deployment: { configured: boolean; platform_disabled: string[]; regions: Record<string, boolean> };
  settings: { enabled: boolean; disabled_features: string[]; region: string; updated_at: string | null };
  states: AiFeatureStates;
  usage: { days: number; totals: Record<AiFeature, number> };
}

const LABELS: Record<AiFeature, string> = {
  assistant: 'Assistant and questions',
  documents: 'Documents (drawing brain)',
  reading: 'Reading photos and bills',
  voice: 'Voice notes',
  translation: 'Translation',
  suggestions: 'Smart suggestions',
};

const STATE_LABEL: Record<string, string> = {
  on: 'On',
  off_company: 'Off (company)',
  off_platform: 'Off (server)',
  not_configured: 'Not set up',
  region_unavailable: 'Region unavailable',
};

/**
 * A company's AI switches and the last 30 days of usage, read-only.
 *
 * The console does not change these — they are the owner's decision, and their audit trail should
 * only show the company's own people. The server-wide kill switch is `AI_DISABLED_FEATURES`.
 */
export async function TenantAiCard({ ai }: { ai: PlatformTenantAi }) {
  const t = await getT();
  return (
    <Card className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('AI and data')}</span>
        <span className="flex flex-wrap gap-2">
          <Badge tone={ai.settings.enabled ? 'done' : 'blocked'}>
            {ai.settings.enabled ? t('AI on') : t('AI off for this company')}
          </Badge>
          <Badge tone="neutral" dot={false}>
            {`${t('Region')}: ${ai.settings.region}`}
          </Badge>
          {!ai.deployment.configured && <Badge tone="neutral">{t('Not set up on this server')}</Badge>}
        </span>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[12px] text-ink-muted">
            <th className="pb-1.5 text-start font-medium">{t('Feature')}</th>
            <th className="pb-1.5 text-start font-medium">{t('State')}</th>
            <th className="pb-1.5 text-end font-medium">{`${t('Requests')} · ${ai.usage.days} ${t('days')}`}</th>
          </tr>
        </thead>
        <tbody>
          {AI_FEATURES.map((feature) => (
            <tr key={feature} className="border-t border-line-soft">
              <td className="py-1.5">{t(LABELS[feature])}</td>
              <td className="py-1.5 text-ink-muted">{t(STATE_LABEL[ai.states[feature]] ?? ai.states[feature])}</td>
              <td className="py-1.5 text-end tabular-nums">{ai.usage.totals[feature] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ai.deployment.platform_disabled.length > 0 && (
        <p className="text-[12.5px] text-ink-muted">
          {`${t('Turned off on this server (AI_DISABLED_FEATURES)')}: ${ai.deployment.platform_disabled.join(', ')}`}
        </p>
      )}
    </Card>
  );
}
