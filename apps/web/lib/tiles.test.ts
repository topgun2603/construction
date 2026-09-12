import { describe, expect, it } from 'vitest';
import { TILE_SIZE, project, tilesFor } from './tiles';

/**
 * The arithmetic behind drawing a map out of `<img>` tags.
 *
 * Worth testing because it is the kind of code that is silently, plausibly wrong: an off-by-one in
 * the tile range crops an edge, a sign error puts the pin in the wrong place, and both still look
 * like "a map" to anybody glancing at the screen.
 */
describe('projecting a coordinate into the tile plane', () => {
  it('puts the origin at the centre of the world', () => {
    // 0,0 is the middle of the map at every zoom, by definition of Web Mercator.
    const p = project(0, 0, 0);
    expect(p.x).toBeCloseTo(TILE_SIZE / 2, 6);
    expect(p.y).toBeCloseTo(TILE_SIZE / 2, 6);
  });

  it('puts the far west and far east at the two edges', () => {
    expect(project(0, -180, 0).x).toBeCloseTo(0, 6);
    expect(project(0, 180, 0).x).toBeCloseTo(TILE_SIZE, 6);
  });

  it('doubles the plane with every zoom level', () => {
    expect(project(0, 0, 3).x).toBeCloseTo(project(0, 0, 2).x * 2, 6);
  });

  it('does not run to infinity at the poles', () => {
    // Mercator is undefined at ±90°. A site is never there, but a clamp is cheaper than an NaN
    // that renders as a blank card nobody can explain.
    expect(Number.isFinite(project(90, 0, 10).y)).toBe(true);
    expect(Number.isFinite(project(-90, 0, 10).y)).toBe(true);
  });

  it('places Coimbatore in the northern and eastern half, as it should', () => {
    const p = project(11.0168, 76.9558, 8);
    const half = (TILE_SIZE * 2 ** 8) / 2;
    expect(p.x).toBeGreaterThan(half); // east of Greenwich
    expect(p.y).toBeLessThan(half); // north of the equator
  });
});

describe('choosing the tiles for a box', () => {
  it('covers the whole box, with the requested point at its centre', () => {
    const width = 760;
    const height = 240;
    const tiles = tilesFor(11.0168, 76.9558, 15, width, height);
    expect(tiles.length).toBeGreaterThan(0);

    // Every pixel of the viewport has to be behind some tile, or the map has a hole in it.
    for (const edge of [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: 0, y: height - 1 },
      { x: width - 1, y: height - 1 },
      { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    ]) {
      const covering = tiles.some(
        (tile) =>
          edge.x >= tile.left &&
          edge.x < tile.left + TILE_SIZE &&
          edge.y >= tile.top &&
          edge.y < tile.top + TILE_SIZE,
      );
      expect(covering).toBe(true);
    }
  });

  it('asks for no more tiles than the box needs', () => {
    // 760×240 spans at most 5 columns and 3 rows once the partial edges are counted.
    const tiles = tilesFor(11.0168, 76.9558, 15, 760, 240);
    expect(tiles.length).toBeLessThanOrEqual(15);
  });

  it('never asks for a tile outside the map vertically', () => {
    // There is nothing above the top row or below the bottom one; requesting it is a 404 per tile.
    const tiles = tilesFor(85, 0, 2, 760, 240);
    const count = 2 ** 2;
    expect(tiles.every((tile) => tile.y >= 0 && tile.y < count)).toBe(true);
  });

  it('wraps around the date line instead of asking for a negative column', () => {
    const tiles = tilesFor(0, 179.99, 3, 760, 240);
    const count = 2 ** 3;
    expect(tiles.every((tile) => tile.x >= 0 && tile.x < count)).toBe(true);
    // And it really does straddle: tiles from both ends of the world appear.
    expect(tiles.some((tile) => tile.x === 0)).toBe(true);
    expect(tiles.some((tile) => tile.x === count - 1)).toBe(true);
  });

  it('keeps the centre pixel on the point that was asked for', () => {
    const width = 600;
    const height = 300;
    const lat = 11.0168;
    const lng = 76.9558;
    const zoom = 14;
    const tiles = tilesFor(lat, lng, zoom, width, height);
    const centre = project(lat, lng, zoom);

    // Reconstruct the world position of the viewport's centre from any tile's placement.
    const first = tiles[0]!;
    const originX = first.x * TILE_SIZE - first.left;
    expect(originX + width / 2).toBeCloseTo(centre.x, 0);
  });
});
