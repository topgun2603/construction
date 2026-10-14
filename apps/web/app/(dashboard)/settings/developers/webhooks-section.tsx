'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, RotateCw, Send, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import {
  WEBHOOK_EVENT_COPY,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_URL_PROBLEM_COPY,
  webhookUrlProblem,
  type WebhookEventType,
} from '@sitebook/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import {
  createWebhook,
  deleteWebhook,
  loadDeliveries,
  pingWebhook,
  resendDelivery,
  updateWebhook,
} from '@/lib/developer-actions';
import type {
  WebhookDeliveryOutcome,
  WebhookDeliveryView,
  WebhookEndpointView,
  WebhookList,
} from '@/lib/developer-types';
import { FormError, Notice, SecretOnce, useSubmit } from './developer-ui';

/**
 * Webhooks: https endpoints the company's systems listen on, the events each wants, and the log of
 * what was sent, what came back and how long it took — with "Send test event" and "Resend".
 */
export function WebhooksSection({ list }: { list: WebhookList }) {
  const { t } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; secret: string } | null>(null);

  return (
    <section aria-labelledby="webhooks-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="webhooks-heading" className="text-[17px] font-semibold">
            {t('Webhooks')}
          </h2>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
            {t('BUILDR posts each event to your https address, signed with the endpoint’s secret, and retries for about a day if your server does not answer. An endpoint that fails for a whole day is switched off and owners are told.')}
          </p>
        </div>
        {!creating && list.configured && (
          <Button type="button" className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('Add endpoint')}
          </Button>
        )}
      </header>

      {!list.configured && <Notice>{t('Webhooks are not set up on this server yet (WEBHOOK_ENCRYPTION_KEY). Ask whoever runs it.')}</Notice>}

      {fresh && <SecretOnce label={`${t('Signing secret')} · ${fresh.url}`} value={fresh.secret} onDone={() => setFresh(null)} />}

      {creating && (
        <NewEndpointForm
          onCancel={() => setCreating(false)}
          onCreated={(url, secret) => {
            setCreating(false);
            setFresh({ url, secret });
          }}
        />
      )}

      {list.endpoints.length === 0 ? (
        <Card>
          <p className="p-4 text-[13.5px] text-ink-muted">{t('No webhook endpoints yet.')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} endpoint={endpoint} />
          ))}
        </div>
      )}
    </section>
  );
}

function outcomeMessage(t: (english: string) => string, outcome: WebhookDeliveryOutcome | undefined): string {
  if (!outcome) return t('Sent');
  if (outcome.status === 'succeeded') return `${t('Delivered')} · HTTP ${outcome.status_code} · ${outcome.latency_ms} ms`;
  return `${t('Not delivered')} · ${outcome.status_code ? `HTTP ${outcome.status_code}` : (outcome.error ?? t('no answer'))}`;
}

