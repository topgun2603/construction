'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, FileText, IdCard, Paperclip, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  documentKindsFor,
  WORKER_DOCUMENT_LABELS,
  type WorkerDocumentKind,
} from '@sitebook/shared';
import type { WorkerDocument } from '@/lib/api-types';
import {
  addWorkerDocument,
  deleteWorkerDocument,
  presignUpload,
  revealWorkerDocument,
  workerDocumentScanUrl,
} from '@/lib/actions';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STANDING = {
  expired: { tone: 'blocked', label: 'Expired' },
  expiring: { tone: 'pending', label: 'Expires soon' },
  valid: { tone: 'done', label: 'Valid' },
  no_expiry: { tone: 'neutral', label: 'No expiry' },
} as const;

/**
 * A worker's papers: passport, visa, Emirates ID, Iqama, labour card (roadmap Phase 1, item 3).
 *
 * The number shows as its last four characters. "Show number" asks the API for the whole of it,
 * which writes down who looked — the person filling in a government form needs it, nobody else
 * scrolling the page does.
 */
export function WorkerPapers({
  workerId,
  documents,
  canManage,
  unavailable,
}: {
  workerId: string;
  documents: WorkerDocument[];
  canManage: boolean;
  /** The deployment has no encryption key, so nothing can be stored. */
  unavailable: boolean;
}) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();
  const router = useRouter();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [, start] = useTransition();

  function reveal(document: WorkerDocument) {
    start(async () => {
      const result = await revealWorkerDocument(document.id);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not show the number'));
        return;
      }
      setRevealed((current) => ({ ...current, [document.id]: result.data!.number }));
    });
  }

  function openScan(document: WorkerDocument) {
    start(async () => {
      const result = await workerDocumentScanUrl(document.id);
      if (result.ok && result.data?.url) window.open(result.data.url, '_blank', 'noopener');
      else toast.error(result.error ?? t('Could not open the scan'));
    });
  }

  function remove(document: WorkerDocument) {
    start(async () => {
      const result = await deleteWorkerDocument(document.id, workerId);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not remove it'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <IdCard className="size-3.5" />
          {t('Papers')}
        </span>
        {canManage && !unavailable && <AddPaperDialog workerId={workerId} />}
      </div>

      {unavailable ? (
        <p className="text-[13px] text-ink-muted">
          {t('Identity papers are not set up on this deployment yet.')}
        </p>
      ) : documents.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          {t(
            'No papers recorded. Add a passport, visa or ID with its expiry date to be told before it lapses.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {documents.map((document) => {
            const standing = STANDING[document.standing];
            return (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-[14px] font-medium">
                    <FileText className="size-3.5 text-ink-muted" />
                    {t(WORKER_DOCUMENT_LABELS[document.kind])}
                    <span className="font-mono text-[13px] text-ink-muted">
                      {revealed[document.id] ?? `•••• ${document.number_hint}`}
                    </span>
                  </span>
                  <span className="text-[12.5px] text-ink-muted">
                    {document.expires_on
                      ? `${t('Expires')} ${shortDate(document.expires_on)}`
                      : t('No expiry date')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={standing.tone}>{t(standing.label)}</Badge>
                  {document.has_scan && (
                    <Button variant="ghost" size="sm" onClick={() => openScan(document)}>
                      <Paperclip className="size-3.5" /> {t('Scan')}
                    </Button>
                  )}
                  {canManage && !revealed[document.id] && (
                    <Button variant="ghost" size="sm" onClick={() => reveal(document)}>
                      <Eye className="size-3.5" /> {t('Show number')}
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('Remove')}
                      onClick={() => remove(document)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AddPaperDialog({ workerId }: { workerId: string }) {
  const { t } = useLanguage();
  const { settings } = useFormat();
  const router = useRouter();
  const kinds = documentKindsFor(settings.country);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WorkerDocumentKind>(kinds[0]!);
  const [scan, setScan] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      let s3Key: string | undefined;
      if (scan) {
        const presigned = await presignUpload({
          kind: 'worker_document',
          content_type: scan.type || 'image/jpeg',
          content_length: scan.size,
        });
        if (!presigned.ok || !presigned.data) {
          setError(presigned.error ?? t('Could not prepare the upload'));
          return;
        }
        const put = await fetch(presigned.data.url, {
          method: 'PUT',
          headers: presigned.data.headers,
          body: scan,
        });
        if (!put.ok) {
          setError(t('The upload failed'));
          return;
        }
        s3Key = presigned.data.s3_key;
      }

      const optional = (name: string) => {
        const value = String(formData.get(name) ?? '').trim();
        return value === '' ? undefined : value;
      };
      const result = await addWorkerDocument({
        workerId,
        kind,
        number: String(formData.get('number') ?? ''),
        issued_on: optional('issued_on'),
        expires_on: optional('expires_on'),
        s3_key: s3Key,
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save'));
        return;
      }
      toast.success(t('Saved'));
      setOpen(false);
      setScan(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus className="size-3.5" /> {t('Add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Add a paper')}</DialogTitle>
          <DialogDescription>
            {t(
              'The number is encrypted before it is stored, and shown only as its last four characters.',
            )}
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label={t('Type')}>
            <Select value={kind} onValueChange={(value) => setKind(value as WorkerDocumentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(WORKER_DOCUMENT_LABELS[option])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Number')} htmlFor="number">
            <Input
              id="number"
              name="number"
              required
              minLength={3}
              maxLength={40}
              autoComplete="off"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Issued on')} htmlFor="issued_on" optional>
              <Input id="issued_on" name="issued_on" type="date" />
            </Field>
            <Field label={t('Expires on')} htmlFor="expires_on">
              <Input id="expires_on" name="expires_on" type="date" />
            </Field>
          </div>
          <Field label={t('Scan')} htmlFor="scan" optional>
            <Input
              id="scan"
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => setScan(event.target.files?.[0] ?? null)}
            />
          </Field>
          {error && (
            <p role="alert" className="text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
