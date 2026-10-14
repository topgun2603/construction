'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, Loader2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { M365_EMAIL_KIND_LABELS, M365_SETUP_STEPS } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { disconnectM365, setM365CalendarSync, startM365Connect, syncM365Calendar } from '@/lib/m365-actions';
import type { M365Overview } from '@/lib/m365-types';

function Notice({ children, tone = 'pending' }: { children: ReactNode; tone?: 'pending' | 'blocked' | 'done' }) {
  const colours = {
    pending: 'border-pending-line bg-pending-bg text-pending-fg',
    blocked: 'border-transparent bg-blocked-bg text-blocked-fg',
    done: 'border-transparent bg-done-bg text-done-fg',
  }[tone];
  return <div className={`rounded-btn border px-3.5 py-2.5 text-[13px] leading-relaxed ${colours}`}>{children}</div>;
}

/**
 * Settings → Integrations → Microsoft 365: connect the mailbox the company sends from, see which one
 * it is, switch the calendar sync on, and disconnect. Connecting leaves for Microsoft's sign-in page
 * and comes back through /settings/integrations/microsoft/callback.
 */
export function M365Card({ overview, justConnected }: { overview: M365Overview; justConnected: boolean }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { deployment, connection } = overview;

  function connect(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    start(async () => {
      const result = await startM365Connect(hint.trim() || undefined);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not start connecting. Try again.'));
        return;
      }
      // Off to Microsoft: their sign-in and consent page, then back to the callback page.
      window.location.href = result.data.redirect_url;
    });
  }

  function toggleCalendar(on: boolean) {
    start(async () => {
      const result = await setM365CalendarSync(on);
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      toast.success(on ? t('Calendar sync is on') : t('Calendar sync is off and its events were removed'));
      router.refresh();
    });
  }

  function syncNow() {
    start(async () => {
      const result = await syncM365Calendar();
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      const { created, updated, removed, failed } = result.data.sync;
      toast.success(
        `${t('Calendar up to date')}: ${created} ${t('added')}, ${updated} ${t('updated')}, ${removed} ${t('removed')}${failed ? `, ${failed} ${t('failed')}` : ''}`,
      );
      router.refresh();
    });
  }

  const badge = !deployment.configured ? (
    <Badge tone="neutral">{t('Not set up on this server')}</Badge>
  ) : !connection ? (
    <Badge tone="neutral">{t('Not connected')}</Badge>
  ) : connection.status === 'connected' ? (
    <Badge tone="done">{t('Connected')}</Badge>
  ) : (
    <Badge tone="blocked">{t('Needs reconnecting')}</Badge>
  );

  return (
    <section aria-labelledby="m365-heading" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              <span id="m365-heading" className="inline-flex items-center gap-2">
                <Mail className="size-4" aria-hidden />
                {t('Microsoft 365')}
              </span>
            </CardTitle>
            {badge}
          </div>
          <CardDescription>
            {t('Send RFIs, submittals, change orders and meeting minutes from your own mailbox — projects@yourcompany.com, say — and put site meetings in its Outlook calendar. Without it, everything still goes by WhatsApp, your mail app or a copied link.')}
          </CardDescription>
        </CardHeader>

        <div className="flex flex-col gap-4 border-t border-line-soft p-4">
          {justConnected && connection?.status === 'connected' && (
            <Notice tone="done">
              {t('Connected. Emails now go out from')} <span dir="ltr">{connection.mailbox_email}</span>.
            </Notice>
          )}

          {!deployment.configured && (
            <Notice>
              <p className="font-semibold">{t('Microsoft 365 is not set up on this server yet.')}</p>
              <p className="mt-1">
                {t('Whoever runs the server registers one app in Microsoft Entra and sets')}{' '}
                <span dir="ltr" className="font-mono text-[12px]">
                  {deployment.missing.join(', ')}
                </span>
                .
              </p>
              <ol className="mt-2 list-decimal space-y-1 ps-5">
                {M365_SETUP_STEPS.map((step) => (
                  <li key={step}>{t(step)}</li>
                ))}
              </ol>
            </Notice>
          )}

          {connection && (
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-ink-muted">{t('Sending as')}</dt>
              <dd>
                <span dir="ltr" className="font-semibold">
                  {connection.mailbox_email}
                </span>
                {connection.mailbox_name && <span className="text-ink-muted"> · {connection.mailbox_name}</span>}
              </dd>
              <dt className="text-ink-muted">{t('Connected')}</dt>
              <dd>
                {instantDate(connection.connected_at)}
                {connection.connected_by && <span className="text-ink-muted"> · {connection.connected_by.name}</span>}
              </dd>
              <dt className="text-ink-muted">{t('Permissions')}</dt>
              <dd className="flex flex-wrap gap-1.5" dir="ltr">
                {connection.scopes
                  .filter((scope) => ['Mail.Send', 'Calendars.ReadWrite', 'User.Read'].includes(scope))
                  .map((scope) => (
                    <Badge key={scope} tone="neutral">
                      {scope}
                    </Badge>
                  ))}
              </dd>
              {connection.last_used_at && (
                <>
                  <dt className="text-ink-muted">{t('Last used')}</dt>
                  <dd>
                    {instantDate(connection.last_used_at)}, {timeOfDay(connection.last_used_at)}
                  </dd>
                </>
              )}
            </dl>
          )}

          {connection?.status === 'needs_reconnect' && (
            <Notice tone="blocked">
              <p className="font-semibold">{t('Microsoft stopped accepting this connection.')}</p>
              <p className="mt-1">
                {t('A password change, removed consent or a disabled account does this. Connect again to carry on; emails fall back to WhatsApp and copied links meanwhile.')}
              </p>
              {connection.last_error && (
                <p className="mt-1 font-mono text-[12px]" dir="ltr">
                  {connection.last_error}
                </p>
              )}
            </Notice>
          )}

          {deployment.configured && (!connection || connection.status === 'needs_reconnect') && (
            <form onSubmit={connect} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field
                label={t('Mailbox to send from')}
                optional
                htmlFor="m365-hint"
                hint={t('A shared mailbox such as projects@ works best. Microsoft asks you to sign in as it.')}
                className="sm:max-w-sm sm:flex-1"
              >
                <Input
                  id="m365-hint"
                  type="email"
                  dir="ltr"
                  value={hint}
                  placeholder="projects@yourcompany.com"
                  onChange={(event) => setHint(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={pending} className="gap-2 self-start sm:self-auto">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {connection ? t('Connect again') : t('Connect Microsoft 365')}
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
              {error}
            </p>
          )}

          {connection && (
            <div className="flex flex-wrap items-center gap-2">
              {connection.status === 'connected' && (
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => connect()} className="gap-2">
                  <RefreshCw className="size-4" />
                  {t('Switch mailbox')}
                </Button>
              )}
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" className="gap-2">
                    <Unplug className="size-4" />
                    {t('Disconnect')}
                  </Button>
                }
                title={t('Disconnect Microsoft 365?')}
                body={t('The stored sign-in is deleted and events the calendar sync added are removed. Emails fall back to WhatsApp, your mail app and copied links. To remove the app on Microsoft’s side as well, remove it in Entra admin centre → Enterprise applications.')}
                confirmLabel={t('Disconnect')}
                onConfirm={disconnectM365}
                successMessage={t('Microsoft 365 disconnected')}
              />
            </div>
          )}
        </div>
      </Card>

      {connection?.status === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="size-4" aria-hidden />
                {t('Calendar sync')}
              </span>
            </CardTitle>
            <CardDescription>
              {t('Put site milestones and open RFIs’ due dates in the connected calendar as all-day events, kept up to date every morning. Meetings are invited separately, from each meeting.')}
            </CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-3 border-t border-line-soft p-4">
            <label htmlFor="m365-calendar" className="flex items-start gap-3">
              <input
                id="m365-calendar"
                type="checkbox"
                checked={connection.calendar_sync}
                disabled={pending}
                onChange={(event) => toggleCalendar(event.target.checked)}
                className="mt-0.5 size-4 flex-none accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold">{t('Sync milestones and RFI due dates')}</span>
                <span className="text-[12.5px] leading-relaxed text-ink-muted">
                  {connection.calendar_sync
                    ? `${connection.calendar_events} ${t('events in the calendar')}${connection.calendar_synced_at ? ` · ${t('last synced')} ${instantDate(connection.calendar_synced_at)}, ${timeOfDay(connection.calendar_synced_at)}` : ''}`
                    : t('Off. Switching it off again removes the events it added.')}
                </span>
              </span>
            </label>
            {connection.calendar_sync && (
              <Button variant="secondary" size="sm" disabled={pending} onClick={syncNow} className="gap-2 self-start">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('Sync now')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {overview.recent_deliveries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Recent emails')}</CardTitle>
            <CardDescription>{t('The last 20 emails sent from the connected mailbox, and any Microsoft refused.')}</CardDescription>
          </CardHeader>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {overview.recent_deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-col gap-1 px-4 py-3 text-[13px] sm:flex-row sm:items-start sm:gap-4">
                <span className="w-32 flex-none text-ink-muted">
                  {instantDate(delivery.created_at)}, {timeOfDay(delivery.created_at)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{delivery.subject}</span>
                  <span className="truncate text-ink-muted" dir="ltr">
                    {delivery.to.join(', ')}
                  </span>
                  {delivery.error && <span className="text-blocked-fg">{delivery.error}</span>}
                </span>
                <span className="flex flex-none items-center gap-2">
                  <Badge tone="neutral">{t(M365_EMAIL_KIND_LABELS[delivery.kind])}</Badge>
                  <Badge tone={delivery.status === 'sent' ? 'done' : 'blocked'}>
                    {delivery.status === 'sent' ? t('Sent') : t('Failed')}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
