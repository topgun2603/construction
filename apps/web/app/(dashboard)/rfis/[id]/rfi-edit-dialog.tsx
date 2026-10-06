'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  RFI_DISCIPLINES,
  RFI_DISCIPLINE_LABELS,
  RFI_PRIORITIES,
  RFI_PRIORITY_LABELS,
  type RfiDiscipline,
  type RfiPriority,
} from '@sitebook/shared';
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
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';
import { updateRfi } from '@/lib/rfi-actions';
import type { RfiDetail } from '@/lib/rfi-types';
import { OptionSelect } from '../../safety/site-picker';
import { DocumentPicker } from '../document-picker';

const NOBODY = 'nobody';

/**
 * Correct an RFI that is still live: the wording, who it is for, the owner on the team, the due date
 * (a new one is reminded afresh), the drawings, and whether it affects cost or the programme.
 */
export function RfiEditDialog({
  rfi,
  people,
  documents,
}: {
  rfi: RfiDetail;
  /** Team members who can own chasing it. Empty when the caller cannot list the team. */
  people: Array<{ id: string; name: string }>;
  documents: SiteDocument[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [discipline, setDiscipline] = useState<RfiDiscipline>(rfi.discipline);
  const [priority, setPriority] = useState<RfiPriority>(rfi.priority);
  const [assignee, setAssignee] = useState(rfi.assignee?.id ?? NOBODY);
  const [documentIds, setDocumentIds] = useState<string[]>(rfi.documents.map((document) => document.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const text = (name: string) => String(formData.get(name) ?? '').trim();
    if (!text('subject') || !text('question')) return setError(t('Give it a subject and a question'));
    start(async () => {
      const result = await updateRfi(rfi.id, {
        subject: text('subject'),
        question: text('question'),
        discipline,
        priority,
        location: text('location') || null,
        addressed_to_name: text('addressed_to_name') || null,
        addressed_to_company: text('addressed_to_company') || null,
        addressed_to_email: text('addressed_to_email'),
        addressed_to_phone: text('addressed_to_phone') || null,
        due_on: text('due_on') || null,
        cost_impact: formData.get('cost_impact') === 'on',
        schedule_impact: formData.get('schedule_impact') === 'on',
        ...(people.length > 0 ? { assignee_id: assignee === NOBODY ? null : assignee } : {}),
        ...(documents.length > 0 ? { document_ids: documentIds } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save it'));
      toast.success(t('Saved'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil className="size-4" />
          {t('Edit')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('Edit')} {rfi.label}
          </DialogTitle>
          <DialogDescription>{t('Changing the due date sends its reminders again.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Subject')} htmlFor="edit-subject">
            <Input id="edit-subject" name="subject" maxLength={200} defaultValue={rfi.subject} />
          </Field>
          <Field label={t('Question')} htmlFor="edit-question">
            <Textarea id="edit-question" name="question" rows={5} maxLength={8000} defaultValue={rfi.question} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <OptionSelect
              label={t('Discipline')}
              value={discipline}
              onChange={(value) => setDiscipline(value as RfiDiscipline)}
              options={RFI_DISCIPLINES.map((value) => ({ value, label: RFI_DISCIPLINE_LABELS[value] }))}
            />
            <OptionSelect
              label={t('Priority')}
              value={priority}
              onChange={(value) => setPriority(value as RfiPriority)}
              options={RFI_PRIORITIES.map((value) => ({ value, label: RFI_PRIORITY_LABELS[value] }))}
            />
            <Field label={t('Due')} htmlFor="edit-due" optional>
              <Input id="edit-due" name="due_on" type="date" defaultValue={rfi.due_on ?? ''} />
            </Field>
          </div>
          <Field label={t('Location')} htmlFor="edit-location" optional>
            <Input id="edit-location" name="location" maxLength={200} defaultValue={rfi.location ?? ''} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Addressed to')} htmlFor="edit-to-name" optional>
              <Input id="edit-to-name" name="addressed_to_name" maxLength={120} defaultValue={rfi.addressed_to.name ?? ''} />
            </Field>
            <Field label={t('Company')} htmlFor="edit-to-company" optional>
              <Input
                id="edit-to-company"
                name="addressed_to_company"
                maxLength={160}
                defaultValue={rfi.addressed_to.company ?? ''}
              />
            </Field>
            <Field label={t('Email')} htmlFor="edit-to-email" optional>
              <Input
                id="edit-to-email"
                name="addressed_to_email"
                type="email"
                maxLength={200}
                dir="ltr"
                defaultValue={rfi.addressed_to.email ?? ''}
              />
            </Field>
            <Field label={t('Mobile (for WhatsApp)')} htmlFor="edit-to-phone" optional>
              <Input
                id="edit-to-phone"
                name="addressed_to_phone"
                type="tel"
                maxLength={20}
                dir="ltr"
                defaultValue={rfi.addressed_to.phone ?? ''}
              />
            </Field>
          </div>
          {people.length > 0 && (
            <OptionSelect
              label={t('Owner on the team')}
              value={assignee}
              onChange={setAssignee}
              options={[{ value: NOBODY, label: 'Nobody in particular' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          <div className="flex flex-wrap gap-5 text-[13.5px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="cost_impact" defaultChecked={rfi.cost_impact} />
              {t('Affects cost')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="schedule_impact" defaultChecked={rfi.schedule_impact} />
              {t('Affects the programme')}
            </label>
          </div>
          {documents.length > 0 && (
            <Field label={t('Drawings it is about')} optional>
              <DocumentPicker
                documents={documents}
                projectId={rfi.project.id}
                value={documentIds}
                onChange={setDocumentIds}
              />
            </Field>
          )}
          {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
