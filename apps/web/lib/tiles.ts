/**
 * Slippy-map arithmetic, so a location can be drawn as plain images.
 *
 * A site map is a picture nobody pans — it exists so somebody recognises the place before they read
 * the name. That does not need a mapping library: it needs the handful of tiles covering a point,
 * laid out so the point lands in the middle. The whole of Leaflet is ~150 KB for a supervisor on 3G
 * to look at a thumbnail.
 *
 * The projection is Web Mercator, the same one every raster tile provider serves.
 */

/** Tiles are 256 px square at the standard scale. */
export const TILE_SIZE = 256;

/** Where a coordinate falls in the whole-world pixel plane at one zoom level. */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  // Clamped: the Mercator projection runs to infinity at the poles, and a site is never there.
  const clamped = Math.min(Math.max(sin, -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale,
  };
}

export interface TilePlacement {
  x: number;
  y: number;
  z: number;
  /** Pixel offset inside the viewport box. */
  left: number;
  top: number;
}

/**
 * The tiles needed to fill a box of [width]×[height] centred on a coordinate, each with the offset
 * to draw it at.
 *
 * One extra tile is taken on every side, because a box is almost never a whole number of tiles and
 * a missing edge reads as a broken image rather than as a map that stops.
 */
export function tilesFor(
  lat: number,
  lng: number,
  zoom: number,
  width: number,
  height: number,
): TilePlacement[] {
  const centre = project(lat, lng, zoom);
  // Top-left of the viewport, in world pixels.
  const originX = centre.x - width / 2;
  const originY = centre.y - height / 2;

  const first = { x: Math.floor(originX / TILE_SIZE), y: Math.floor(originY / TILE_SIZE) };
  const last = {
    x: Math.floor((originX + width) / TILE_SIZE),
    y: Math.floor((originY + height) / TILE_SIZE),
  };

  const count = 2 ** zoom;
  const placements: TilePlacement[] = [];

  for (let x = first.x; x <= last.x; x += 1) {
    for (let y = first.y; y <= last.y; y += 1) {
      // Above the top row or below the bottom one there is no map, only empty space.
      if (y < 0 || y >= count) continue;
      placements.push({
        // Longitude wraps; a box straddling the date line still wants real tiles either side.
        x: ((x % count) + count) % count,
        y,
        z: zoom,
        left: Math.round(x * TILE_SIZE - originX),
        top: Math.round(y * TILE_SIZE - originY),
      });
    }
  }

  return placements;
}
