import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aiAllOn, type AiFeatureStates } from '@sitebook/shared';
import { AiFeaturesProvider, AiOffNote, aiBlocked } from './ai-features';

/**
 * The note that stands in for an AI button. What matters: it appears only when somebody switched
 * the feature off, it says who, and "not set up on this server" never masquerades as "turned off".
 */
describe('AI feature notes', () => {
  const states = (overrides: Partial<AiFeatureStates>): AiFeatureStates => ({ ...aiAllOn(), ...overrides });

  it('treats only a decision as blocked — not a server without a key', () => {
    expect(aiBlocked('off_company')).toBe(true);
    expect(aiBlocked('off_platform')).toBe(true);
    expect(aiBlocked('region_unavailable')).toBe(true);
    expect(aiBlocked('not_configured')).toBe(false);
    expect(aiBlocked('on')).toBe(false);
  });

  it('says nothing when the feature is on, or outside a provider', () => {
    const { container } = render(<AiOffNote feature="voice" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the company, and the way that still works', () => {
    render(
      <AiFeaturesProvider states={states({ reading: 'off_company' })}>
        <AiOffNote feature="reading" manual="Type the bill in below." />
      </AiFeaturesProvider>,
    );
    expect(screen.getByText(/AI is turned off for your company\. Type the bill in below\./)).toBeInTheDocument();
  });

  it('names the server when the operator switched it off', () => {
    render(
      <AiFeaturesProvider states={states({ voice: 'off_platform' })}>
        <AiOffNote feature="voice" />
      </AiFeaturesProvider>,
    );
    expect(screen.getByText('This AI feature is turned off on this server.')).toBeInTheDocument();
  });

  it('stays quiet on a server with no key, where the API explains itself as before', () => {
    const { container } = render(
      <AiFeaturesProvider states={states({ translation: 'not_configured' })}>
        <AiOffNote feature="translation" />
      </AiFeaturesProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
