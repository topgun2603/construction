'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MeetingAttendeeInput } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { createMeeting, updateMeeting } from '@/lib/m365-actions';
import type { MeetingDetail } from '@/lib/m365-types';
import { isoToWallTime, wallTimeToIso } from '@/lib/meeting-time';

export interface MeetingPerson {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Outside addresses as typed: one per line or comma, either `priya@firm.com` or
 * `Priya Raman <priya@firm.com>`. Anything that is not an address is reported back, not dropped.
 */
export function parseOutsiders(text: string): { attendees: Array<{ email: string; name?: string }>; bad: string[] } {
  const attendees: Array<{ email: string; name?: string }> = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const named = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(entry);
    const email = (named ? named[2]! : entry).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      bad.push(entry);
      continue;
    }
    const name = named?.[1]?.trim().replace(/^"|"$/g, '');
    attendees.push(name ? { email, name } : { email });
  }
  return { attendees, bad };
}

/**
 * Book a meeting on a site, or change one: when, where, the agenda and who is asked — people on the
 * team by tick, anybody else by address. Times are the company's clock, whatever the browser's is.
 */
export function MeetingDialog({
  projectId,
  people,
  meeting,
  trigger,
}: {
  projectId: string;
  people: MeetingPerson[];
  /** Given, the dialog edits it. */
  meeting?: MeetingDetail;
  trigger: ReactNode;
}) {
  const { t } = useLanguage();
  const { settings } = useFormat();
  const tz = settings.timezone;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(meeting?.attendees.filter((a) => a.user_id).map((a) => a.user_id!) ?? []),
  );

  const defaults = {
    title: meeting?.title ?? '',
    starts: meeting ? isoToWallTime(meeting.starts_at, tz) : '',
    ends: meeting ? isoToWallTime(meeting.ends_at, tz) : '',
    location: meeting?.location ?? '',
    agenda: meeting?.agenda ?? '',
    outsiders:
      meeting?.attendees
        .filter((a) => !a.user_id && a.email)
        .map((a) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email!))
        .join('\n') ?? '',
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? '').trim();
    const outsiders = parseOutsiders(read('outsiders'));
    if (outsiders.bad.length > 0) {
      setError(`${t('Not an email address')}: ${outsiders.bad.join(', ')}`);
      return;
    }
    if (!read('starts') || !read('ends')) {
      setError(t('Give the start and the end'));
      return;
    }
    const attendees: MeetingAttendeeInput[] = [
      ...[...selected].map((id) => ({ user_id: id })),
      ...outsiders.attendees,
    ];
    const fields = {
      title: read('title'),
      starts_at: wallTimeToIso(read('starts'), tz),
      ends_at: wallTimeToIso(read('ends'), tz),
      location: read('location') || null,
      agenda: read('agenda') || null,
      attendees,
    };
    start(async () => {
      const result = meeting
        ? await updateMeeting(meeting.id, fields)
        : await createMeeting({ project_id: projectId, ...fields });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setOpen(false);
      toast.success(meeting ? t('Meeting updated') : t('Meeting booked'));
      if (meeting) router.refresh();
      else router.push(`/meetings/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meeting ? t('Edit meeting') : t('New site meeting')}</DialogTitle>
          <DialogDescription>
            {t('Times are on the company’s clock. With Microsoft 365 connected you can send everyone an Outlook invite from the meeting.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('Title')} htmlFor="meeting-title">
            <Input id="meeting-title" name="title" required maxLength={200} defaultValue={defaults.title} placeholder={t('Weekly coordination')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Starts')} htmlFor="meeting-starts">
              <Input id="meeting-starts" name="starts" type="datetime-local" required defaultValue={defaults.starts} dir="ltr" />
            </Field>
            <Field label={t('Ends')} htmlFor="meeting-ends">
              <Input id="meeting-ends" name="ends" type="datetime-local" required defaultValue={defaults.ends} dir="ltr" />
            </Field>
          </div>
          <Field label={t('Where')} optional htmlFor="meeting-location">
            <Input id="meeting-location" name="location" maxLength={300} defaultValue={defaults.location} placeholder={t('Site office, or a Teams link')} />
          </Field>
          <Field label={t('Agenda')} optional htmlFor="meeting-agenda">
            <Textarea id="meeting-agenda" name="agenda" rows={4} maxLength={10_000} defaultValue={defaults.agenda} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold">{t('From the team')}</legend>
            {people.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t('Nobody on the team to choose from.')}</p>
            ) : (
              <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {people.map((person) => (
                  <label key={person.id} className="flex items-start gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(person.id);
                        else next.delete(person.id);
                        setSelected(next);
                      }}
                      className="mt-0.5 size-4 flex-none accent-accent"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span>{person.name}</span>
                      <span className="truncate text-[12px] text-ink-faint" dir="ltr">
                        {person.email ?? t('No email — not invited by Outlook')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <Field
            label={t('Others, by email')}
            optional
            htmlFor="meeting-outsiders"
            hint={t('One per line: priya@firm.com, or Priya Raman <priya@firm.com>')}
          >
            <Textarea id="meeting-outsiders" name="outsiders" rows={3} dir="ltr" defaultValue={defaults.outsiders} />
          </Field>
          {error && (
            <p role="alert" className="text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {meeting ? t('Save') : t('Book meeting')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
