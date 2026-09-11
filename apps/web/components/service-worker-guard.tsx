'use client';

import { useEffect } from 'react';

/**
 * Unregisters any service worker found on this origin.
 *
 * BUILDR does not use one. But service workers are scoped by *origin*
 * (`http://localhost:3001`), not by project, so a worker registered by a different
 * app that once ran on this port stays installed in the browser and intercepts
 * every request here — including ours. The symptom is somebody else's offline page
 * appearing over BUILDR whenever the dev server restarts, with a name that
 * appears nowhere in this repository.
 *
 * That is a development hazard rather than a production one, but the cleanup is
 * safe either way: if we ever do add a service worker, this component goes with it.
 */
export function ServiceWorkerGuard() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        if (registrations.length === 0) return;

        await Promise.all(registrations.map((registration) => registration.unregister()));

        // The worker's caches outlive its registration, so clear those too or a
        // stale shell can still be served from the Cache API on the next load.
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }

        console.warn(
          `[BUILDR] Removed ${registrations.length} stale service worker(s) left on this origin by another app. Reload once to clear it fully.`,
        );
      })
      .catch(() => {
        /* Blocked storage or a private window — nothing to clean up. */
      });
  }, []);

  return null;
}
