import { acceptable } from './forecast-explainer.service';

describe('ForecastExplainer guard', () => {
  const template =
    'On course to finish at AED 4.6M against a AED 4.2M budget (9% over). Labour · Mason is up 18% on the two weeks before (AED 25.2K against AED 21.4K).';

  it('accepts a rewording that keeps to the given numbers', () => {
    expect(
      acceptable(
        'Marina Tower is heading for AED 4.6M on a AED 4.2M budget, 9% over. Mason labour is up 18% in the last two weeks.',
        template,
      ),
    ).toBe(true);
  });

  it('rejects any number the facts did not contain', () => {
    expect(acceptable('Heading for AED 4.7M, 9% over.', template)).toBe(false);
    expect(acceptable('Mason labour is up 23%.', template)).toBe(false);
  });

  it('rejects an empty or rambling answer', () => {
    expect(acceptable('', template)).toBe(false);
    expect(acceptable('word '.repeat(80), template)).toBe(false);
  });
});
