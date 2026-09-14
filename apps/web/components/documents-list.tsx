'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import {
  Eye,
  EyeOff,
  FileText,
  History,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createDocument, deleteDocument, presignUpload, updateDocument } from '@/lib/actions';
import type { DocumentCategory, SiteDocument } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import type { ColumnDef } from '@tanstack/react-table';
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
  sites,
}: {
  /** Null on the company-wide page, where the upload asks which site instead. */
  projectId?: string | null;
  documents: SiteDocument[];
  canManage: boolean;
  /** Name the site on each row, for the list that spans several. */
  showProject?: boolean;
  /**
   * Offered as a picker when there is no `projectId`.
   *
   * Without this the company-wide page had no way to upload at all — it is the page the nav points
   * at, so somebody looking for "how do I add a document" found an empty list and no answer. The
   * dialog always could file against a chosen site or none; it simply was never shown one.
   */
  sites?: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {canManage && (projectId || sites) && (
        <div className="flex justify-end">
          <UploadDialog projectId={projectId} sites={projectId ? undefined : sites} />
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={showProject ? 'No documents yet' : 'No documents on this site'}
          body={
            canManage
              ? 'Drawings, the contract, approvals. Each one keeps its revisions, so you can show what was current on the day something was built.'
              : 'Drawings and documents shared with you will appear here.'
          }
        />
      ) : (
        <Card className="p-4">
          <DocumentsTable
            documents={documents}
            canManage={canManage}
            showProject={showProject}
          />
        </Card>
      )}
    </div>
  );
}

/**
 * The documents, as a sortable and filterable table.
 *
 * A card list was right while a site had six drawings and wrong the moment it had sixty: the
 * question stops being "what is here" and becomes "where is the electrical layout, and is the one I
 * am looking at the current revision". Sorting by name, category, site or date answers that; the
 * search box answers it faster.
 *
 * Everything runs client-side on the page already fetched. These are a company's documents —
 * hundreds, not millions — and a round trip per column click would be slower than sorting in the
 * browser. The API's own limit is what bounds the fetch.
 */
