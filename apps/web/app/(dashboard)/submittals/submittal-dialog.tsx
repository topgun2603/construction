'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileStack, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import {
  SUBMITTAL_TYPES,
  SUBMITTAL_TYPE_LABELS,
  type SubmittalReviewerKind,
  type SubmittalType,
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
import { createSubmittal } from '@/lib/rfi-actions';
import { OptionSelect, SitePicker } from '../safety/site-picker';
import { DocumentPicker } from '../rfis/document-picker';
import { uploadRfiFiles } from '../rfis/file-upload';

const NONE = 'none';

/**
 * Start a submittal: what it is, who prepared it, who reviews it, and the files being sent. Saved as
 * Rev 0 in draft; it goes to the reviewer from its own page, where the link or the client's approval
 * is made.
 */
export function SubmittalDialog({
  sites,
  documents,
  parties,
  fixedSiteId,
}: {
  sites: Array<{ id: string; name: string }>;
  documents: SiteDocument[];
  /** Subcontractors and suppliers who may have prepared it. */
  parties: { contractors: Array<{ id: string; name: string }>; vendors: Array<{ id: string; name: string }> };
  fixedSiteId?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? sites[0]?.id ?? '');
  const [type, setType] = useState<SubmittalType>('shop_drawing');
  const [from, setFrom] = useState(NONE);
  const [reviewerKind, setReviewerKind] = useState<SubmittalReviewerKind>('external');
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const fromOptions = [
    { value: NONE, label: 'Our own team' },
    ...parties.contractors.map((row) => ({ value: `c:${row.id}`, label: row.name })),
    ...parties.vendors.map((row) => ({ value: `v:${row.id}`, label: row.name })),
  ];

  function submit(formData: FormData) {
    setError(null);
    const text = (name: string) => String(formData.get(name) ?? '').trim() || null;
    const title = text('title');
    if (!siteId) return setError(t('Choose the site'));
    if (!title) return setError(t('Give it a title'));
    start(async () => {
      const uploaded = await uploadRfiFiles(files, siteId);
      if (!uploaded.ok) return setError(uploaded.error);
      const result = await createSubmittal({
        project_id: siteId,
        title,
        type,
        spec_section: text('spec_section'),
        description: text('description'),
        contractor_id: from.startsWith('c:') ? from.slice(2) : null,
        vendor_id: from.startsWith('v:') ? from.slice(2) : null,
        reviewer_kind: reviewerKind,
        reviewer_name: reviewerKind === 'external' ? text('reviewer_name') : null,
        reviewer_company: reviewerKind === 'external' ? text('reviewer_company') : null,
        reviewer_email: reviewerKind === 'external' ? (text('reviewer_email') ?? '') : '',
        reviewer_phone: reviewerKind === 'external' ? text('reviewer_phone') : null,
        files: [...documentIds.map((document_id) => ({ document_id })), ...uploaded.files],
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save it'));
      toast.success(`${result.data.label}: ${result.data.title}`);
      setOpen(false);
      setDocumentIds([]);
      setFiles([]);
      router.push(`/submittals/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileStack className="size-4" />
          {t('New submittal')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New submittal')}</DialogTitle>
          <DialogDescription>
            {t('Shop drawings, samples, method statements and data sheets sent for approval.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
          <Field label={t('Title')} htmlFor="sub-title">
            <Input id="sub-title" name="title" maxLength={200} placeholder={t('Staircase steel shop drawings')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionSelect
              label={t('Type')}
              value={type}
              onChange={(value) => setType(value as SubmittalType)}
              options={SUBMITTAL_TYPES.map((value) => ({ value, label: SUBMITTAL_TYPE_LABELS[value] }))}
            />
            <Field label={t('Spec section')} htmlFor="sub-spec" optional>
              <Input id="sub-spec" name="spec_section" maxLength={60} placeholder="05 12 00" dir="ltr" />
            </Field>
          </div>
          <OptionSelect label={t('Prepared by')} value={from} onChange={setFrom} options={fromOptions} />
          <Field label={t('Notes')} htmlFor="sub-description" optional>
            <Textarea id="sub-description" name="description" rows={2} maxLength={4000} />
          </Field>
          <OptionSelect
            label={t('Reviewed by')}
            value={reviewerKind}
            onChange={(value) => setReviewerKind(value as SubmittalReviewerKind)}
            options={[
              { value: 'external', label: 'A consultant, through a link' },
              { value: 'client', label: 'The client, in their approvals' },
            ]}
          />
          {reviewerKind === 'external' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Reviewer')} htmlFor="sub-rev-name" optional>
                <Input id="sub-rev-name" name="reviewer_name" maxLength={120} />
              </Field>
              <Field label={t('Company')} htmlFor="sub-rev-company" optional>
                <Input id="sub-rev-company" name="reviewer_company" maxLength={160} />
              </Field>
              <Field label={t('Email')} htmlFor="sub-rev-email" optional>
                <Input id="sub-rev-email" name="reviewer_email" type="email" maxLength={200} dir="ltr" />
              </Field>
              <Field label={t('Mobile (for WhatsApp)')} htmlFor="sub-rev-phone" optional>
                <Input id="sub-rev-phone" name="reviewer_phone" type="tel" maxLength={20} dir="ltr" />
              </Field>
            </div>
          )}
          <Field label={t('Documents being submitted')} optional>
            <DocumentPicker documents={documents} projectId={siteId} value={documentIds} onChange={setDocumentIds} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Paperclip className="size-4" />
            {files.length > 0 ? files.map((file) => file.name).join(', ') : t('Upload photos or PDFs')}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save draft')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
