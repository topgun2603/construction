import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  /** Rough extent, so the map can open at a sensible zoom rather than always the same one. */
  bounds: [number, number, number, number] | null;
}

/**
 * Turning a place name into coordinates.
 *
 * Proxied through the API rather than called from the browser, for three reasons that all matter:
 *
 * - Nominatim's usage policy requires a real User-Agent identifying the application. A browser cannot
 *   set one, so a direct call is anonymous traffic that they are entitled to block.
 * - Results are cached here, so twenty people searching "Whitefield" cost one request rather than
 *   twenty. Nominatim asks for at most one request a second and this is how that promise is kept.
 * - The search terms are a builder's next project. Sending them straight from the browser to a third
 *   party attaches them to that person's IP; sending them from the server does not.
 *
 * Keyless on purpose. Google's Geocoding API would be better at Indian addresses, but it needs a
 * billed key this deployment does not have, and a search box that works is worth more than one that
 * waits for somebody to buy something.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly config = env();
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  async search(query: string): Promise<GeocodeResult[]> {
    const key = query.trim().toLowerCase();
    if (key.length < 3) return [];

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

    /*
     * Google first, because Indian addresses are exactly what the alternatives are worst at.
     * "Sy. No. 42/1B, Thudiyalur" is a real place and means nothing to a general gazetteer; a
     * builder's next project is usually described that way rather than by a street number.
     *
     * The other two stay as fallbacks so a checkout with no key still has a working search.
     */
    const results = this.config.GOOGLE_MAPS_API_KEY
      ? await this.viaGoogle(query)
      : this.config.MAPTILER_KEY
        ? await this.viaMapTiler(query)
        : await this.viaNominatim(query);

    if (results.length > 0) this.remember(key, results);
    return results;
  }

  /**
   * MapTiler, when a key is configured.
   *
   * Preferred over Nominatim for the same reason the tiles moved: Nominatim is volunteer-run, its
   * usage policy is enforced by blocking, and a commercial product leaning on it is outside what
   * that policy allows. Using one provider for both also means the search results and the map
   * underneath them come from the same data, so a place found is a place drawn.
   */
  /**
   * Google's Geocoding API.
   *
   * Server-side, with a key that is **not** the browser one: this key is unrestricted by referrer
   * and must stay out of any bundle. Restrict it by IP in the Google Cloud console instead.
   *
   * `region=in` and `components=country:IN` together: the first biases interpretation, the second
   * stops a search for "Bellary Road" returning somewhere in Texas.
   */
  private async viaGoogle(query: string): Promise<GeocodeResult[]> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', this.config.GOOGLE_MAPS_API_KEY!);
    url.searchParams.set('region', 'in');
    url.searchParams.set('components', 'country:IN');

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        this.logger.warn(`Google geocoding returned ${response.status}`);
        return [];
      }

      const body = (await response.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: {
            location?: { lat: number; lng: number };
            viewport?: {
              northeast?: { lat: number; lng: number };
              southwest?: { lat: number; lng: number };
            };
          };
        }>;
      };

      // `ZERO_RESULTS` is an answer, not a failure. Anything else names a configuration problem —
      // a key without the Geocoding API enabled, or billing not set up — and saying which one is
      // the difference between a five-minute fix and an afternoon.
      if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
        this.logger.warn(`Google geocoding: ${body.status} ${body.error_message ?? ''}`);
        return [];
      }

      return (body.results ?? [])
        .map((row) => {
          const location = row.geometry?.location;
          if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
            return null;
          }
          const box = row.geometry?.viewport;
          return {
            label: row.formatted_address ?? `${location.lat}, ${location.lng}`,
            lat: location.lat,
            lng: location.lng,
            // Ours is [south, north, west, east], as the other providers already produce.
            bounds:
              box?.southwest && box.northeast
                ? ([box.southwest.lat, box.northeast.lat, box.southwest.lng, box.northeast.lng] as [
                    number,
                    number,
                    number,
                    number,
                  ])
                : null,
          };
        })
        .filter((row): row is GeocodeResult => row !== null);
    } catch (cause) {
      this.logger.warn({ err: cause }, 'Google geocoding failed');
      return [];
    }
  }

  private async viaMapTiler(query: string): Promise<GeocodeResult[]> {
    const url = new URL(
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set('key', this.config.MAPTILER_KEY!);
    url.searchParams.set('limit', '6');
    // Biased to India rather than restricted, the same as before.
    url.searchParams.set('country', 'in');

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        this.logger.warn(`MapTiler geocoding returned ${response.status}`);
        return [];
      }

      const body = (await response.json()) as {
        features?: Array<{
          place_name?: string;
          text?: string;
          center?: [number, number];
          bbox?: [number, number, number, number];
        }>;
      };

      return (body.features ?? [])
        .map((feature) => {
          // GeoJSON is [lng, lat]; everything downstream of here is {lat, lng}.
          const [lng, lat] = feature.center ?? [];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            label: feature.place_name ?? feature.text ?? `${lat}, ${lng}`,
            lat: lat as number,
            lng: lng as number,
            // MapTiler's bbox is [west, south, east, north]; ours is [south, north, west, east],
            // matching what Nominatim returned before it.
            bounds: feature.bbox
              ? ([feature.bbox[1], feature.bbox[3], feature.bbox[0], feature.bbox[2]] as [
                  number,
                  number,
                  number,
                  number,
                ])
              : null,
          };
        })
        .filter((row): row is GeocodeResult => row !== null);
    } catch (cause) {
      this.logger.warn({ err: cause }, 'MapTiler geocoding failed');
      return [];
    }
  }

  /**
   * Nominatim, the fallback when no MapTiler key is set.
   *
   * Kept so a checkout with no key still has a working search. It is not what a deployment should
   * run on: the User-Agent below is what their policy asks for, and without `GEOCODER_CONTACT` it
   * says so out loud rather than pretending.
   */
  private async viaNominatim(query: string): Promise<GeocodeResult[]> {
    const url = new URL(NOMINATIM);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('countrycodes', 'in');

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': `BUILDR/1.0 (${this.config.GEOCODER_CONTACT ?? 'no contact configured'})`,
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        this.logger.warn(`Geocoder returned ${response.status}`);
        return [];
      }

      const raw = (await response.json()) as Array<{
        display_name?: string;
        lat?: string;
        lon?: string;
        boundingbox?: string[];
      }>;

      const results: GeocodeResult[] = raw
        .map((row) => {
          const lat = Number.parseFloat(row.lat ?? '');
          const lng = Number.parseFloat(row.lon ?? '');
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const box = row.boundingbox?.map(Number.parseFloat);
          return {
            label: row.display_name ?? `${lat}, ${lng}`,
            lat,
            lng,
            bounds:
              box && box.length === 4 && box.every(Number.isFinite)
                ? ([box[0], box[1], box[2], box[3]] as [number, number, number, number])
                : null,
          };
        })
        .filter((row): row is GeocodeResult => row !== null);

      return results;
    } catch (error) {
      // A geocoder being slow or down must not break the page. The map still takes a dropped pin,
      // which is the interaction that matters for a plot with no address.
      this.logger.warn(`Geocoder unreachable: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private remember(key: string, results: GeocodeResult[]): void {
    // Oldest out first. A plain Map preserves insertion order, so the first key is the oldest.
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), results });
  }
}
