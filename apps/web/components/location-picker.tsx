'use client';

import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { Crosshair, Layers, Loader2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The browser key. Public by design — it travels with every map request, so hiding it is not a
 * thing that can be done. Restrict it by HTTP referrer in the Google Cloud console, and to the
 * three APIs this uses: Maps JavaScript, Places, Geocoding.
 */
const GOOGLE_KEY = process.env['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'] ?? '';

export interface PickedLocation {
  lat: number;
  lng: number;
  /** What Google calls this spot. Null until a lookup names it. */
  address?: string | null;
}

/**
 * Choosing where a building is going to be.
 *
 * Four ways in, because a plot has four ways of being described and only one of them is an address:
 *
 * - **Search**, with Google's own suggestions as you type. Indian addresses are the case other
 *   geocoders are worst at — "Sy. No. 42/1B, Thudiyalur" means nothing to a general gazetteer and
 *   is a real place to Google — and this is why the maps moved.
 * - **Click the map** to drop the pin, and drag it to fine-tune. The one that matters: an empty
 *   plot on the corner of a road usually has no postal address to search for.
 * - **Satellite**, because a bare plot is recognisable from the field boundaries and the trees
 *   around it long before it has a building or a street number.
 * - **Use my location**, for the supervisor standing on it.
 *
 * Whatever puts the pin down, the address is read back from the coordinates and handed to the
 * caller, so a site that was pinned on a field still ends up with something written on the page.
 *
 * The SDK loads on mount rather than in the bundle: setting a site location is an occasional office
 * task and has no business weighing down the roll-call screen a supervisor opens every morning.
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
  const searchBox = useRef<HTMLInputElement | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  const [ready, setReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Centre of India when nothing is set, so the first view is a country rather than the Atlantic.
  const initial = value ?? { lat: 20.5937, lng: 78.9629 };

  useEffect(() => {
    if (!GOOGLE_KEY) {
      setNote('Maps need NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Coordinates can still be typed in.');
      return;
    }

    let cancelled = false;

    void (async () => {
      // The functional API: `setOptions` before anything loads, then one import per library. The
      // `Loader` class this used at first is deprecated in v2 of the package.
      setOptions({ key: GOOGLE_KEY, v: 'weekly', region: 'IN', language: 'en' });
      const [{ Map }, { Geocoder }, { Autocomplete }] = await Promise.all([
        importLibrary('maps'),
        importLibrary('geocoding'),
        importLibrary('places'),
      ]);
      if (cancelled || !host.current || map.current) return;

      const instance = new Map(host.current, {
        center: initial,
        zoom: value ? 18 : 5,
        mapTypeId: 'roadmap',
        // A site page scrolls; grabbing the wheel would trap the reader inside the map.
        scrollwheel: false,
        gestureHandling: 'cooperative',
        streetViewControl: true,
        mapTypeControl: false,
        fullscreenControl: true,
        clickableIcons: false,
      });
      geocoder.current = new Geocoder();

      /** Reads the address back from the pin, so a plot with no street number still gets words. */
      async function describe(lat: number, lng: number): Promise<string | null> {
        try {
          const { results } = await geocoder.current!.geocode({ location: { lat, lng } });
          return results[0]?.formatted_address ?? null;
        } catch {
          // A failed lookup is not a failed pin. The coordinates are the thing being chosen.
          return null;
        }
      }

      async function place(lat: number, lng: number, known?: string | null) {
        if (marker.current) {
          marker.current.setPosition({ lat, lng });
        } else {
          marker.current = new google.maps.Marker({
            position: { lat, lng },
            map: instance,
            draggable: true,
            title: 'Drag to adjust',
          });
          marker.current.addListener('dragend', () => {
            const position = marker.current?.getPosition();
            if (!position) return;
            void place(position.lat(), position.lng());
          });
        }
        latest.current({ lat, lng, address: known ?? (await describe(lat, lng)) });
      }

      instance.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) void place(event.latLng.lat(), event.latLng.lng());
      });

      /*
       * Places autocomplete, restricted to India and biased to what is on screen.
       *
       * `geocode` rather than `establishment`: a builder is looking for a locality or a survey
       * number, not for a restaurant, and the business results crowd those out.
       */
      if (searchBox.current) {
        const autocomplete = new Autocomplete(searchBox.current, {
          componentRestrictions: { country: 'in' },
          fields: ['geometry', 'formatted_address', 'name'],
          types: ['geocode'],
        });
        autocomplete.bindTo('bounds', instance);
        autocomplete.addListener('place_changed', () => {
          const picked = autocomplete.getPlace();
          const location = picked.geometry?.location;
          if (!location) {
            setNote('Pick one of the suggestions, or click the map.');
            return;
          }
          setNote(null);
          if (picked.geometry?.viewport) {
            instance.fitBounds(picked.geometry.viewport);
          } else {
            instance.setCenter(location);
            instance.setZoom(18);
          }
          void place(location.lat(), location.lng(), picked.formatted_address ?? null);
        });
      }

      if (value) void place(value.lat, value.lng, value.address ?? null);

      map.current = instance;
      setReady(true);
    })().catch(() => {
      setNote('The map could not load. Check the API key and its referrer restrictions.');
    });

    return () => {
      cancelled = true;
      map.current = null;
      marker.current = null;
    };
    // Mounts once, deliberately: `value` changes are pushed in through the effect below rather than
    // by rebuilding the map, which would throw away the reader's pan and zoom every time the pin
    // moved. `latest` holds the current `onChange` so the stale closure never matters.
  }, []);

  /** Follow the value when it changes from outside — "use my location", or a form reset. */
  useEffect(() => {
    if (!ready || !value || !map.current) return;
    map.current.setCenter({ lat: value.lat, lng: value.lng });
    map.current.setZoom(Math.max(map.current.getZoom() ?? 0, 17));
    marker.current?.setPosition({ lat: value.lat, lng: value.lng });
  }, [ready, value]);

  function toggleSatellite() {
    const next = !satellite;
    setSatellite(next);
    // Hybrid, not satellite: the road names are what tell you which plot you are looking at.
    map.current?.setMapTypeId(next ? 'hybrid' : 'roadmap');
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNote('This browser cannot share a location.');
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setNote('Could not get a location. Allow it in the browser, or click the map.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            ref={searchBox}
            placeholder="Search a locality, road or landmark"
            className="pl-9"
            // Enter would submit the dialog this usually sits in, before the suggestion is taken.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={toggleSatellite}>
          <Layers className="size-4" /> {satellite ? 'Map' : 'Satellite'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          I am on site
        </Button>
      </div>

      <div
        ref={host}
        className="h-[320px] w-full overflow-hidden rounded-panel border border-line bg-neutral-bg"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 text-ink-muted">
          <MapPin className="size-3.5 text-ink-faint" />
          {value
            ? value.address ?? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}`
            : 'Search, or click the map to drop a pin. Drag it to fine-tune.'}
        </span>
        {value && (
          <span className="font-mono text-[11.5px] text-ink-faint">
            {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
          </span>
        )}
      </div>

      {note && <p className="text-[12.5px] text-pending-fg">{note}</p>}
    </div>
  );
}
