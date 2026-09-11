'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Loader2, Map, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

/*
 * The map picker is loaded only when somebody opens it. Leaflet plus its tiles is the heaviest thing
 * on this form, and most sites are created without ever touching it.
 */
const LocationPicker = dynamic(
  () => import('@/components/location-picker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-panel border border-line bg-neutral-bg">
        <Loader2 className="size-5 animate-spin text-ink-faint" />
      </div>
    ),
  },
);

/**
 * Capturing where a site is.
 *
 * "Pick on map" is the primary path, because the common case is an owner in an office planning a
 * building on a plot that has no postal address and that they are not standing on. Searching a
 * locality gets them to the right kilometre; dragging the pin does the rest.
 *
 * The typed boxes stay for somebody working from a survey, and stay in sync with the map both ways.
 */
export function LocationField({
  lat,
  lng,
  onChange,
}: {
  lat: string;
  lng: string;
  onChange: (next: { lat: string; lng: string }) => void;
}) {
  const [picking, setPicking] = useState(false);

  const parsed = (() => {
    const a = Number.parseFloat(lat);
    const b = Number.parseFloat(lng);
    return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
  })();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Latitude" className="w-[150px]">
          <Input
            value={lat}
            onChange={(event) => onChange({ lat: event.target.value, lng })}
            inputMode="decimal"
            placeholder="12.97160"
            className="font-mono"
          />
        </Field>
        <Field label="Longitude" className="w-[150px]">
          <Input
            value={lng}
            onChange={(event) => onChange({ lat, lng: event.target.value })}
            inputMode="decimal"
            placeholder="77.59456"
            className="font-mono"
          />
        </Field>
        <Button
          type="button"
          variant={picking ? 'ghost' : 'secondary'}
          onClick={() => setPicking((open) => !open)}
        >
          {picking ? <X className="size-4" /> : <Map className="size-4" />}
          {picking ? 'Close map' : 'Pick on map'}
        </Button>
      </div>

      {picking && (
        <LocationPicker
          value={parsed}
          onChange={(next) =>
            // Five decimals is about a metre — finer than a site boundary needs, and short enough to
            // read back and check against a survey.
            onChange({ lat: next.lat.toFixed(5), lng: next.lng.toFixed(5) })
          }
        />
      )}

      {!picking && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
          <MapPin className="size-3.5" />
          Optional. Pick it on the map — search the locality, then drag the pin onto the plot.
        </p>
      )}
    </div>
  );
}