function EndpointCard({ endpoint }: { endpoint: WebhookEndpointView }) {
  const { t } = useLanguage();
  const { relativeTime } = useFormat();
  const { pending, error, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const active = endpoint.status === 'active';

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Webhook className="size-4 flex-none text-ink-muted" />
              <code className="min-w-0 break-all font-mono text-[13px] font-semibold" dir="ltr">
                {endpoint.url}
              </code>
              {active ? (
                <Badge tone="done">{t('On')}</Badge>
              ) : (
                <Badge tone="blocked">{endpoint.disabled_reason === 'failing' ? t('Switched off: failing') : t('Switched off')}</Badge>
              )}
            </div>
            {endpoint.description && <span className="text-[13px] text-ink-soft">{endpoint.description}</span>}
            <div className="flex flex-wrap gap-1.5">
              {endpoint.events.map((event) => (
                <Badge key={event} tone="neutral" dot={false} title={t(WEBHOOK_EVENT_COPY[event as WebhookEventType] ?? event)}>
                  <span className="font-mono text-[11.5px]">{event}</span>
                </Badge>
              ))}
            </div>
            <span className="text-[12.5px] text-ink-muted">
              {[
                `${t('Secret ending')} …${endpoint.secret_last4}`,
                endpoint.last_success_at ? `${t('last delivered')} ${relativeTime(endpoint.last_success_at)}` : t('nothing delivered yet'),
                endpoint.consecutive_failures > 0 ? `${endpoint.consecutive_failures} ${t('failed tries in a row')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={pending}
              onClick={() =>
                run(
                  () => pingWebhook(endpoint.id),
                  null,
                  (outcome) => {
                    if (outcome?.status === 'succeeded') toast.success(outcomeMessage(t, outcome));
                    else toast.error(outcomeMessage(t, outcome));
                  },
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t('Send test event')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => updateWebhook(endpoint.id, { status: active ? 'disabled' : 'active' }),
                  active ? t('Endpoint switched off') : t('Endpoint switched on'),
                )
              }
            >
              {active ? t('Switch off') : t('Switch on')}
            </Button>
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive" size="sm">
                  {t('Remove')}
                </Button>
              }
              title={t('Remove this endpoint?')}
              body={`${endpoint.url} — ${t('nothing more is sent to it, and its delivery log is deleted.')}`}
              confirmLabel={t('Remove')}
              onConfirm={() => deleteWebhook(endpoint.id)}
              successMessage={t('Endpoint removed')}
            />
          </div>
        </div>
        <FormError error={error} />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 self-start text-[13px] font-medium text-accent"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
          {t('Delivery log')}
        </button>
        {open && <DeliveryLog endpointId={endpoint.id} canResend={active} />}
      </div>
    </Card>
  );
}

const STATUS_TONE: Record<WebhookDeliveryView['status'], Tone> = {
  succeeded: 'done',
  pending: 'pending',
  sending: 'pending',
  failed: 'blocked',
};

const STATUS_LABEL: Record<WebhookDeliveryView['status'], string> = {
  succeeded: 'Delivered',
  pending: 'Retrying',
  sending: 'Sending',
  failed: 'Failed',
};

function DeliveryLog({ endpointId, canResend }: { endpointId: string; canResend: boolean }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const [rows, setRows] = useState<WebhookDeliveryView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load(reset: boolean) {
    setError(null);
    start(async () => {
      const result = await loadDeliveries(endpointId, reset ? undefined : (cursor ?? undefined));
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not load the log.'));
        return;
      }
      setRows((current) => (reset || !current ? result.data!.data : [...current, ...result.data!.data]));
      setCursor(result.data.next_cursor);
    });
  }

  // The first page, when the log is opened.
  useEffect(() => {
    let cancelled = false;
    void loadDeliveries(endpointId).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not load the log.'));
        return;
      }
      setRows(result.data.data);
      setCursor(result.data.next_cursor);
    });
    return () => {
      cancelled = true;
    };
  }, [endpointId, t]);

  async function resend(id: string) {
    const result = await resendDelivery(id);
    if (!result.ok) {
      toast.error(result.error ?? t('That did not work. Try again.'));
      return;
    }
    if (result.data?.status === 'succeeded') toast.success(outcomeMessage(t, result.data));
    else toast.error(outcomeMessage(t, result.data));
    load(true);
  }

  const when = (iso: string) => `${instantDate(iso)} ${timeOfDay(iso)}`;

  return (
    <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-ink-muted">{t('Newest first. Each try shows what your server answered and how long it took.')}</span>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={loading} onClick={() => load(true)}>
          <RotateCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {t('Refresh')}
        </Button>
      </div>
      <FormError error={error} />
      {rows !== null && rows.length === 0 && <p className="text-[13px] text-ink-muted">{t('Nothing has been sent to this endpoint yet.')}</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-soft rounded-btn border border-line-soft">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  className="flex items-center gap-1 text-ink-muted"
                  aria-expanded={expanded === row.id}
                  aria-label={t('Show tries')}
                >
                  {expanded === row.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
                </button>
                <code className="font-mono text-[12.5px] font-medium">{row.event.type}</code>
                <Badge tone={STATUS_TONE[row.status]}>{t(STATUS_LABEL[row.status])}</Badge>
                <span className="text-[12.5px] text-ink-muted">
                  {[
                    when(row.created_at),
                    `${row.attempt_count}/${row.max_attempts} ${t('tries')}`,
                    row.last_status_code ? `HTTP ${row.last_status_code}` : row.last_error,
                    row.last_latency_ms !== null ? `${row.last_latency_ms} ms` : null,
                    row.next_attempt_at ? `${t('next try')} ${when(row.next_attempt_at)}` : null,
                    row.resend_of_id ? t('resent') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {canResend && row.status !== 'pending' && row.status !== 'sending' && row.event.type !== 'webhook.ping' && (
                  <Button type="button" variant="ghost" size="sm" className="ms-auto" onClick={() => void resend(row.id)}>
                    {t('Resend')}
                  </Button>
                )}
              </div>
              {expanded === row.id && (
                <div className="flex flex-col gap-1.5 ps-6">
                  <span className="text-[12px] text-ink-muted">
                    {t('Event')} <code className="font-mono">{row.event.id}</code>
                  </span>
                  {row.attempts.map((attempt) => (
                    <div key={attempt.attempt} className="flex flex-col gap-1 rounded-btn bg-raised px-2.5 py-2 text-[12.5px]">
                      <span className={attempt.ok ? 'text-done-fg' : 'text-blocked-fg'}>
                        {`#${attempt.attempt} · ${when(attempt.created_at)} · ${
                          attempt.status_code ? `HTTP ${attempt.status_code}` : t('no answer')
                        } · ${attempt.latency_ms} ms`}
                        {attempt.error && !attempt.status_code ? ` · ${attempt.error}` : ''}
                      </span>
                      {attempt.response_snippet && (
                        <code className="max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-ink-muted" dir="ltr">
                          {attempt.response_snippet}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button type="button" variant="ghost" size="sm" className="self-start" disabled={loading} onClick={() => load(false)}>
          {t('Older deliveries')}
        </Button>
      )}
    </div>
  );
}

function NewEndpointForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (url: string, secret: string) => void }) {
  const { t } = useLanguage();
  const { pending, error, run, setError } = useSubmit();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // The same first check the API makes, so an http:// or a private address is caught as it is
    // typed. The API also resolves the name and checks every address — the rule that matters.
    const problem = webhookUrlProblem(url.trim());
    if (problem) {
      setError(t(WEBHOOK_URL_PROBLEM_COPY[problem]));
      return;
    }
    run(
      () => createWebhook({ url: url.trim(), description: description.trim() || undefined, events }),
      t('Endpoint added'),
      (data) => {
        if (data) onCreated(data.endpoint.url, data.secret);
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Add endpoint')}</CardTitle>
        <CardDescription>{t('A public https address on your server. Private, local and internal addresses are refused.')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-line-soft p-4">
        <Field label={t('Address')} htmlFor="hook-url">
          <Input
            id="hook-url"
            type="url"
            inputMode="url"
            dir="ltr"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/buildr/webhooks"
            required
          />
        </Field>
        <Field label={t('Description (optional)')} htmlFor="hook-description">
          <Input id="hook-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13.5px] font-semibold">{t('Events')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((type) => {
              const id = `event-${type.replace('.', '-')}`;
              return (
                <label key={type} htmlFor={id} className="flex items-start gap-2.5">
                  <input
                    id={id}
                    type="checkbox"
                    checked={events.includes(type)}
                    onChange={(change) =>
                      setEvents((current) => (change.target.checked ? [...current, type] : current.filter((value) => value !== type)))
                    }
                    className="mt-0.5 size-4 flex-none accent-accent"
                  />
                  <span className="flex flex-col">
                    <span className="text-[13.5px] font-medium">{t(WEBHOOK_EVENT_COPY[type])}</span>
                    <code className="font-mono text-[11.5px] text-ink-muted">{type}</code>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <FormError error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !url.trim() || events.length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('Add endpoint')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {t('Cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