function DocumentsTable({
  documents,
  canManage,
  showProject,
}: {
  documents: SiteDocument[];
  canManage: boolean;
  showProject: boolean;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /**
   * Filed between two dates, inclusive at both ends.
   *
   * `created_at` is an instant and the inputs are days, so the upper bound compares against the
   * date part only — otherwise "to 14 Sept" would silently exclude everything filed on the 14th
   * after midnight, which is all of it.
   *
   * Filtered before the table rather than as a column filter: the range is a property of the set
   * being looked at, not of a column somebody sorts by, and doing it here keeps the row count and
   * the pagination honest about what is being shown.
   */
  const visible = useMemo(() => {
    if (!from && !to) return documents;
    return documents.filter((document) => {
      const filed = document.created_at.slice(0, 10);
      if (from && filed < from) return false;
      if (to && filed > to) return false;
      return true;
    });
  }, [documents, from, to]);

  const columns = useMemo<ColumnDef<SiteDocument>[]>(() => {
    const defined: ColumnDef<SiteDocument>[] = [
      {
        accessorKey: 'title',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 flex-none text-ink-faint" />
            <span className="truncate font-medium">{row.original.title}</span>
            {row.original.version > 1 && (
              <span
                className="flex-none rounded-full bg-neutral-bg px-2 py-0.5 font-mono text-[11.5px] text-ink-soft"
                title="Revisions are kept; this is the current one"
              >
                rev {row.original.version}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'What it is',
        cell: ({ getValue }) => <Badge tone="neutral">{titleCase(getValue<string>())}</Badge>,
      },
    ];

    if (showProject) {
      defined.push({
        // Company-wide documents sort together under one heading rather than scattering: the
        // accessor gives them a real value instead of leaving the cell empty.
        id: 'site',
        accessorFn: (document) => document.project_name ?? 'No site',
        header: 'Site',
        cell: ({ getValue }) => (
          <span className="text-ink-muted">{getValue<string>()}</span>
        ),
      });
    }

    defined.push(
      {
        id: 'visibility',
        accessorFn: (document) => (document.visible_to_client ? 'Shared' : 'Internal'),
        header: 'Who can see it',
        cell: ({ row }) => (
          <span
            className={`flex items-center gap-1.5 text-[12.5px] ${
              row.original.visible_to_client ? 'text-done' : 'text-ink-faint'
            }`}
            title={
              row.original.visible_to_client
                ? 'The client can open this'
                : 'Only your team can open this'
            }
          >
            {row.original.visible_to_client ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            {row.original.visible_to_client ? 'Shared' : 'Internal'}
          </span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Filed',
        cell: ({ row }) => (
          <span className="text-[12.5px] text-ink-muted">
            {instantDate(row.original.created_at)}
            <br />
            {row.original.uploaded_by.name}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => <RowActions document={row.original} canManage={canManage} />,
      },
    );

    return defined;
  }, [canManage, showProject]);

  const filtered = Boolean(from || to);

  return (
    <DataTable
      columns={columns}
      data={visible}
      searchPlaceholder="Search by name, category or site"
      // Twenty-five fits a laptop screen without scrolling past the header, and a builder looking
      // for one drawing searches rather than pages.
      pageSize={25}
      emptyMessage={
        filtered ? 'Nothing was filed in that range.' : 'Nothing matches that.'
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-ink-muted">Filed</span>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Filed on or after"
          />
          <span className="text-[12.5px] text-ink-muted">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Filed on or before"
          />
          {/*
            Only once a range is set. A clear button that does nothing is one more thing to read on
            a toolbar somebody uses every day.
          */}
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              <X className="size-4" />
              Clear
            </Button>
          )}
          <span className="text-[12.5px] text-ink-faint">
            {filtered
              ? `${visible.length} of ${documents.length}`
              : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
          </span>
        </div>
      }
    />
  );
}

function RowActions({
  document,
  canManage,
}: {
  document: SiteDocument;
  canManage: boolean;
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
      <div className="flex items-center justify-end gap-1">
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
  );
}

/**
 * Uploading, either as a new document or as the next revision of one.
 *
 * A revision takes its title, category and sharing from what it replaces — those belong to the
 * document, not to one version of it — so the form for a revision asks only for the file.
 */
/** Stands for "no site at all", which `Select` cannot express with an empty string. */
const NO_SITE = '__none__';

function UploadDialog({
  projectId,
  supersedes,
  trigger,
  sites,
}: {
  projectId: string | null;
  supersedes?: SiteDocument;
  trigger?: React.ReactNode;
  /** Present only when the caller has no site of its own to file against. */
  sites?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('drawing');
  const [share, setShare] = useState(false);
  /**
   * Which site this is filed against when the page has not already decided.
   *
   * `NO_SITE` rather than an empty string: a document belonging to the company rather than one job
   * — the GST certificate, the standard contract template — is a real thing the API supports with
   * a null `project_id`, and it needs to be distinguishable from "not chosen yet".
   */
  const [chosenSite, setChosenSite] = useState<string>(NO_SITE);
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

    // The page's site if it has one, otherwise whatever was picked — and null for a document that
    // belongs to the company rather than to any one job.
    const targetProjectId = projectId ?? (chosenSite === NO_SITE ? null : chosenSite);

    start(async () => {
      const presigned = await presignUpload({
        kind: 'document',
        content_type: file.type || 'application/octet-stream',
        content_length: file.size,
        ...(targetProjectId ? { project_id: targetProjectId } : {}),
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
        project_id: targetProjectId,
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

          {!supersedes && sites && (
            <Field label="Which site">
              <Select value={chosenSite} onValueChange={setChosenSite}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SITE}>Not a site — company-wide</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

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
