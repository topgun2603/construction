'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * Leaflet's stylesheet, imported for its side effect. Top level rather than inside the dynamic
 * import because a CSS module has no type to await â€” and it costs nothing here, since this whole
 * component is itself loaded lazily, so the CSS travels in that same chunk.
 */
import 'leaflet/dist/leaflet.css';

/**
 * Public by design: a tile key travels to the browser with every request for a tile, so hiding it
 * is not a thing that can be done. Restrict it by domain in the MapTiler console instead.
 */
const MAPTILER_KEY = process.env['NEXT_PUBLIC_MAPTILER_KEY'] ?? '';

export interface PickedLocation {
  lat: number;
  lng: number;
}

/**
 * Choosing where a building is going to be.
 *
 * Three ways in, because a plot has three ways of being described and only one of them is an address:
 *
 * - **Search** for the locality, then adjust. Gets you to the right kilometre.
 * - **Click the map** to drop the pin, and drag it to fine-tune. This is the one that matters: an
 *   empty plot on the corner of a road usually has no postal address to search for, and the owner
 *   planning it is sitting in an office rather than standing on it.
 * - **Use my location**, for the supervisor who is standing on it.
 *
 * Leaflet is imported dynamically so its ~40 KB and CSS load only when somebody opens the picker.
 * Setting a site location is an occasional office task; it has no business weighing down the roll-call
 * screen a supervisor opens on 3G every morning.
 */
export function LocationPicker({
  value,
  onChange,
  className,
}: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Array<{ label: string; lat: number; lng: number }>>([]);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Centre of India when nothing is set, so the first view is a country rather than the Atlantic.
  const initial = value ?? { lat: 20.5937, lng: 78.9629 };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || !host.current || map.current) return;

      const instance = L.map(host.current, {
        center: [initial.lat, initial.lng],
        zoom: value ? 17 : 5,
        // A site page is a scrolling page; grabbing the wheel would trap the reader inside the map.
        scrollWheelZoom: false,
        attributionControl: true,
      });

      /*
       * MapTiler, not OpenStreetMap's own tile servers.
       *
       * Theirs are volunteer-run and their usage policy is enforced by blocking â€” it blocked this
       * app, and a blocked client gets a striped "Access blocked" image in place of every tile, for
       * every customer at once. Panning a picker is exactly the pattern that trips it.
       *
       * The key is public by design and belongs in the browser; restrict it by domain in the
       * MapTiler console rather than trying to hide it.
       */
      L.tileLayer(
        `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        {
          maxZoom: 19,
          attribution: 'Â© MapTiler Â© OpenStreetMap contributors',
        },
      ).addTo(instance);

      /*
       * Leaflet's default marker points at image files resolved relative to the CSS, which a bundler
       * rewrites and breaks. A div marker avoids the whole problem and matches the app's accent.
       */
      const pin = L.divIcon({
        className: '',
        html: '<span style="display:block;width:22px;height:22px;border-radius:50%;background:#6C4CE0;border:3px solid #fff;box-shadow:0 2px 8px rgba(28,33,38,.35)"></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      function place(lat: number, lng: number) {
        if (marker.current) {
          marker.current.setLatLng([lat, lng]);
        } else {
          marker.current = L.marker([lat, lng], { icon: pin, draggable: true }).addTo(instance);
          marker.current.on('dragend', () => {
            const position = marker.current?.getLatLng();
            if (position) latest.current({ lat: position.lat, lng: position.lng });
          });
        }
        latest.current({ lat, lng });
      }

      instance.on('click', (event) => place(event.latlng.lat, event.latlng.lng));
      if (value) place(value.lat, value.lng);

      map.current = instance;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // Mounts once, deliberately: `value` changes are pushed in through the effect below rather than
    // by rebuilding the map, which would throw away the reader's pan and zoom every time the pin
    // moved. `latest` holds the current `onChange` so the stale closure never matters.
  }, []);

  /** Follow the value when it changes from outside â€” a search hit, or "use my location". */
  useEffect(() => {
    if (!ready || !value || !map.current) return;
    map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 16));
    if (marker.current) marker.current.setLatLng([value.lat, value.lng]);
  }, [ready, value]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    setNote(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const body = (await response.json()) as { results?: Array<{ label: string; lat: number; lng: number }> };
      const found = body.results ?? [];
      setResults(found);
      if (found.length === 0) {
        // Not an error. Empty plots frequently have no name anything has heard of, which is exactly
        // why clicking the map is offered alongside.
        setNote('Nothing found for that. Click the map to drop the pin instead.');
      }
    } catch {
      setNote('Search is unavailable. Click the map to drop the pin instead.');
    } finally {
      setSearching(false);
    }
  }

  function locate() {
    setNote(null);
    if (!('geolocation' in navigator)) {
      setNote('This browser cannot report a location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (cause) => {
        setLocating(false);
        setNote(
          cause.code === cause.PERMISSION_DENIED
            ? 'Location permission was refused.'
            : 'Could not get a location.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex min-w-[240px] flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a locality â€” Whitefield, Bengaluru"
              className="pl-9"
              aria-label="Search for a place"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 3}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search
          </Button>
        </form>
        <Button type="button" variant="secondary" onClick={locate} disabled={locating}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          Use my location
        </Button>
      </div>

      {results.length > 0 && (
        <ul className="max-h-[168px] overflow-y-auto rounded-panel border border-line bg-surface">
          {results.map((result) => (
            <li key={`${result.lat},${result.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onChange({ lat: result.lat, lng: result.lng });
                  setResults([]);
                  setNote('Now drag the pin, or click the map, to put it on the plot exactly.');
                }}
                className="flex w-full items-start gap-2.5 border-b border-line-soft px-3 py-2.5 text-left text-[13.5px] leading-snug transition last:border-0 hover:bg-raised"
              >
                <MapPin className="mt-0.5 size-4 flex-none text-ink-faint" />
                <span className="min-w-0">{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative overflow-hidden rounded-panel border border-line">
        <div ref={host} className="h-[320px] w-full bg-neutral-bg" />
        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center bg-neutral-bg">
            <Loader2 className="size-5 animate-spin text-ink-faint" />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="text-ink-muted">
          {note ?? 'Click the map to drop the pin, then drag it to place it exactly.'}
        </span>
        {value && (
          <span className="font-mono text-ink-soft">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}
