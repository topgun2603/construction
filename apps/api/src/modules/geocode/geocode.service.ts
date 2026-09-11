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

    const url = new URL(NOMINATIM);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '0');
    // Biased to India rather than restricted: a builder here is looking for a plot here, but a hard
    // filter would break the day somebody has a site across a border.
    url.searchParams.set('countrycodes', 'in');

    try {
      const response = await fetch(url, {
        headers: {
          // Required by Nominatim's policy. A contact address is what stops them blocking the app
          // rather than guessing who it is.
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

      this.remember(key, results);
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
