'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Check,
  CheckCheck,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  Paperclip,
  Send,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import {
  deleteSiteMessage,
  markMessagesRead,
  postSiteMessage,
  presignUpload,
} from '@/lib/actions';
import type { MessagePerson, SiteMessage } from '@/lib/api-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { relativeTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Pending {
  file: File;
  /** An object URL for an image, null for anything else. */
  preview: string | null;
}

type Audience = 'everyone' | 'team' | 'direct';

/**
 * The conversation on a site.
 *
 * Three audiences, and which one is selected is never in doubt: the choice is a labelled row above
 * the box you type into, the box changes colour with it, and every message is drawn in the colour
 * of the audience it was written to. The cost of being wrong about that is a note about a client
 * landing in the client's own thread, so it is stated everywhere rather than once.
 *
 *   * **Everyone** — the client and the team, which is what the portal is for.
 *   * **Team only** — offered to whoever holds `messages.internal`, and never to a client.
 *   * **One person** — a named recipient. Anybody who can post may send one, the client included:
 *     the most ordinary thing on a site is asking one person something, and a thread that can only
 *     broadcast sends those conversations back to WhatsApp.
 *
 * Laid out as a chat — oldest at the top, newest at the bottom, your own words on the right —
 * because a client who has to learn a new metaphor to ask a question asks it somewhere else.
 */
