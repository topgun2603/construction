import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { addDays } from '@sitebook/shared';
import { resolvePeriod, describePeriod } from '../src/modules/ai/ask-periods';

/**
 * Asking the product a question.
 *
 * The model's half cannot be tested here — it is a vendor call, and a test that spends money to
 * assert a sentence is a test nobody runs. What *can* be tested is everything the answer actually
 * depends on: which dates a period keyword means, and whether the endpoint is reachable by
 * somebody who should not reach it.
 *
 * That split is the point of the design. The model picks a keyword; this code turns it into an
 * answer. Only the second half can be wrong in a way that matters, and only the second half is
 * deterministic enough to test.
 */
describe('asking about your own numbers', () => {
  let test: TestApp;
  let tenant: OnboardedTenant;

  beforeAll(async () => {
    test = await createTestApp();
    tenant = await onboardTenant(test, { name: 'Ask Builders', phone: uniquePhone() });
  });

  afterAll(async () => {
    if (tenant) await destroyTenant(test, tenant.tenantId);
    await test.close();
  });

  describe('what a period means', () => {
    // A Thursday in October, chosen because "last month" across it is the case a model gets wrong.
    const today = '2026-10-02';

    it('reads last month as the whole of the month before, not thirty days back', () => {
      expect(resolvePeriod('last_month', today)).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });

    it('reads this month as the first to today, not the whole month', () => {
      // Answering "spend this month" with a figure that includes days which have not happened is
      // not wrong so much as impossible, and it would quietly include nothing — which looks fine.
      expect(resolvePeriod('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    });

    it('handles the January boundary, where last month is another year', () => {
      expect(resolvePeriod('last_month', '2026-01-15')).toEqual({
        from: '2025-12-01',
        to: '2025-12-31',
      });
    });

    it('gets February right in a leap year and in a common one', () => {
      expect(resolvePeriod('last_month', '2028-03-10').to).toBe('2028-02-29');
      expect(resolvePeriod('last_month', '2026-03-10').to).toBe('2026-02-28');
    });

    it('counts the last seven days inclusive of today', () => {
      expect(resolvePeriod('last_7_days', today)).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    });

    it('keeps the two week windows from overlapping or leaving a gap', () => {
      // The pair exists for comparisons, so a day belonging to both — or to neither — would make
      // "down 20% on last week" a sentence about nothing.
      const recent = resolvePeriod('last_7_days', today);
      const before = resolvePeriod('previous_7_days', today);
      expect(before.to).toBe(addDays(recent.from, -1));
    });

    it('names the month in the sentence rather than printing two dates', () => {
      const range = resolvePeriod('last_month', today);
      expect(describePeriod('last_month', range)).toBe('in September 2026');
      expect(describePeriod('all_time', range)).toBe('in total');
    });
  });

  describe('the endpoint', () => {
    it('refuses a question from nobody', async () => {
      await test.http().post('/v1/ask').send({ question: 'how much did we spend?' }).expect(401);
    });

    it('refuses a question too short to mean anything', async () => {
      await test
        .http()
        .post('/v1/ask')
        .set({ Authorization: `Bearer ${tenant.accessToken}` })
        .send({ question: 'hi' })
        .expect(422);
    });
  });
});
