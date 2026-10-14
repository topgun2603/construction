import { describe, expect, it } from 'vitest';
import { newSsoBinding, readSsoFragment, takeSsoBinding } from './sso-browser';

describe('SSO browser binding', () => {
  it('makes a URL-safe binding the API accepts and hands it back once', () => {
    const binding = newSsoBinding();
    expect(binding).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(takeSsoBinding()).toBe(binding);
    expect(takeSsoBinding()).toBeNull();
  });

  it('reads the ticket or the error from the callback fragment', () => {
    expect(readSsoFragment('#ticket=abc.def')).toEqual({ ticket: 'abc.def', error: null });
    expect(readSsoFragment('#error=Not%20on%20the%20team')).toEqual({ ticket: null, error: 'Not on the team' });
    expect(readSsoFragment('')).toEqual({ ticket: null, error: null });
  });
});
