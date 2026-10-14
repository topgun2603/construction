'use client';

import { useState, type FormEvent } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { PUBLIC_API_SCOPES, PUBLIC_API_SCOPE_COPY, type PublicApiScope } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { createApiKey, revokeApiKey } from '@/lib/developer-actions';
import type { ApiKeyList, ApiKeyView } from '@/lib/developer-types';
import { FormError, Notice, SecretOnce, useSubmit } from './developer-ui';

/** Expiry choices, in days; `0` is "never". */
const EXPIRY_DAYS = [0, 30, 90, 180, 365] as const;

/**
 * API keys: make one with exactly the scopes an integration needs, see when each was last used,
 * revoke one that leaked or is no longer needed.
 */
export function ApiKeysSection({ list }: { list: ApiKeyList }) {
  const { t } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  const live = list.keys.filter((key) => key.state !== 'revoked');
  const revoked = list.keys.filter((key) => key.state === 'revoked');

  return (
    <section aria-labelledby="api-keys-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="api-keys-heading" className="text-[17px] font-semibold">
            {t('API keys')}
          </h2>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
            {t('A key acts for the company, not for a person, and can do only what its scopes allow. Your IP allow-list in Security applies to every key.')}
          </p>
        </div>
        {!creating && list.configured && (
          <Button type="button" className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('New API key')}
          </Button>
        )}
      </header>

      {!list.configured && <Notice>{t('API keys are not set up on this server yet (API_KEY_PEPPER). Ask whoever runs it.')}</Notice>}

      {fresh && (
        <SecretOnce label={`${t('API key')} · ${fresh.name}`} value={fresh.secret} onDone={() => setFresh(null)} />
      )}

      {creating && (
        <NewKeyForm
          onCancel={() => setCreating(false)}
          onCreated={(name, secret) => {
            setCreating(false);
            setFresh({ name, secret });
          }}
        />
      )}

      <Card>
        {live.length === 0 ? (
          <p className="p-4 text-[13.5px] text-ink-muted">{t('No API keys yet.')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {live.map((key) => (
              <KeyRow key={key.id} apiKey={key} />
            ))}
          </ul>
        )}
      </Card>

      {revoked.length > 0 && (
        <details className="text-[13px] text-ink-muted">
          <summary className="cursor-pointer select-none">
            {t('Revoked keys')} ({revoked.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 ps-4">
            {revoked.map((key) => (
              <li key={key.id}>
                {key.name} · <span className="font-mono">{key.hint}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKeyView }) {
  const { t } = useLanguage();
  const { instantDate, relativeTime } = useFormat();
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="size-4 flex-none text-ink-muted" />
          <span className="text-[14px] font-semibold">{apiKey.name}</span>
          <code className="font-mono text-[12.5px] text-ink-muted">{apiKey.hint}</code>
          {apiKey.state === 'expired' ? (
            <Badge tone="blocked">{t('Expired')}</Badge>
          ) : (
            <Badge tone="done">{t('Active')}</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {apiKey.scopes.map((scope) => (
            <Badge key={scope} tone="neutral" dot={false} title={scope}>
              {t(PUBLIC_API_SCOPE_COPY[scope as PublicApiScope] ?? scope)}
            </Badge>
          ))}
        </div>
        <span className="text-[12.5px] text-ink-muted">
          {[
            apiKey.created_by.name ? `${t('Made by')} ${apiKey.created_by.name}` : null,
            `${t('made')} ${instantDate(apiKey.created_at)}`,
            apiKey.expires_at ? `${t('expires')} ${instantDate(apiKey.expires_at)}` : t('never expires'),
            apiKey.last_used_at
              ? `${t('last used')} ${relativeTime(apiKey.last_used_at)}${apiKey.last_used_ip ? ` ${t('from')} ${apiKey.last_used_ip}` : ''}`
              : t('never used'),
            apiKey.allowed_cidrs.length > 0 ? `${t('only from')} ${apiKey.allowed_cidrs.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive" size="sm">
            {t('Revoke')}
          </Button>
        }
        title={t('Revoke this API key?')}
        body={`${apiKey.name} (${apiKey.hint}) — ${t('anything using it stops working on its next request. This cannot be undone.')}`}
        confirmLabel={t('Revoke')}
        onConfirm={() => revokeApiKey(apiKey.id)}
        successMessage={t('API key revoked')}
      />
    </li>
  );
}

function NewKeyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string, secret: string) => void }) {
  const { t } = useLanguage();
  const { pending, error, run } = useSubmit();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<PublicApiScope[]>([]);
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [cidrs, setCidrs] = useState('');

  function toggle(scope: PublicApiScope, on: boolean) {
    setScopes((current) => (on ? [...current, scope] : current.filter((value) => value !== scope)));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const allowed = cidrs
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const expires = expiryDays > 0 ? new Date(Date.now() + expiryDays * 86_400_000).toISOString() : null;
    run(
      () => createApiKey({ name, scopes, expires_at: expires, allowed_cidrs: allowed }),
      t('API key made'),
      (data) => {
        if (data) onCreated(data.key.name, data.secret);
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('New API key')}</CardTitle>
        <CardDescription>{t('Give it only the scopes the integration needs. You can always make another.')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-line-soft p-4">
        <Field label={t('Name')} htmlFor="key-name">
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('e.g. Tally sync')}
            maxLength={80}
            required
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13.5px] font-semibold">{t('Scopes')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PUBLIC_API_SCOPES.map((scope) => {
              const id = `scope-${scope.replace(':', '-')}`;
              return (
                <label key={scope} htmlFor={id} className="flex items-start gap-2.5">
                  <input
                    id={id}
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) => toggle(scope, event.target.checked)}
                    className="mt-0.5 size-4 flex-none accent-accent"
                  />
                  <span className="flex flex-col">
                    <span className="text-[13.5px] font-medium">{t(PUBLIC_API_SCOPE_COPY[scope])}</span>
                    <code className="font-mono text-[11.5px] text-ink-muted">{scope}</code>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Expires')} htmlFor="key-expiry">
            <select
              id="key-expiry"
              value={expiryDays}
              onChange={(event) => setExpiryDays(Number(event.target.value))}
              className="h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[13.5px]"
            >
              {EXPIRY_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? t('Never') : `${days} ${t('days')}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Only from these addresses (optional)')} htmlFor="key-cidrs">
            <Input
              id="key-cidrs"
              value={cidrs}
              onChange={(event) => setCidrs(event.target.value)}
              placeholder="203.0.113.0/24, 198.51.100.7"
              dir="ltr"
            />
          </Field>
        </div>

        <FormError error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !name.trim() || scopes.length === 0}>
            {t('Make key')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {t('Cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
