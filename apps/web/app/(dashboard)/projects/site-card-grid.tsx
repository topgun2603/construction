'use client';

import Link from 'next/link';
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { ProjectListItem } from '@/lib/api-types';
import { SiteCoverFallback } from '@/components/site-cover-fallback';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MeterRow } from '@/components/ui/meter';
import { moneyShort, shortDate } from '@/lib/format';
import { byTrouble, schedule, statusLabel, statusTone } from '@/lib/projects';

/**
 * The sites list as cards, led by photographs of the site.
 *
 * A table of names and dates is the same shape whether it lists sites, invoices or workers; a builder
 * with six jobs recognises them by what they look like long before they read a name. The photo is the
 * primary identifier, which is why it is the largest thing on the card.
 *
 * Several photos are shown as a carousel, the main image first — the one chosen in the site's gallery,
 * or failing that the most recent. A site with no photograph gets a generated cover rather than a
 * shared placeholder.
 *
 * Sorted by trouble rather than alphabet, matching the overview: the sites that need somebody float up.
 */
export function SiteCardGrid({
  projects,
  toolbar,
}: {
  projects: ProjectListItem[];
  /** Controls sitting beside the search box — the same slot the table's toolbar uses. */
  toolbar?: ReactNode;
}) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? projects.filter((project) =>
          [project.name, project.client_name, project.address]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(needle)),
        )
      : projects;
    return [...matched].sort(byTrouble);
  }, [projects, query]);

  return (
    <div className="flex flex-col gap-3">
      {/*
        One row: search on the left, controls on the right. Matching the table's toolbar exactly,
        because these two views sit behind the same toggle and any difference in where the search
        box lands reads as the page jumping.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sites, clients, addresses"
            className="pl-9"
            aria-label="Search sites"
          />
        </div>
        {toolbar}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line-strong bg-raised px-5 py-8 text-center text-[13.5px] text-ink-muted">
          No sites match that search.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <SiteCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteCard({ project }: { project: ProjectListItem }) {
  const timeline = schedule(project);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-panel border border-line bg-surface transition hover:border-line-strong"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-neutral-bg">
        <Cover project={project} />

        {/* Status sits on the image, where the eye already is. */}
        <span className="absolute left-3 top-3">
          <Badge tone={statusTone(project.status)}>{statusLabel(project.status)}</Badge>
        </span>

        {project.photo_count > 0 && (
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-2 py-1 font-mono text-[11.5px] text-white">
            <Camera className="size-3" />
            {project.photo_count}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[16px] font-semibold leading-snug">{project.name}</span>
          <span className="truncate text-[13px] leading-tight text-ink-muted">
            {[project.client_name, project.address].filter(Boolean).join(' · ') || 'No client set'}
          </span>
        </div>

        {timeline ? (
          <MeterRow
            label="Schedule elapsed"
            value={`${timeline.elapsedPercent}%`}
            percent={timeline.elapsedPercent}
          />
        ) : (
          <span className="text-[12.5px] text-ink-faint">No dates set</span>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3 text-[13px]">
          <span className="font-mono text-ink-muted">
            {project.budget_amount ? moneyShort(project.budget_amount) : 'No budget'}
          </span>
          <span className="text-ink-muted">
            {project.target_end_date ? `Handover ${shortDate(project.target_end_date)}` : '—'}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * The carousel: a photograph if there is one, otherwise a generated cover.
 *
 * The map that used to sit here has gone. Two reasons, both practical: a dozen cards meant a dozen
 * live tile sessions for pictures nobody pans, and at 320 pixels wide a locality map is mostly grey
 * with a pin — two sites in the same suburb looked identical, which is the one thing a cover must not
 * do. The real map is on the site page, full size, where somebody has actually asked to see it.
 *
 * Every control here cancels the event. The whole card is a `<Link>`, so a bare click on an arrow
 * would navigate to the site instead of advancing the photo — the same class of bug as a delete button
 * inside a clickable table row.
 */
function Cover({ project }: { project: ProjectListItem }) {
  const [index, setIndex] = useState(0);

  if (project.covers.length === 0) {
    /*
     * A generated cover, not a shared placeholder. Every unphotographed site would otherwise look
     * identical, which defeats the point of leading the card with an image.
     */
    return (
      <>
        <SiteCoverFallback seed={project.id} name={project.name} />
        <span className="absolute bottom-3 left-3 rounded-full bg-ink/55 px-2 py-1 text-[11px] font-medium text-white/90">
          No photo yet
        </span>
      </>
    );
  }

  const count = project.covers.length;
  // Wraps both ways: a two-photo site is quicker to flip back and forth than to run to the end.
  const go = (delta: number) => (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIndex((current) => (current + delta + count) % count);
  };

  return (
    <>
      {/*
        All the photos are rendered and cross-faded rather than swapped. The signed URLs are already
        in hand, and a browser that has not decoded the next image yet would otherwise flash the
        empty panel on every click.
      */}
      {project.covers.map((cover, position) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cover.id}
          src={cover.url}
          alt=""
          // The first is the main image and carries the card, so it is never deferred.
          loading={position === 0 ? 'eager' : 'lazy'}
          aria-hidden={position !== index}
          /*
           * The one on show is lifted above the rest rather than the last one painting over
           * everything, and the ones behind take no clicks — otherwise the photo you are looking at
           * is underneath a stack of invisible ones.
           */
          className={`absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${
            position === index
              ? 'z-[1] opacity-100'
              : 'pointer-events-none z-0 opacity-0'
          }`}
        />
      ))}

      {count > 1 && (
        <>
          {/* Arrows appear on hover on a mouse, and are always visible on touch, which has no hover. */}
          <CarouselArrow side="left" onClick={go(-1)} />
          <CarouselArrow side="right" onClick={go(1)} />

          {/*
            `min-h-0` on purpose: the app gives every button a 44px minimum for gloved hands, which
            on a 6px dot produces a tall bar rather than a dot. The hit area is restored around it
            instead — a 24px box with the dot centred, so the target survives and the mark is round.
          */}
          <span className="absolute inset-x-0 bottom-1 z-10 flex justify-center">
            {project.covers.map((cover, position) => (
              <button
                key={cover.id}
                type="button"
                aria-label={`Photo ${position + 1} of ${count}`}
                aria-current={position === index}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIndex(position);
                }}
                className="grid size-6 min-h-0 place-items-center"
              >
                <span
                  className={`h-1.5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,.55)] transition-all ${
                    position === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
                  }`}
                />
              </button>
            ))}
          </span>
        </>
      )}
    </>
  );
}

function CarouselArrow({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: (event: ReactMouseEvent) => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={`absolute top-1/2 z-10 grid size-8 min-h-0 -translate-y-1/2 place-items-center rounded-full bg-ink/55 text-white opacity-100 transition hover:bg-ink/75 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
}
