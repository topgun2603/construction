import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlockingOverlay } from './blocking-overlay';

/**
 * The curtain over a sign-out.
 *
 * The point of it is that the page underneath cannot be used while a session is being revoked, so
 * the tests are about presence and about reach: is it announced, and does it actually cover the
 * page rather than sitting in the layout.
 */
describe('the blocking overlay', () => {
  it('says nothing at all when closed', () => {
    render(<BlockingOverlay open={false} label="Signing out…" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces what is happening rather than only spinning', () => {
    render(<BlockingOverlay open label="Signing out…" />);

    const curtain = screen.getByRole('status');
    expect(curtain).toHaveTextContent('Signing out…');
    // A spinner with no words is a page that looks broken to anybody using a screen reader.
    expect(curtain).toHaveAttribute('aria-busy', 'true');
  });

  it('covers the whole page, which is what stops the second click', () => {
    render(<BlockingOverlay open label="Signing out…" />);

    const curtain = screen.getByRole('status');
    expect(curtain.className).toContain('fixed');
    expect(curtain.className).toContain('inset-0');
  });
});
