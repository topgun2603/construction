import { describe, expect, it, vi } from 'vitest';

/*
 * `session.ts` wraps its loaders in React's `cache()` at module scope, and that only exists inside
 * a server render — importing the module in jsdom dies on "cache is not a function" before a single
 * test runs. Identity is the honest stand-in: `cache` is a per-request memo, and one call memoises
 * nothing.
 *
 * Scoped to this file rather than the shared setup, so every component test keeps the real React.
 */
vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { homePathFor } from './session';

/**
 * Where a person lands when they have not asked for a page.
 *
 * Sign-in goes through `/`, which asks this. Getting it wrong means a client's very first screen
 * after signing in is a 403 — on the one account type least able to work out why, and least likely
 * to try again.
 */
describe('the landing page for a role', () => {
  it('sends a client to their sites, never to the overview', () => {
    // The overview is cost and approvals; the API refuses it to anybody without expenses.view.
    expect(homePathFor(['projects.view', 'dpr.view', 'messages.post', 'documents.view'])).toBe(
      '/projects',
    );
  });

  it('sends anybody who can see spend to the overview', () => {
    expect(homePathFor(['projects.view', 'expenses.view'])).toBe('/overview');
  });

  it('sends somebody with no permissions at all somewhere that exists', () => {
    // A pending or stripped-back account still has to land on a page rather than a refusal.
    expect(homePathFor([])).toBe('/projects');
  });
});
