'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AI_FEATURES, AI_REGIONS, type AiFeature, type AiRegion } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/components/language-provider';
import { aiOffMessage } from '@/components/ai-features';
import { deleteAiData, reindexDocuments, saveAiSettings } from '@/lib/ai-actions';
import type { AiSettingsView } from '@/lib/ai-types';

/** What each switch covers, in the words an owner would use. Wrapped in `t()` where shown. */
const FEATURE_COPY: Record<AiFeature, { label: string; hint: string }> = {
  assistant: {
    label: 'Assistant and questions',
    hint: 'The Ask box: questions about your own spend, wages, headcount and materials.',
  },
  documents: {
    label: 'Documents (drawing brain)',
    hint: 'Asking your drawings and documents, and reading their text into a searchable index. Off also stops new documents being indexed.',
  },
  reading: {
    label: 'Reading photos and bills',
    hint: 'Scanning a bill or receipt, an hour-meter photo or a fuel slip into a draft.',
  },
  voice: {
    label: 'Voice notes',
    hint: 'Turning a recording into a daily report, snag or safety observation.',
  },
  translation: {
    label: 'Translation',
    hint: 'The translate panel under notes written in two languages.',
  },
  suggestions: {
    label: 'Smart suggestions',
    hint: 'A model’s first guess for snags and safety observations, RFI drafting, the extra-work check on messages, and forecast wording.',
  },
};

const REGION_COPY: Record<AiRegion, string> = {
  default: 'Provider default',
  eu: 'Europe (EU)',
  us: 'United States',
};

/**
 * Settings → Security → AI and data: what company data may go to an AI provider, where, and how
 * often it has. Owner only, like the rest of the page. The API enforces every switch here — the
 * buttons elsewhere hide themselves as a courtesy.
 */
export function AiSection({ settings }: { settings: AiSettingsView }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="ai-data-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="ai-data-heading" className="text-[17px] font-semibold">
          {t('AI and data')}
        </h2>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {t('Choose which AI features may send your company’s data to an AI provider. Typing things in by hand and the keyword-based suggestions are not AI and always keep working. Every change is recorded in the audit log.')}
        </p>
      </header>
      <SwitchesCard settings={settings} />
      <ProviderCard settings={settings} />
      <UsageCard settings={settings} />
      <StoredDataCard settings={settings} />
    </section>
  );
}

// --- shared bits -----------------------------------------------------------------------------------

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
      {children}
    </p>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

// --- the switches and the region -------------------------------------------------------------------