export function SiteConversation({
  projectId,
  messages,
  recipients,
  canPost,
  canWriteInternal,
}: {
  projectId: string;
  messages: SiteMessage[];
  /** Who can be written to privately on this site. */
  recipients: MessagePerson[];
  canPost: boolean;
  /** Whether team-only notes are even offered. */
  canWriteInternal: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [recipientId, setRecipientId] = useState<string>('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Object URLs are a leak if nobody revokes them.
  useEffect(
    () => () => files.forEach((entry) => entry.preview && URL.revokeObjectURL(entry.preview)),
    [files],
  );

  /*
   * Opening the thread is reading it.
   *
   * Fired once per mount rather than on scroll: this list is short enough to take in, and a receipt
   * that waits for somebody to scroll to the bottom tells the other side "not seen" about a message
   * sitting on their screen.
   */
  useEffect(() => {
    void markMessagesRead(projectId);
  }, [projectId]);

  // The API returns newest first for paging; a conversation reads the other way round.
  const thread = [...messages].reverse();

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: Pending[] = [];
    for (const file of [...list]) {
      if (file.size > MAX_UPLOAD_BYTES.image) {
        toast.error(`${file.name} is too large`);
        continue;
      }
      accepted.push({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    setFiles((current) => [...current, ...accepted]);
  }

  function send() {
    if (!body.trim() && files.length === 0) return;
    if (audience === 'direct' && !recipientId) {
      setError('Choose who this is for');
      return;
    }
    setError(null);

    start(async () => {
      const attachments: Array<{
        s3_key: string;
        content_type: string;
        size_bytes: number;
        filename?: string;
      }> = [];
      for (const entry of files) {
        const contentType = entry.file.type || 'application/octet-stream';
        const presigned = await presignUpload({
          kind: 'message_attachment',
          content_type: contentType,
          content_length: entry.file.size,
          project_id: projectId,
        });
        if (!presigned.ok || !presigned.data) {
          setError(presigned.error ?? `Could not prepare ${entry.file.name}`);
          return;
        }
        const put = await fetch(presigned.data.url, {
          method: 'PUT',
          headers: presigned.data.headers,
          body: entry.file,
        });
        if (!put.ok) {
          setError(`Upload failed for ${entry.file.name}`);
          return;
        }
        attachments.push({
          s3_key: presigned.data.s3_key,
          content_type: contentType,
          size_bytes: entry.file.size,
          // A photograph is its own label; everything else is only findable by name.
          ...(entry.preview ? {} : { filename: entry.file.name.slice(0, 200) }),
        });
      }

      const result = await postSiteMessage({
        projectId,
        body: body.trim(),
        audience,
        ...(audience === 'direct' ? { recipientId } : {}),
        attachments,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not send that');
        return;
      }
      setBody('');
      setFiles([]);
      router.refresh();
    });
  }

  const options: Array<{ value: Audience; label: string; hint: string; icon: typeof Users }> = [
    { value: 'everyone', label: 'Everyone', hint: 'The client and the team', icon: Users },
    ...(canWriteInternal
      ? [
          {
            value: 'team' as const,
            label: 'Team only',
            hint: 'The client never sees this',
            icon: Lock,
          },
        ]
      : []),
    ...(recipients.length > 0
      ? [
          {
            value: 'direct' as const,
            label: 'One person',
            hint: 'Only you and them',
            icon: User,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {thread.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nothing said yet"
          body={
            canPost
              ? 'Questions from the client and answers from the site live here, against the job, instead of in somebody’s WhatsApp.'
              : 'Questions and answers about this site will appear here.'
          }
        />
      ) : (
        <Card className="flex flex-col">
          <ol className="flex flex-col gap-4 p-4">
            {thread.map((message) => (
              <Message key={message.id} message={message} projectId={projectId} />
            ))}
          </ol>
        </Card>
      )}

      {canPost && (
        <Card
          className={cn(
            'flex flex-col gap-3 p-4 transition-colors',
            audience === 'team' && 'border-pending-line bg-pending-bg/30',
            audience === 'direct' && 'border-accent-soft bg-accent-soft/15',
          )}
        >
          {options.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-btn bg-neutral-bg p-1">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAudience(option.value)}
                    aria-pressed={audience === option.value}
                    title={option.hint}
                    className={cn(
                      'flex min-h-0 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition',
                      audience === option.value
                        ? 'bg-surface font-semibold text-ink shadow-seg'
                        : 'text-ink-soft hover:text-ink',
                    )}
                  >
                    <option.icon className="size-3.5" />
                    {option.label}
                  </button>
                ))}
              </div>

              {audience === 'direct' && (
                <Select value={recipientId} onValueChange={setRecipientId}>
                  <SelectTrigger className="h-9 w-auto min-w-[210px]">
                    <SelectValue placeholder="Who is this for?" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name} · {titleCase(person.role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={
              audience === 'team'
                ? 'A note for the team. The client will not see this.'
                : audience === 'direct'
                  ? 'Only the person you choose will see this.'
                  : 'Write to the client and the site team…'
            }
          />

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((entry, index) => (
                <span key={`${entry.file.name}-${index}`} className="relative">
                  {entry.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.preview}
                      alt=""
                      className="size-20 rounded-panel border border-line object-cover"
                    />
                  ) : (
                    <span className="flex size-20 flex-col items-center justify-center gap-1 rounded-panel border border-line bg-neutral-bg px-1.5 text-center">
                      <FileText className="size-5 text-ink-faint" />
                      <span className="line-clamp-2 break-all text-[10px] leading-tight text-ink-soft">
                        {entry.file.name}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${entry.file.name}`}
                    onClick={() =>
                      setFiles((current) => {
                        const going = current[index];
                        if (going?.preview) URL.revokeObjectURL(going.preview);
                        return current.filter((_, position) => position !== index);
                      })
                    }
                    className="absolute right-1 top-1 grid size-5 min-h-0 place-items-center rounded-full bg-ink/70 text-white"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => photoInput.current?.click()}
              >
                <ImagePlus className="size-4" /> Photo
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-4" /> File
              </Button>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={send}
              disabled={pending || (!body.trim() && files.length === 0)}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {audience === 'team'
                ? 'Post team note'
                : audience === 'direct'
                  ? 'Send privately'
                  : 'Send'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Message({ message, projectId }: { message: SiteMessage; projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const team = message.audience === 'team';
  const direct = message.audience === 'direct';

  return (
    <li className={cn('flex gap-3', message.mine && 'flex-row-reverse')}>
      <Avatar name={message.author.name} />
      <div className={cn('flex max-w-[min(560px,80%)] flex-col gap-1', message.mine && 'items-end')}>
        <div className={cn('flex items-baseline gap-2', message.mine && 'flex-row-reverse')}>
          <span className="text-[13px] font-semibold">{message.author.name}</span>
          {/* Rendered once on the server and again here; a minute either way must not throw. */}
          <span className="text-[12px] text-ink-faint" suppressHydrationWarning>
            {titleCase(message.author.role)} · {relativeTime(message.created_at)}
          </span>
        </div>

        <div
          className={cn(
            'flex flex-col gap-2 rounded-panel border px-3.5 py-2.5',
            team
              ? // A different ground and a padlock, so a private note can never be mistaken for
                // something the client is reading.
                'border-pending-line bg-pending-bg'
              : direct
                ? 'border-accent-soft bg-accent-soft/45'
                : message.mine
                  ? 'border-accent-soft bg-accent-soft/40'
                  : 'border-line bg-raised',
          )}
        >
          {team && (
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-pending-fg">
              <Lock className="size-3" /> Team only — the client cannot see this
            </span>
          )}
          {direct && (
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-accent">
              <User className="size-3" />
              {message.mine
                ? `Private to ${message.recipient?.name ?? 'one person'}`
                : 'Private — sent only to you'}
            </span>
          )}

          {message.body && (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.body}</p>
          )}

          {message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((attachment) =>
                attachment.is_image && attachment.url ? (
                  <a
                    key={attachment.id}
                    href={attachment.full_url ?? attachment.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.url}
                      alt={attachment.caption ?? 'Attachment'}
                      loading="lazy"
                      className="size-24 rounded-btn border border-line object-cover transition hover:brightness-95"
                    />
                  </a>
                ) : attachment.full_url ? (
                  // A file has nothing to show, so the row says what it is instead.
                  <a
                    key={attachment.id}
                    href={attachment.full_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex max-w-[240px] items-center gap-2.5 rounded-btn border border-line bg-surface px-3 py-2 transition hover:border-accent"
                  >
                    <FileText className="size-5 flex-none text-ink-faint" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium">
                        {attachment.filename ?? 'Attachment'}
                      </span>
                      <span className="text-[11.5px] text-ink-muted">
                        {Math.max(1, Math.round(attachment.size_bytes / 1024))} KB
                      </span>
                    </span>
                  </a>
                ) : (
                  <span
                    key={attachment.id}
                    className="grid size-24 place-items-center rounded-btn border border-line bg-neutral-bg text-[11px] text-ink-faint"
                  >
                    Not available
                  </span>
                ),
              )}
            </div>
          )}
        </div>

        {(message.mine || message.can_delete) && (
          <div className="flex items-center gap-3">
            {message.mine && <ReadReceipt readBy={message.read_by} />}
            {/*
              Offered only while the server says it would work. After half an hour the control is
              gone rather than greyed out — a disabled button invites the click that explains the
              rule, and there is nothing to be done about it by then anyway.
            */}
            {message.can_delete && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await deleteSiteMessage(projectId, message.id);
                    if (!result.ok) toast.error(result.error ?? 'Could not remove that');
                    else router.refresh();
                  })
                }
                className="flex items-center gap-1 text-[12px] text-ink-faint transition hover:text-blocked"
              >
                <Trash2 className="size-3" /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Whether anybody has read it.
 *
 * One tick for sent, two for seen, and the names on hover — the grammar everybody already knows
 * from their phone, so it needs no explaining. Only on your own messages: "has the client read my
 * answer" is the question this settles, and showing who has read everybody else's would turn a
 * receipt into a team watching each other's reading habits.
 */
function ReadReceipt({ readBy }: { readBy: SiteMessage['read_by'] }) {
  if (readBy.length === 0) {
    return (
      <span
        className="flex items-center gap-1 text-[12px] text-ink-faint"
        title="Sent — not read yet"
      >
        <Check className="size-3.5" /> Sent
      </span>
    );
  }

  const names = readBy.map((person) => person.name);
  return (
    <span
      className="flex items-center gap-1 text-[12px] text-accent"
      title={`Read by ${names.join(', ')}`}
    >
      <CheckCheck className="size-3.5" />
      {names.length === 1 ? `Read by ${names[0]}` : `Read by ${names.length}`}
    </span>
  );
}
