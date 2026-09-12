import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * What every test in this app needs before it can render anything.
 *
 * The components under test are Next client components, so they reach for router and server-action
 * machinery that only exists inside a running Next server. Those are stubbed here rather than in
 * each file, because a stub repeated in six places is a stub that disagrees with itself in one of
 * them.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

/*
 * jsdom implements neither of these, and Radix uses both. Without them every component built on a
 * Radix primitive — the select on the composer, every dialog — throws on render, which looks like a
 * failing assertion rather than a missing browser API.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }),
});

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

// Object URLs back the image previews on the composer; jsdom has no implementation.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
}
