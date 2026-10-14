import { describe, expect, it } from 'vitest';
import { currencyMinorDigits } from './locale';
import {
  planBankTransferOffered,
  planCurrencyKnown,
  planPriceFromMinor,
  planPriceProblem,
  planPriceToMinor,
  planQuote,
} from './plan-pricing';
import { createPlanSchema } from './schemas/plan';

const plan = { price: '999900', prices: { AED: '399900', LKR: '1499900', USD: '4900' } };

describe('planQuote', () => {
  it('quotes rupees from the paise price', () => {
    expect(planQuote(plan, 'INR')).toEqual({ currency: 'INR', amount: '999900', basis: 'local' });
  });

  it('quotes a company in its own currency when the catalogue has it', () => {
    expect(planQuote(plan, 'LKR')).toEqual({ currency: 'LKR', amount: '1499900', basis: 'local' });
  });

  it('falls back to dollars, never converting', () => {
    expect(planQuote(plan, 'BDT')).toEqual({ currency: 'USD', amount: '4900', basis: 'fallback' });
  });

  it('is null — contact us — with neither', () => {
    expect(planQuote({ price: '1', prices: { AED: '1' } }, 'NPR')).toBeNull();
  });
});

describe('minor units', () => {
  it('agrees with Stripe that LKR, BDT and NPR have two decimals', () => {
    expect(currencyMinorDigits('LKR')).toBe(2);
    expect(currencyMinorDigits('BDT')).toBe(2);
    expect(currencyMinorDigits('NPR')).toBe(2);
    expect(currencyMinorDigits('USD')).toBe(2);
  });

  it('turns a typed price into minor units and back', () => {
    expect(planPriceToMinor('14,999', 'LKR')).toBe('1499900');
    expect(planPriceToMinor('49.5', 'USD')).toBe('4950');
    expect(planPriceToMinor('49.555', 'USD')).toBeNull();
    expect(planPriceToMinor('12.345', 'KWD')).toBe('12345');
    expect(planPriceFromMinor('1499900', 'NPR')).toBe('14999.00');
  });
});

describe('planPriceProblem', () => {
  it('accepts an ordinary price', () => {
    expect(planPriceProblem('BDT', '450000')).toBeNull();
    expect(planCurrencyKnown('NPR')).toBe(true);
  });

  it('refuses an unknown currency, a zero, and a dinar price Stripe cannot charge', () => {
    expect(planPriceProblem('XQQ', '100')).toMatch(/not a currency/);
    expect(planCurrencyKnown('XQQ')).toBe(false);
    expect(planPriceProblem('LKR', '0')).toMatch(/more than zero/);
    expect(planPriceProblem('KWD', '12345')).toMatch(/end in 0/);
    expect(planPriceProblem('KWD', '12340')).toBeNull();
  });

  it('is applied by the plan schema', () => {
    const base = { code: 'one_year', name: 'One year', months: 12, price: '999900' };
    expect(createPlanSchema.safeParse({ ...base, prices: { LKR: '1499900' } }).success).toBe(true);
    expect(createPlanSchema.safeParse({ ...base, prices: { XQQ: '1' } }).success).toBe(false);
  });
});

describe('planBankTransferOffered', () => {
  it('is for Bangladesh and Nepal', () => {
    expect(planBankTransferOffered('BD')).toBe(true);
    expect(planBankTransferOffered('NP')).toBe(true);
    expect(planBankTransferOffered('LK')).toBe(false);
    expect(planBankTransferOffered('IN')).toBe(false);
  });
});
