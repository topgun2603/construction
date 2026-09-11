'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { GripVertical, ImagePlus, Loader2, Play, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import {
  addProjectMedia,
  updateProjectMedia,
  presignUpload,
  removeProjectMedia,
  reorderProjectMedia,
  viewUrl,
} from '@/lib/actions';
import type { ProjectMedia } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { shortDate } from '@/lib/format';

/**
 * Photos and videos of the site.
 *
 * Bytes go straight from the browser to storage through a presigned URL and never pass through the
 * app server — which is what keeps a 200 MB walkthrough video from occupying a request thread. The
 * record that the file exists is written afterwards, so a failed upload leaves nothing behind.
 *
 * View URLs are signed on demand and expire. The objects stay private, so a link that leaks stops
 * working rather than becoming a permanent window into somebody's site.
 *
 * The order here is the order the site's card carries, and its first photo is the main image. One
 * mechanism, not two: a "main image" flag alongside a hand-arranged gallery would eventually
 * disagree with it, and then the card would be leading with something the gallery says is third.
 */
export function SiteGallery({
  projectId,
  media,
  canEdit,
}: {
  projectId: string;
  media: ProjectMedia[];
  canEdit: boolean;
}) {
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [, start] = useTransition();

  /*
   * A local copy so a drag redraws at the speed of the hand rather than the speed of the network.
   * The server's order wins whenever it arrives — including after a refused reorder, which is how a
   * failed drag snaps back.
   */
  const [items, setItems] = useState(media);
  const dragging = useRef<string | null>(null);
  useEffect(() => setItems(media), [media]);

  function commit(next: ProjectMedia[]) {
    const before = items;
    setItems(next);
    start(async () => {
      const result = await reorderProjectMedia({
        projectId,
        mediaIds: next.map((row) => row.id),
      });
      if (!result.ok) {
        setItems(before);
        toast.error(result.error ?? 'Could not save that order');
      }
    });
  }

  /** Moves one file to a new index, leaving the rest in their relative order. */
  function move(id: string, to: number) {
    const from = items.findIndex((row) => row.id === id);
    if (from === -1 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const moved = next.splice(from, 1);
    next.splice(to, 0, ...moved);
    commit(next);
  }

  /** Live preview while a file is held over another: the gap opens before the drop. */
  function previewOver(id: string, overIndex: number) {
    setItems((current) => {
      const from = current.findIndex((row) => row.id === id);
      if (from === -1 || from === overIndex) return current;
      const next = [...current];
      const moved = next.splice(from, 1);
      next.splice(overIndex, 0, ...moved);
      return next;
    });
  }

  async function upload(files: FileList) {
    const list = [...files];
    setUploading({ done: 0, total: list.length });

    for (const [index, file] of list.entries()) {
      const isVideo = file.type.startsWith('video/');
      const cap = isVideo ? MAX_UPLOAD_BYTES.video : MAX_UPLOAD_BYTES.image;
      if (file.size > cap) {
        toast.error(
          `${file.name} is too large — ${isVideo ? 'videos' : 'photos'} are limited to ${Math.round(cap / 1024 / 1024)} MB`,
        );
        continue;
      }

      const presigned = await presignUpload({
        kind: 'site_media',
        content_type: file.type,
        content_length: file.size,
        project_id: projectId,
      });
      if (!presigned.ok || !presigned.data) {
        toast.error(presigned.error ?? `Could not prepare ${file.name}`);
        continue;
      }

      // Straight to storage. The signed headers must be replayed exactly or the PUT is rejected.
      const put = await fetch(presigned.data.url, {
        method: 'PUT',
        headers: presigned.data.headers,
        body: file,
      });
      if (!put.ok) {
        toast.error(`Upload failed for ${file.name}`);
        continue;
      }

      const recorded = await addProjectMedia({
        projectId,
        kind: isVideo ? 'video' : 'photo',
        s3_key: presigned.data.s3_key,
        content_type: file.type,
        size_bytes: file.size,
      });
      if (!recorded.ok) toast.error(recorded.error ?? `Could not attach ${file.name}`);

      setUploading({ done: index + 1, total: list.length });
    }

    setUploading(null);
    toast.success(list.length === 1 ? 'File added' : `${list.length} files added`);
  }

  // The card cannot show a video, so the main image is the first photo — which is not necessarily
  // the first file, once somebody has put the walkthrough at the front.
  const mainId = items.find((row) => row.kind === 'photo')?.id ?? null;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Site photos and videos
            </span>
            {items.length > 0 && (
              <span className="font-mono text-[13px] text-ink-muted">{items.length}</span>
            )}
          </div>
          {canEdit && items.length > 1 && (
            <span className="text-[12px] text-ink-faint">
              Drag to reorder — the first photo leads this site&rsquo;s card.
            </span>
          )}
        </div>
        {canEdit && (
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="sr-only"
              disabled={uploading !== null}
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) start(() => void upload(files));
                event.target.value = '';
              }}
            />
            <span className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-[13px] font-medium transition hover:bg-raised">
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {uploading.done} of {uploading.total}
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  Add files
                </>
              )}
            </span>
          </label>
        )}
      </div>

      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<ImagePlus />}
            title="No photos of this site yet"
            body="Add photographs of the approach, the elevation, anything a person who has never been here would need. Videos work too."
          />
        </div>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <MediaTile
              key={item.id}
              projectId={projectId}
              media={item}
              index={index}
              count={items.length}
              isMain={item.id === mainId}
              canEdit={canEdit}
              onDragStart={() => {
                dragging.current = item.id;
              }}
              onDragEnterTile={() => {
                if (dragging.current && dragging.current !== item.id) {
                  previewOver(dragging.current, index);
                }
              }}
              onDropTile={() => {
                dragging.current = null;
                // The preview already put it where it belongs; this saves what is on screen.
                commit(items);
              }}
              onMove={(to) => move(item.id, to)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One photo or video.
 *
 * The view URL is fetched after mount rather than server-rendered with the list. A signed URL has a
 * lifetime, and baking one into the HTML means a page restored from the browser's back-forward cache
 * shows broken images — this way the tile asks for a fresh one each time it mounts.
 */
function MediaTile({
  projectId,
  media,
  index,
  count,
  isMain,
  canEdit,
  onDragStart,
  onDragEnterTile,
  onDropTile,
  onMove,
}: {
  projectId: string;
  media: ProjectMedia;
  index: number;
  count: number;
  isMain: boolean;
  canEdit: boolean;
  onDragStart: () => void;
  onDragEnterTile: () => void;
  onDropTile: () => void;
  onMove: (to: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [held, setHeld] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void viewUrl(media.thumb_s3_key ?? media.s3_key).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setUrl(result.data.url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [media.s3_key, media.thumb_s3_key]);

  function caption(next: string) {
    if (next.trim() === (media.caption ?? '')) {
      setEditing(false);
      return;
    }
    start(async () => {
      const result = await updateProjectMedia({
        projectId,
        mediaId: media.id,
        caption: next.trim() || null,
      });
      if (result.ok) toast.success('Caption saved');
      else toast.error(result.error ?? 'Could not save that');
      setEditing(false);
    });
  }

  return (
    <li
      draggable={canEdit}
      onDragStart={(event) => {
        // Firefox refuses to start a drag with no payload, and setting our own stops the anchor
        // inside from handing the signed URL to whatever the tile is dropped on.
        event.dataTransfer.setData('text/plain', media.id);
        event.dataTransfer.effectAllowed = 'move';
        setHeld(true);
        onDragStart();
      }}
      onDragEnd={() => setHeld(false)}
      onDragEnter={onDragEnterTile}
      onDragOver={(event) => {
        // Without this the drop is refused and the browser animates the tile flying back.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        setHeld(false);
        onDropTile();
      }}
      className={`group flex flex-col overflow-hidden rounded-panel border bg-surface transition ${
        held ? 'border-accent opacity-60' : 'border-line'
      }`}
    >
      <div className="relative aspect-[4/3] bg-neutral-bg">
        {failed ? (
          <span className="flex h-full items-center justify-center text-[13px] text-ink-faint">
            Could not load
          </span>
        ) : !url ? (
          <span className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-ink-faint" />
          </span>
        ) : media.kind === 'video' ? (
          <video
            src={url}
            controls
            preload="metadata"
            className="h-full w-full bg-ink object-contain"
          />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            draggable={false}
            className="block h-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={media.caption ?? 'Site photo'}
              draggable={false}
              className="h-full w-full object-cover transition group-hover:brightness-[.92]"
              loading="lazy"
            />
          </a>
        )}

        {media.kind === 'video' && !url && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Play className="size-8 text-white/70" />
          </span>
        )}

        {/*
          The badge stays visible without hovering — which photo leads the site is a fact about the
          site, not a control, and somebody scanning the grid needs to see it at a glance.
        */}
        {isMain && (
          <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink/70 px-2 py-1 text-[11px] font-medium text-white">
            <Star className="size-3 fill-current" />
            Main image
          </span>
        )}

        {canEdit && (
          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            {/*
              Videos are never the main image — the card shows a still, and a video has no frame to
              show without decoding it — but they can still be moved around the gallery.
            */}
            {media.kind === 'photo' && !isMain && (
              <Button
                size="icon"
                variant="secondary"
                className="size-8 shadow-float"
                aria-label="Make this the main image"
                title="Make this the main image"
                onClick={() => onMove(0)}
              >
                <Star className="size-4" />
              </Button>
            )}
            <ConfirmDialog
              title="Remove this file?"
              body={
                <>
                  {media.caption ? (
                    <>
                      <strong className="font-semibold text-ink">{media.caption}</strong> comes off
                      the site.
                    </>
                  ) : (
                    'This file comes off the site.'
                  )}{' '}
                  It stops appearing here immediately; the stored file itself is kept.
                  {isMain && ' The site card falls back to the next photo.'}
                </>
              }
              confirmLabel="Remove file"
              successMessage="Removed"
              onConfirm={() => removeProjectMedia({ projectId, mediaId: media.id })}
              trigger={
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 shadow-float"
                  aria-label="Remove this file"
                  title="Remove this file"
                >
                  <Trash2 className="size-4" />
                </Button>
              }
            />
          </div>
        )}

        {/*
          The handle is the keyboard and touch route to reordering: dragging is a mouse gesture, and
          HTML5 drag events do not fire on a phone at all. Arrow keys move the file one place.
        */}
        {canEdit && count > 1 && (
          <button
            type="button"
            aria-label={`Move this file — currently ${index + 1} of ${count}`}
            title="Drag to reorder, or use the arrow keys"
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                onMove(index - 1);
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                onMove(index + 1);
              }
            }}
            className="absolute bottom-2 left-2 grid size-8 cursor-grab place-items-center rounded-control bg-ink/60 text-white opacity-0 transition hover:bg-ink/80 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        )}
      </div>

      <figcaption className="flex flex-col gap-0.5 px-3 py-2.5">
        {editing ? (
          <Input
            defaultValue={media.caption ?? ''}
            autoFocus
            maxLength={200}
            placeholder="What is this?"
            onBlur={(event) => caption(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setEditing(false);
            }}
            className="h-9"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setEditing(true)}
            className="truncate text-left text-[13.5px] font-medium disabled:cursor-default"
          >
            {media.caption ?? (
              <span className="text-ink-faint">{canEdit ? 'Add a caption' : 'No caption'}</span>
            )}
          </button>
        )}
        <span className="text-[12px] text-ink-muted">
          {media.uploaded_by.name} · {shortDate((media.taken_at ?? media.created_at).slice(0, 10))}
        </span>
      </figcaption>
    </li>
  );
}
