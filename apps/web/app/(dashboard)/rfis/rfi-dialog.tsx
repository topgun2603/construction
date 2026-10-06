'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HelpCircle, Loader2, Paperclip, Sparkles } from 'lucide-react';
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
import { createRfi, draftRfiWithAi } from '@/lib/rfi-actions';
import type { RfiAiResult } from '@/lib/rfi-types';
import { OptionSelect, SitePicker } from '../safety/site-picker';
import { DocumentPicker } from './document-picker';
import { uploadRfiFiles } from './file-upload';

/**
 * Raise an RFI: the question, who it is for, the drawings it is about, and any photos.
 *
 * "Draft with AI" is the drawing brain: it first asks the site's own documents whether the question
 * is already answered (and on which page — the cheapest RFI is the one never sent), then tidies the
 * rough note into a clear question. It only appears when the deployment has a key.
 */
export function RfiDialog({
  sites,
  documents,
  fixedSiteId,
  aiEnabled,
}: {
  sites: Array<{ id: string; name: string }>;
  documents: SiteDocument[];
  fixedSiteId?: string;
  aiEnabled: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? sites[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [discipline, setDiscipline] = useState<RfiDiscipline>('other');
  const [priority, setPriority] = useState<RfiPriority>('normal');
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [ai, setAi] = useState<RfiAiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();

  function reset() {
    setSubject('');
    setQuestion('');
    setDiscipline('other');
    setPriority('normal');
    setDocumentIds([]);
    setFiles([]);
    setAi(null);
    setError(null);
  }

  function draft() {
    setError(null);
    if (!siteId) return setError(t('Choose the site'));
    if (question.trim().length < 5) return setError(t('Write the question first, however roughly'));
    startDraft(async () => {
      const result = await draftRfiWithAi({ project_id: siteId, question: question.trim(), ...(subject ? { subject } : {}) });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not draft it'));
      setAi(result.data);
      setSubject(result.data.draft.subject);
      setQuestion(result.data.draft.question);
      setDiscipline(result.data.draft.discipline);
    });
  }

  function submit(formData: FormData, openNow: boolean) {
    setError(null);
    if (!siteId) return setError(t('Choose the site'));
    if (!subject.trim() || !question.trim()) return setError(t('Give it a subject and a question'));
    const text = (name: string) => String(formData.get(name) ?? '').trim() || null;
    start(async () => {
      const uploaded = await uploadRfiFiles(files, siteId);
      if (!uploaded.ok) return setError(uploaded.error);
      const result = await createRfi({
        project_id: siteId,
        subject: subject.trim(),
        question: question.trim(),
        discipline,
        priority,
        location: text('location'),
        addressed_to_name: text('addressed_to_name'),
        addressed_to_company: text('addressed_to_company'),
        addressed_to_email: text('addressed_to_email') ?? '',
        addressed_to_phone: text('addressed_to_phone'),
        due_on: text('due_on'),
        document_ids: documentIds,
        cost_impact: formData.get('cost_impact') === 'on',
        schedule_impact: formData.get('schedule_impact') === 'on',
        attachments: uploaded.files,
        open: openNow,
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save it'));
      toast.success(`${result.data.label}: ${result.data.subject}`);
      setOpen(false);
      reset();
      router.push(`/rfis/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <HelpCircle className="size-4" />
          {t('New RFI')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New RFI')}</DialogTitle>
          <DialogDescription>
            {t('A question to the designers. They can answer from a link without an account.')}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            submit(new FormData(event.currentTarget), submitter?.value === 'open');
          }}
          className="flex flex-col gap-4"
        >
          {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
          <Field label={t('Question')} htmlFor="rfi-question">
            <Textarea
              id="rfi-question"
              rows={5}
              maxLength={8000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t('S-201 shows the slab at +9.150 at grid C/4 but A-110 shows +9.200. Which one governs?')}
            />
          </Field>
          {aiEnabled && (
            <div className="flex flex-col gap-2 rounded-panel border border-line bg-raised p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink-muted">
                  {t('Check the drawings for an answer first, then tidy the question.')}
                </span>
                <Button type="button" size="sm" variant="secondary" onClick={draft} disabled={drafting}>
                  {drafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {t('Draft with AI')}
                </Button>
              </div>
              {ai?.check && (
                <div className="flex flex-col gap-1 text-[13px]">
                  <span className="font-semibold">
                    {ai.check.answered ? t('The documents may already answer this:') : t('Not found in the documents.')}
                  </span>
                  {ai.check.answered && <p className="whitespace-pre-line">{ai.check.answer}</p>}
                  {ai.check.sources.map((source) => (
                    <p key={`${source.document_id}-${source.page}`} className="text-[12.5px] text-ink-muted">
                      {source.title} · {t('page')} {source.page}: “{source.snippet}”
                    </p>
                  ))}
                  {ai.check.caveat && <p className="text-[12.5px] text-ink-faint">{ai.check.caveat}</p>}
                </div>
              )}
            </div>
          )}
          <Field label={t('Subject')} htmlFor="rfi-subject">
            <Input
              id="rfi-subject"
              maxLength={200}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t('Slab level at grid C/4')}
            />
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
            <Field label={t('Due')} htmlFor="rfi-due" optional hint={t('Defaults from company settings')}>
              <Input id="rfi-due" name="due_on" type="date" />
            </Field>
          </div>
          <Field label={t('Location')} htmlFor="rfi-location" optional>
            <Input id="rfi-location" name="location" maxLength={200} placeholder={t('Level 3, grid C/4')} />
          </Field>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-[13.5px] font-semibold">{t('Addressed to')}</legend>
            <Field label={t('Name')} htmlFor="rfi-to-name" optional>
              <Input id="rfi-to-name" name="addressed_to_name" maxLength={120} />
            </Field>
            <Field label={t('Company')} htmlFor="rfi-to-company" optional>
              <Input id="rfi-to-company" name="addressed_to_company" maxLength={160} />
            </Field>
            <Field label={t('Email')} htmlFor="rfi-to-email" optional>
              <Input id="rfi-to-email" name="addressed_to_email" type="email" maxLength={200} dir="ltr" />
            </Field>
            <Field label={t('Mobile (for WhatsApp)')} htmlFor="rfi-to-phone" optional>
              <Input id="rfi-to-phone" name="addressed_to_phone" type="tel" maxLength={20} dir="ltr" />
            </Field>
          </fieldset>
          <Field label={t('Drawings it is about')} optional>
            <DocumentPicker documents={documents} projectId={siteId} value={documentIds} onChange={setDocumentIds} />
          </Field>
          <div className="flex flex-wrap gap-5 text-[13.5px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="cost_impact" />
              {t('Affects cost')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="schedule_impact" />
              {t('Affects the programme')}
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Paperclip className="size-4" />
            {files.length > 0 ? files.map((file) => file.name).join(', ') : t('Attach photos or PDFs')}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
          <DialogFooter className="gap-2">
            <Button type="submit" value="draft" variant="secondary" disabled={pending}>
              {t('Save as draft')}
            </Button>
            <Button type="submit" value="open" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Raise RFI')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
