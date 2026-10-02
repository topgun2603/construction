'use client';

import { useState } from 'react';
import { ExternalLink, Image as ImageIcon, Map as MapIcon, MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';

const GOOGLE_KEY = process.env['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'] ?? '';
const MAP_HEIGHT = 240;
const MAP_WIDTH = 760;

/**
 * Where the site is.
 *
 * **Static images, not a mapping SDK.** A site map is a picture nobody pans; it exists so somebody
 * recognises the place before they read the name. The Maps JavaScript API is ~200 KB and an
 * instance per card for that, on the page a supervisor opens most often over 3G. Two `<img>` tags
 * do the job: Google renders them, the browser caches them.
 *
 * **Three views, because a construction site is three different things to look at.** The map tells
 * you which roads reach it. The satellite view tells you what is actually on the plot, which for a
 * site that is currently a field is the only one that means anything. Street View tells you what
 * the gate looks like, which is what a driver needs.
 *
 * Street View is offered rather than assumed: a plot on an unmade road usually has no imagery, and
 * the API answers that with a grey "no imagery" tile. The switch only appears after the metadata
 * endpoint says there is something there.
 */
export function SiteMap({
  lat,
  lng,
  address,
  name,
  className,
  zoom = 16,
}: {
  lat: number | null;
  lng: number | null;
  address?: string | null;
  name?: string;
  className?: string;
  /** Google zoom level — 16 shows a plot and the roads around it. Higher is closer in. */
  zoom?: number;
}) {
  const [view, setView] = useState<'map' | 'satellite' | 'street'>('map');
  const [streetAvailable, setStreetAvailable] = useState<boolean | null>(null);

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

  const point = `${lat},${lng}`;
  // The app people actually drive with, whatever renders the picture above it.
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${point}`;

  /*
   * Street View is only offered once its metadata endpoint confirms imagery within 50 m. The call
   * is free and unmetered, which is the whole reason to make it rather than show a grey tile.
   */
  if (GOOGLE_KEY && streetAvailable === null) {
    void fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${point}&radius=50&key=${GOOGLE_KEY}`,
    )
      .then((response) => response.json())
      .then((body: { status?: string }) => setStreetAvailable(body.status === 'OK'))
      .catch(() => setStreetAvailable(false));
  }

  const staticMap = (type: 'roadmap' | 'hybrid') =>
    `https://maps.googleapis.com/maps/api/staticmap?center=${point}&zoom=${zoom}&size=${MAP_WIDTH}x${MAP_HEIGHT}&scale=2&maptype=${type}` +
    `&markers=color:0x6C4CE0%7C${point}&key=${GOOGLE_KEY}`;

  const streetView =
    `https://maps.googleapis.com/maps/api/streetview?size=${MAP_WIDTH}x${MAP_HEIGHT}&location=${point}` +
    `&fov=80&pitch=5&source=outdoor&key=${GOOGLE_KEY}`;

  const source =
    view === 'street' ? streetView : staticMap(view === 'satellite' ? 'hybrid' : 'roadmap');

  const TABS = [
    { id: 'map' as const, label: 'Map', icon: MapIcon, show: true },
    { id: 'satellite' as const, label: 'Satellite', icon: ImageIcon, show: true },
    { id: 'street' as const, label: 'Street', icon: Navigation, show: streetAvailable === true },
  ].filter((tab) => tab.show);

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-panel border border-line', className)}>
      {!GOOGLE_KEY ? (
        <div
          className="flex items-center justify-center bg-neutral-bg px-4 text-center text-[13px] text-ink-muted"
          style={{ height: MAP_HEIGHT }}
        >
          Map images need NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. The coordinates and the directions link
          below still work.
        </div>
      ) : (
        <div className="relative bg-neutral-bg" style={{ height: MAP_HEIGHT }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={view}
            src={source}
            alt={name ? `${view === 'street' ? 'Street view' : 'Map'} of ${name}` : 'Site location'}
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            loading="lazy"
            draggable={false}
            className="size-full select-none object-cover"
          />

          {TABS.length > 1 && (
            <div className="absolute left-2 top-2 flex overflow-hidden rounded-btn border border-line bg-surface/95 shadow-sm backdrop-blur-sm">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className={cn(
                    'flex min-h-0 items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium transition',
                    view === tab.id
                      ? 'bg-accent text-white'
                      : 'text-ink-soft hover:bg-neutral-bg',
                  )}
                >
                  <tab.icon className="size-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          )}
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
