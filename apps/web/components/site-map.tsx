'use client';

import { ExternalLink, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Where the site is.
 *
 * OpenStreetMap's embed rather than Google Maps, for one reason: Google's embed and static-tile APIs
 * both require a billed API key, and this deployment has none. A map that renders is worth more than
 * a grey box waiting on a key somebody has to buy first — and the "open in Google Maps" link below
 * still hands the driver the app they will actually navigate with.
 *
 * An iframe rather than a mapping library: Leaflet plus its tiles is ~150 KB for a picture nobody
 * pans on a site page, and it would be the heaviest thing on a screen a supervisor loads over 3G.
 */
export function SiteMap({
  lat,
  lng,
  address,
  name,
  className,
  zoom = 0.008,
}: {
  lat: number | null;
  lng: number | null;
  address?: string | null;
  name?: string;
  className?: string;
  /** Half-width of the bounding box in degrees. Smaller is closer in. */
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

  const box = [lng - zoom, lat - zoom, lng + zoom, lat + zoom].join(',');
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${lat},${lng}`;
  // The link people actually navigate with, whatever renders the picture above it.
  const directions = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-panel border border-line', className)}>
      <iframe
        title={name ? `Map of ${name}` : 'Site location'}
        src={embed}
        loading="lazy"
        // No script access needed, and the map is third-party content on a page that holds a session.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="h-[240px] w-full border-0 bg-neutral-bg"
      />
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