function SwitchesCard({ settings }: { settings: AiSettingsView }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(settings.settings.enabled);
  const [features, setFeatures] = useState(settings.settings.features);
  const [region, setRegion] = useState<AiRegion>(settings.settings.region);
  const platformAll = settings.deployment.platform_disabled.includes('all');

  function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveAiSettings({ enabled, features, region });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('AI settings saved'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('AI features')}</CardTitle>
          {!settings.deployment.configured ? (
            <Badge tone="neutral">{t('Not set up on this server')}</Badge>
          ) : settings.settings.enabled ? (
            <Badge tone="done">{t('On')}</Badge>
          ) : (
            <Badge tone="blocked">{t('Off for your company')}</Badge>
          )}
        </div>
        <CardDescription>
          {t('Turning a feature off hides its buttons for everyone in the company and stops anything being sent for it, including background work.')}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSave} className="flex flex-col gap-4 border-t border-line-soft p-4">
        {!settings.deployment.configured && (
          <Notice>
            {t('AI is not set up on this server (no provider key), so nothing is sent anywhere whatever you choose here. Your choices are kept and apply if it is set up later.')}
          </Notice>
        )}
        {settings.deployment.platform_disabled.length > 0 && (
          <Notice>
            {platformAll
              ? t('The server operator has turned AI off for every company.')
              : t('The server operator has turned some AI features off for every company. They are marked below.')}
          </Notice>
        )}

        <label htmlFor="ai-master" className="flex items-start gap-3">
          <input
            id="ai-master"
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-0.5 size-4 flex-none accent-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold">{t('AI features on')}</span>
            <span className="text-[12.5px] leading-relaxed text-ink-muted">
              {t('The master switch. Off turns every feature below off at once, whatever each one says.')}
            </span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-3 border-s-2 border-line-soft ps-4" disabled={!enabled}>
          <legend className="sr-only">{t('Features')}</legend>
          {AI_FEATURES.map((feature) => {
            const offOnServer = platformAll || settings.deployment.platform_disabled.includes(feature);
            const id = `ai-feature-${feature}`;
            return (
              <label key={feature} htmlFor={id} className={`flex items-start gap-3 ${enabled ? '' : 'opacity-60'}`}>
                <input
                  id={id}
                  type="checkbox"
                  checked={features[feature]}
                  onChange={(event) => setFeatures({ ...features, [feature]: event.target.checked })}
                  className="mt-0.5 size-4 flex-none accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {t(FEATURE_COPY[feature].label)}
                    {offOnServer && <Badge tone="neutral">{t('Off on this server')}</Badge>}
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-ink-muted">{t(FEATURE_COPY[feature].hint)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-[14px] font-semibold">{t('Where AI requests are sent')}</legend>
          {AI_REGIONS.map((option) => {
            const available = settings.deployment.regions[option];
            const id = `ai-region-${option}`;
            return (
              <label key={option} htmlFor={id} className={`flex items-start gap-3 ${available ? '' : 'opacity-60'}`}>
                <input
                  id={id}
                  type="radio"
                  name="ai-region"
                  value={option}
                  checked={region === option}
                  disabled={!available}
                  onChange={() => setRegion(option)}
                  className="mt-0.5 size-4 flex-none accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium">{t(REGION_COPY[option])}</span>
                  <span className="text-[12.5px] leading-relaxed text-ink-muted">
                    {option === 'default'
                      ? t('The provider’s standard endpoint.')
                      : available
                        ? t('A regional endpoint configured on this server.')
                        : t('Unavailable: this server has no endpoint for this region.')}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <FormError error={error} />
        <Button type="submit" disabled={pending} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

// --- provider and region transparency --------------------------------------------------------------

function ProviderCard({ settings }: { settings: AiSettingsView }) {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Provider')}</CardTitle>
        <CardDescription>
          {t('AI requests go to')} {settings.deployment.provider}
          {'. '}
          {t('Data sent through its API is not used to train its models, under the provider’s API data-usage terms.')}{' '}
          <a
            href="https://openai.com/policies/api-data-usage-policies"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
          >
            {t('OpenAI API data usage policy')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </CardDescription>
      </CardHeader>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-line-soft p-4 text-[13px] sm:grid-cols-2">
        {AI_FEATURES.map((feature) => {
          const off = aiOffMessage(settings.states[feature], t);
          return (
            <div key={feature} className="flex flex-col gap-0.5">
              <dt className="font-medium">{t(FEATURE_COPY[feature].label)}</dt>
              <dd className="text-ink-muted">
                {settings.deployment.models[feature].join(' · ')}
                {off ? ` — ${off}` : ''}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

// --- usage -----------------------------------------------------------------------------------------

function UsageCard({ settings }: { settings: AiSettingsView }) {
  const { t } = useLanguage();
  const { usage } = settings;
  const byDay = new Map<string, number>();
  for (const row of usage.rows) byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.calls);
  const days = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  const total = days.reduce((sum, [, calls]) => sum + calls, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Usage')}</CardTitle>
          <Badge tone="neutral" dot={false}>
            {`${total} ${t('requests')} · ${usage.days} ${t('days')}`}
          </Badge>
        </div>
        <CardDescription>
          {t('How many requests each feature sent to the provider over the last 30 days. Only the count is kept — never what was sent.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-start text-[12px] text-ink-muted">
              <th className="pb-1.5 text-start font-medium">{t('Feature')}</th>
              <th className="pb-1.5 text-end font-medium">{t('Requests')}</th>
            </tr>
          </thead>
          <tbody>
            {AI_FEATURES.map((feature) => (
              <tr key={feature} className="border-t border-line-soft">
                <td className="py-1.5">{t(FEATURE_COPY[feature].label)}</td>
                <td className="py-1.5 text-end tabular-nums">{usage.totals[feature]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {days.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-medium text-ink-muted">{t('By day')}</p>
            <ul className="flex flex-wrap gap-1.5">
              {days.map(([day, calls]) => (
                <li key={day} className="rounded-btn bg-neutral-bg px-2 py-1 text-[12px] tabular-nums text-neutral-fg">
                  {`${day} · ${calls}`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t('No AI requests in the last 30 days.')}</p>
        )}
      </div>
    </Card>
  );
}

// --- stored data -----------------------------------------------------------------------------------

function StoredDataCard({ settings }: { settings: AiSettingsView }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { documents } = settings;
  // Indexing stops only when somebody switched Documents off, not when the server has no key.
  const indexingOff =
    settings.states.documents === 'off_company' || settings.states.documents === 'off_platform';

  function reindex() {
    setError(null);
    start(async () => {
      const result = await reindexDocuments();
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(`${result.data?.queued ?? 0} ${t('documents queued for reading')}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Stored AI data')}</CardTitle>
        <CardDescription>
          {t('To answer questions about your documents, their text is read into a searchable index. Deleting it removes the index only — your documents, reports and records stay exactly as they are.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        <p className="text-[13px]">
          {`${documents.indexed_documents} ${t('documents indexed')} · ${documents.chunks} ${t('stored pieces of text')}`}
          {documents.unindexed_documents > 0 && ` · ${documents.unindexed_documents} ${t('not yet indexed')}`}
        </p>
        {indexingOff && (
          <Notice>{t('Documents is turned off, so new documents are not being indexed. Turn it back on to re-index them.')}</Notice>
        )}
        <FormError error={error} />
        <div className="flex flex-wrap gap-2">
          {documents.unindexed_documents > 0 && !indexingOff && (
            <Button type="button" variant="secondary" disabled={pending} onClick={reindex} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t('Re-index documents')}
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button type="button" variant="destructive" className="gap-2" disabled={documents.chunks === 0}>
                <Trash2 className="size-4" />
                {t('Delete stored AI data')}
              </Button>
            }
            title={t('Delete stored AI data?')}
            body={t('The searchable text of every document is deleted. Asking the documents will find nothing until they are re-indexed. Nothing else is touched.')}
            confirmLabel={t('Delete')}
            onConfirm={deleteAiData}
            successMessage={t('Stored AI data deleted')}
          />
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {t('Kept, because people rely on them as records: what a voice note said on a snag or safety observation, forecast wording, and suggestions someone has acted on.')}
        </p>
      </div>
    </Card>
  );
}
