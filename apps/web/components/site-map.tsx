'use client';

import { ExternalLink, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tilesFor } from '@/lib/tiles';

const MAPTILER_KEY = process.env['NEXT_PUBLIC_MAPTILER_KEY'] ?? '';
const MAP_HEIGHT = 240;

/**
 * Where the site is.
 *
 * **MapTiler, not OpenStreetMap's own servers.** This used to embed `openstreetmap.org/export/embed`
 * — a page meant for casual embedding, run by volunteers, whose usage policy is enforced by
 * blocking. It blocked us: every tile came back as a striped "Access blocked" image, on every
 * customer's site page at once. Their tiles are not free infrastructure for a commercial product,
 * and no amount of correct headers changes that.
 *
 * **Images rather than a mapping library.** A site map is a picture nobody pans; it exists so
 * somebody recognises the place before they read the name. Leaflet is ~150 KB for that, on the page
 * a supervisor opens most often over 3G. `tilesFor` works out which tiles cover the point and where
 * to put them, and the browser does the rest with `<img>`.
 *
 * The Directions link still hands off to Google, because that is the app anybody actually drives
 * with — which is also why paying Google for the picture above it would be poor value.
 */
export function SiteMap({
  lat,
  lng,
  address,
  name,
  className,
  zoom = 15,
}: {
  lat: number | null;
  lng: number | null;
  address?: string | null;
  name?: string;
  className?: string;
  /**
   * Slippy-map zoom level, not degrees — 15 shows a plot and the roads around it, which is what
   * somebody needs to recognise a site. Higher is closer in.
   */
  zoom?: number;
}) {
  if (lat === null || lng === null) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong bg-raised px-5 py-8 text-center',
          className,
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-neutral-bg text-ink-muted">
          <MapPin className="size-5" />
        </span>
        <span className="text-[14px] font-semibold">No location set</span>
        <span className="max-w-[38ch] text-[13px] leading-relaxed text-ink-muted">
          {address
            ? 'There is an address but no coordinates. Add them when editing the site to show it on a map.'
            : 'Add coordinates when editing the site — a supervisor can capture them from the gate with one tap.'}
        </span>
      </div>
    );
  }

  // The link people actually navigate with, whatever renders the picture above it.
  const directions = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  /*
   * A fixed pixel width is needed to work out which tiles to fetch, and the card is fluid. 760 is
   * wider than the widest column this appears in, so the extra tiles are cropped rather than
   * missing — a map with a bald edge looks broken in a way a slightly over-fetched one does not.
   */
  const width = 760;
  const tiles = MAPTILER_KEY ? tilesFor(lat, lng, zoom, width, MAP_HEIGHT) : [];

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-panel border border-line', className)}>
      {tiles.length === 0 ? (
        <div
          className="flex items-center justify-center bg-neutral-bg px-4 text-center text-[13px] text-ink-muted"
          style={{ height: MAP_HEIGHT }}
        >
          Map images need NEXT_PUBLIC_MAPTILER_KEY. The coordinates and the directions link below
          still work.
        </div>
      ) : (
        <div
          role="img"
          aria-label={name ? `Map of ${name}` : 'Site location'}
          className="relative overflow-hidden bg-neutral-bg"
          style={{ height: MAP_HEIGHT }}
        >
          {tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${tile.z}/${tile.x}/${tile.y}`}
              src={`https://api.maptiler.com/maps/streets-v2/256/${tile.z}/${tile.x}/${tile.y}.png?key=${MAPTILER_KEY}`}
              alt=""
              width={256}
              height={256}
              loading="lazy"
              draggable={false}
              className="absolute max-w-none select-none"
              style={{ left: tile.left, top: tile.top }}
            />
          ))}

          {/* The pin sits at the centre because that is what the tiles were chosen around. */}
          <span className="pointer-events-none absolute left-1/2 top-1/2 -ml-3 -mt-6 text-accent drop-shadow">
            <MapPin className="size-6 fill-accent-soft" />
          </span>

          <span className="absolute bottom-0 right-0 bg-surface/80 px-1.5 py-0.5 text-[9.5px] text-ink-muted">
            © MapTiler © OpenStreetMap contributors
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-surface px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          <MapPin className="size-3.5 flex-none text-ink-faint" />
          <span className="truncate text-ink-muted">
            {address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
          </span>
        </span>
        <a
          href={directions}
          target="_blank"
          rel="noreferrer noopener"
          className="flex flex-none items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          Directions <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
