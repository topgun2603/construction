import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLoader } from './app-loader';

/**
 * The loader's job is to be seen only when it is needed, and to say something while it is.
 *
 * The delay itself is CSS — a 400ms animation-delay, which jsdom does not run — so what is tested
 * here is everything else: that it announces itself, that a line appears, and that the line changes
 * on its own rather than sitting there for a minute.
 */
describe('the application loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic: the first line is picked at random in real use.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('announces the wait to a screen reader', () => {
    render(<AppLoader label="Loading the wage sheet" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading the wage sheet');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a line about the work, not about waiting', () => {
    render(<AppLoader />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText('Measure twice. Pour once.')).toBeInTheDocument();
  });

  it('moves on after five seconds', () => {
    render(<AppLoader />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText('Measure twice. Pour once.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Whatever the next one is, it is not the one that was there — a line that never changes on a
    // long wait reads as a frozen page.
    expect(screen.queryByText('Measure twice. Pour once.')).not.toBeInTheDocument();
  });

  it('stops its timer when it goes away', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<AppLoader />);
    unmount();
    // A loader that outlives its page keeps setting state on nothing, which React reports as a
    // leak and nobody ever tracks down.
    expect(clear).toHaveBeenCalled();
  });
});
