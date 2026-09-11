import type { Page } from '@sitebook/shared';

/**
 * Keyset pagination (spec §9).
 *
 * Every list endpoint asks the database for `limit + 1` rows: the extra row is how
 * we know another page exists without a second `COUNT(*)`, which on a tenant table
 * behind RLS would be a second full scan. The cursor is the last row's id, used
 * with Prisma's `cursor`/`skip: 1` against a stable `orderBy`.
 */
export interface CursorArgs {
  take: number;
  cursor?: { id: string };
  skip?: number;
}

export function cursorArgs(query: { cursor?: string; limit: number }): CursorArgs {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

export function toPage<Row extends { id: string }, View>(
  rows: Row[],
  limit: number,
  map: (row: Row) => View,
): Page<View> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: items.map(map),
    next_cursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}
