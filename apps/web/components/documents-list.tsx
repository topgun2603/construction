'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  Eye,
  EyeOff,
  FileText,
  History,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { createDocument, deleteDocument, presignUpload, updateDocument } from '@/lib/actions';
import type { DocumentCategory, SiteDocument } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { instantDate, titleCase } from '@/lib/format';

const CATEGORIES: DocumentCategory[] = [
  'drawing',
  'contract',
  'approval',
  'permit',
  'invoice',
  'other',
];

/**
 * Drawings, contracts and approvals — on one site, or across every site somebody is on.
 *
 * The list shows the current revision of each document, because "the slab drawing" means the one
 * people are building to. What a client can open is stated on every row rather than hidden in a
 * dialog: a builder needs to see at a glance that their costing is not shared, and "I thought it
 * was private" is not a thing you get to say afterwards.
 */
export function DocumentsList({
  projectId = null,
  documents,
  canManage,
  showProject = false,
}: {
  /** Null on the company-wide page, where an upload has no site to attach itself to. */
  projectId?: string | null;
  documents: SiteDocument[];
  canManage: boolean;
  /** Name the site on each row, for the list that spans several. */
  showProject?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canManage && projectId && (
        <div className="flex justify-end">
          <UploadDialog projectId={projectId} />
        </div>
      )}

      {documents.length === 0 && (
        <EmptyState
          icon={<FileText />}
          title={showProject ? 'No documents yet' : 'No documents on this site'}
          body={
            canManage
              ? 'Drawings, the contract, approvals. Each one keeps its revisions, so you can show what was current on the day something was built.'
              : 'Drawings and documents shared with you will appear here.'
          }
        />
      )}

      {documents.length > 0 && (
        <Card className="divide-y divide-line-soft">
          {documents.map((document) => (
            <Row
              key={document.id}
              document={document}
              canManage={canManage}
              showProject={showProject}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function Row({
  document,
  canManage,
  showProject,
}: {
  document: SiteDocument;
  canManage: boolean;
  showProject: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggleSharing() {
    start(async () => {
      const result = await updateDocument({
        id: document.id,
        projectId: document.project_id,
        visible_to_client: !document.visible_to_client,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not change that');
        return;
      }
      toast.success(
        document.visible_to_client
          ? `${document.title} is no longer shared with the client`
          : `${document.title} is now visible to the client`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <FileText className="size-5 flex-none text-ink-faint" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium">{document.title}</span>
          <Badge tone="neutral">{titleCase(document.category)}</Badge>
          {document.version > 1 && (
            <span
              className="rounded-full bg-neutral-bg px-2 py-0.5 font-mono text-[11.5px] text-ink-soft"
              title="Revisions are kept; this is the current one"
            >
              rev {document.version}
            </span>
          )}
        </div>
        <span className="text-[12.5px] text-ink-muted">
          {[
            showProject ? (document.project_name ?? 'No site') : null,
            document.uploaded_by.name,
            instantDate(document.created_at),
            `${Math.max(1, Math.round(document.size_bytes / 1024))} KB`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {/* Who can see it, always on the row. */}
      <span
        className={`flex flex-none items-center gap-1.5 text-[12.5px] ${
          document.visible_to_client ? 'text-done' : 'text-ink-faint'
        }`}
        title={
          document.visible_to_client
            ? 'The client can open this'
            : 'Only your team can open this'
        }
      >
        {document.visible_to_client ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        {document.visible_to_client ? 'Shared' : 'Internal'}
      </span>

      <div className="flex flex-none items-center gap-2">
        {document.url && (
          <Button asChild size="sm" variant="secondary">
            <a href={document.url} target="_blank" rel="noreferrer noopener">
              Open
            </a>
          </Button>
        )}

        {canManage && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={toggleSharing}
              title={
                document.visible_to_client ? 'Stop sharing with the client' : 'Share with the client'
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : document.visible_to_client ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>

            <UploadDialog
              projectId={document.project_id}
              supersedes={document}
              trigger={
                <Button size="icon" variant="ghost" title={`Upload a new revision of ${document.title}`}>
                  <History className="size-4" />
                </Button>
              }
            />

            <ConfirmDialog
              title="Remove this revision?"
              body={
                <>
                  <strong className="font-semibold text-ink">{document.title}</strong> rev{' '}
                  {document.version} comes off the list. Earlier revisions stay, and the stored file
                  itself is kept.
                </>
              }
              confirmLabel="Remove revision"
              successMessage="Removed"
              onConfirm={() => deleteDocument(document.id, document.project_id)}
              trigger={
                <Button size="icon" variant="ghost" aria-label={`Remove ${document.title}`}>
                  <Trash2 className="size-4" />
                </Button>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Uploading, either as a new document or as the next revision of one.
 *
 * A revision takes its title, category and sharing from what it replaces — those belong to the
 * document, not to one version of it — so the form for a revision asks only for the file.
 */
function UploadDialog({
  projectId,
  supersedes,
  trigger,
}: {
  projectId: string | null;
  supersedes?: SiteDocument;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('drawing');
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function submit() {
    if (!file) {
      setError('Choose a file first');
      return;
    }
    if (!supersedes && !title.trim()) {
      setError('Give it a name somebody will recognise');
      return;
    }
    setError(null);

    start(async () => {
      const presigned = await presignUpload({
        kind: 'document',
        content_type: file.type || 'application/octet-stream',
        content_length: file.size,
        ...(projectId ? { project_id: projectId } : {}),
      });
      if (!presigned.ok || !presigned.data) {
        setError(presigned.error ?? 'Could not prepare the upload');
        return;
      }

      const put = await fetch(presigned.data.url, {
        method: 'PUT',
        headers: presigned.data.headers,
        body: file,
      });
      if (!put.ok) {
        setError('The upload failed');
        return;
      }

      const result = await createDocument({
        project_id: projectId,
        title: supersedes ? supersedes.title : title.trim(),
        category: supersedes ? supersedes.category : category,
        s3_key: presigned.data.s3_key,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        visible_to_client: supersedes ? supersedes.visible_to_client : share,
        ...(supersedes ? { supersedes_id: supersedes.id } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save it');
        return;
      }

      toast.success(
        supersedes ? `${supersedes.title} updated to rev ${(result.data?.version ?? 0)}` : 'Uploaded',
      );
      setOpen(false);
      setFile(null);
      setTitle('');
      setShare(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="secondary">
            <Upload className="size-4" /> Upload document
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {supersedes ? `New revision of ${supersedes.title}` : 'Upload a document'}
          </DialogTitle>
          <DialogDescription>
            {supersedes
              ? `This becomes rev ${supersedes.version + 1}. It keeps the name, the category and who can see it.`
              : 'Drawings, the contract, approvals. Nothing is visible to the client unless you say so.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="File">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex min-h-11 w-full items-center gap-2 rounded-btn border border-dashed border-line-strong bg-raised px-3 text-left text-[14px] text-ink-muted transition hover:border-accent hover:text-accent"
            >
              <Upload className="size-4" />
              {file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : 'Choose a file'}
            </button>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                // A filename is usually the name people already call it by.
                if (chosen && !supersedes && !title.trim()) {
                  setTitle(chosen.name.replace(/\.[^.]+$/, ''));
                }
                event.target.value = '';
              }}
            />
          </Field>

          {!supersedes && (
            <>
              <Field label="Name" htmlFor="document-title">
                <Input
                  id="document-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  placeholder="Ground floor slab layout"
                />
              </Field>

              <Field label="What is it">
                <Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {titleCase(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-btn border border-line-strong p-3">
                <input
                  type="checkbox"
                  checked={share}
                  onChange={(event) => setShare(event.target.checked)}
                  className="mt-0.5 size-4 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium">Let the client open this</span>
                  <span className="text-[12.5px] text-ink-muted">
                    Off by default. A contract or a costing shared by accident is not something you
                    can take back.
                  </span>
                </span>
              </label>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {supersedes ? 'Upload revision' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
