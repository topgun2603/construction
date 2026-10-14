'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { CalendarPlus, Loader2, Pencil, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import {
  addMeetingAction,
  cancelMeeting,
  deleteMeeting,
  removeMeetingAction,
  sendMeetingInvite,
  sendMeetingMinutes,
  updateMeeting,
  updateMeetingAction,
} from '@/lib/m365-actions';
import type { M365Status, MeetingDetail } from '@/lib/m365-types';
import type { ActionResult } from '@/lib/server-api';
import { OptionSelect } from '../../safety/site-picker';
import { MeetingDialog, type MeetingPerson } from '../meeting-dialog';

/** "Someone else" in the owner picker: a name typed in, for the consultant who took the action. */
const OTHER = '__other__';

/**
 * The working half of a meeting's page: sending the invite, writing the minutes, the action items,
 * and sending the minutes to everybody asked. What the meeting is, and who was asked, is drawn by
 * the server page beside this.
 */
export function MeetingView({
  meeting,
  people,
  canManage,
  m365,
}: {
  meeting: MeetingDetail;
  people: MeetingPerson[];
  canManage: boolean;
  m365: M365Status;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = meeting.status !== 'cancelled';

  function run<T>(action: () => Promise<ActionResult<T>>, success: (data: T) => string) {
    start(async () => {
      const result = await action();
      if (!result.ok || result.data === undefined) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      toast.success(success(result.data));
      router.refresh();
    });
  }

  const skippedNote = (skipped: string[]) =>
    skipped.length > 0 ? ` ${t('No email for')}: ${skipped.join(', ')}.` : '';

  return (
    <div className="flex flex-col gap-4">
      {canManage && live && (
        <div className="flex flex-wrap items-center gap-2">
          {m365.connected ? (
            <Button
              size="sm"
              disabled={pending}
              className="gap-2"
              onClick={() =>
                run(
                  () => sendMeetingInvite(meeting.id),
                  (data) =>
                    `${meeting.in_calendar ? t('Invite updated for') : t('Invite sent to')} ${data.invited.length}.${skippedNote(data.skipped)}`,
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              {meeting.in_calendar ? t('Update invite') : t('Send invite')}
            </Button>
          ) : (
            <span className="text-[12.5px] text-ink-muted">
              {t('Connect Microsoft 365 in Settings → Integrations to send Outlook invites and email the minutes.')}
            </span>
          )}
          <MeetingDialog
            projectId={meeting.project.id}
            people={people}
            meeting={meeting}
            trigger={
              <Button size="sm" variant="secondary" className="gap-2">
                <Pencil className="size-4" />
                {t('Edit')}
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" className="gap-2">
                <X className="size-4" />
                {t('Cancel meeting')}
              </Button>
            }
            title={t('Cancel this meeting?')}
            body={
              meeting.in_calendar
                ? `${meeting.title}. ${t('Everybody invited gets a cancellation from Outlook.')}`
                : meeting.title
            }
            confirmLabel={t('Cancel meeting')}
            onConfirm={() => cancelMeeting(meeting.id)}
            successMessage={t('Meeting cancelled')}
          />
          {!meeting.invite_sent_at && !meeting.minutes_sent_at && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="gap-2">
                  <Trash2 className="size-4" />
                  {t('Delete')}
                </Button>
              }
              title={t('Delete this meeting?')}
              body={meeting.title}
              onConfirm={async () => {
                const result = await deleteMeeting(meeting.id, meeting.project.id);
                if (result.ok) router.push(`/projects/${meeting.project.id}?tab=meetings`);
                return result;
              }}
            />
          )}
        </div>
      )}

      {meeting.agenda && (
        <Card className="flex flex-col gap-2 p-4">
          <h3 className="text-[14px] font-semibold">{t('Agenda')}</h3>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{meeting.agenda}</p>
        </Card>
      )}

      <Minutes meeting={meeting} canEdit={canManage && live} />
      <ActionItems meeting={meeting} people={people} canEdit={canManage && live} />

      {canManage && live && m365.connected && (meeting.minutes || meeting.action_items.length > 0) && (
        <SendMinutes meeting={meeting} skippedNote={skippedNote} />
      )}
    </div>
  );
}

function Minutes({ meeting, canEdit }: { meeting: MeetingDetail; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(meeting.minutes ?? '');
  const dirty = text !== (meeting.minutes ?? '');

  if (!canEdit) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <h3 className="text-[14px] font-semibold">{t('Minutes')}</h3>
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
          {meeting.minutes || <span className="text-ink-muted">{t('No minutes written yet.')}</span>}
        </p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label={t('Minutes')} htmlFor="meeting-minutes" hint={t('What was said and decided. Saving them marks the meeting held.')}>
        <Textarea id="meeting-minutes" rows={8} maxLength={50_000} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !dirty}
        className="self-start"
        onClick={() =>
          start(async () => {
            const result = await updateMeeting(meeting.id, { minutes: text.trim() || null });
            if (!result.ok) {
              toast.error(result.error ?? t('That did not work'));
              return;
            }
            toast.success(t('Minutes saved'));
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t('Save minutes')}
      </Button>
    </Card>
  );
}

function ActionItems({ meeting, people, canEdit }: { meeting: MeetingDetail; people: MeetingPerson[]; canEdit: boolean }) {
  const { t } = useLanguage();
  const { shortDate, todayIso } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);

  function refreshAfter(action: () => Promise<ActionResult>) {
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      router.refresh();
    });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const description = String(data.get('description') ?? '').trim();
    const otherName = String(data.get('owner_name') ?? '').trim();
    const due = String(data.get('due_on') ?? '');
    if (!description) {
      setError(t('Say what has to be done'));
      return;
    }
    start(async () => {
      const result = await addMeetingAction(meeting.id, {
        description,
        owner_user_id: owner && owner !== OTHER ? owner : null,
        owner_name: owner === OTHER ? otherName || null : null,
        due_on: due || null,
      });
      if (!result.ok) {
        setError(result.error ?? t('That did not work'));
        return;
      }
      form.reset();
      setOwner('');
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-[14px] font-semibold">
        {t('Action items')}{' '}
        <span className="font-normal text-ink-muted">
          ({meeting.action_items.filter((item) => item.status === 'open').length} {t('open')})
        </span>
      </h3>
      {meeting.action_items.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{t('Nothing agreed yet.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {meeting.action_items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2">
              <input
                type="checkbox"
                aria-label={t('Done')}
                checked={item.status === 'done'}
                disabled={!canEdit || pending}
                onChange={(event) =>
                  refreshAfter(() =>
                    updateMeetingAction(meeting.id, item.id, { status: event.target.checked ? 'done' : 'open' }),
                  )
                }
                className="mt-0.5 size-4 flex-none accent-accent"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={item.status === 'done' ? 'text-[13.5px] text-ink-muted line-through' : 'text-[13.5px]'}>
                  {item.description}
                </span>
                <span className="text-[12.5px] text-ink-muted">
                  {item.owner?.name ?? t('No owner')}
                  {item.due_on && (
                    <span className={item.overdue ? 'font-semibold text-blocked-fg' : undefined}>
                      {' '}
                      · {t('due')} {shortDate(item.due_on)}
                    </span>
                  )}
                </span>
              </span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('Remove')}
                  disabled={pending}
                  onClick={() => refreshAfter(() => removeMeetingAction(meeting.id, item.id))}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={add} className="flex flex-col gap-3 border-t border-line-soft pt-3">
          <Field label={t('New action')} htmlFor="action-description">
            <Input id="action-description" name="description" maxLength={1000} placeholder={t('Issue revised slab drawing')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionSelect
              label={t('Owner')}
              optional
              value={owner}
              onChange={setOwner}
              options={[...people.map((person) => ({ value: person.id, label: person.name })), { value: OTHER, label: 'Someone else' }]}
            />
            <Field label={t('Due')} optional htmlFor="action-due">
              <Input id="action-due" name="due_on" type="date" min={todayIso()} dir="ltr" />
            </Field>
          </div>
          {owner === OTHER && (
            <Field label={t('Their name')} htmlFor="action-owner-name">
              <Input id="action-owner-name" name="owner_name" maxLength={200} placeholder={t('Priya Raman (architect)')} />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Add action')}
          </Button>
        </form>
      )}
    </Card>
  );
}

function SendMinutes({ meeting, skippedNote }: { meeting: MeetingDetail; skippedNote: (skipped: string[]) => string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field
        label={t('A line above the minutes')}
        optional
        htmlFor="minutes-note"
        hint={t('The minutes and action items go to everybody asked who has an email, from the connected mailbox.')}
      >
        <Input id="minutes-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <Button
        size="sm"
        disabled={pending}
        className="gap-2 self-start"
        onClick={() =>
          start(async () => {
            const result = await sendMeetingMinutes(meeting.id, note.trim() || undefined);
            if (!result.ok || !result.data) {
              toast.error(result.error ?? t('The minutes were not sent'));
              return;
            }
            toast.success(`${t('Minutes emailed to')} ${result.data.delivery.to.length}.${skippedNote(result.data.skipped)}`);
            setNote('');
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {meeting.minutes_sent_at ? t('Send minutes again') : t('Send minutes')}
      </Button>
    </Card>
  );
}
