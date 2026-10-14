import { describe, expect, it } from 'vitest';
import { createFormat, indiaFormat } from './format';
import {
  amountToMinorString,
  minorToAmountInput,
  paiseToRupeesInput,
  rupeesToPaiseString,
} from './money-input';

const dubai = createFormat({ currency: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai' });
const kuwait = createFormat({ currency: 'KWD', locale: 'en-KW', timezone: 'Asia/Kuwait' });

describe('createFormat', () => {
  it('prints an Indian company exactly as before companies had settings', () => {
    expect(indiaFormat.money('123456789')).toBe('₹12,34,567.89');
    expect(indiaFormat.moneyShort('4200000000')).toBe('₹4.2 Cr');
    expect(indiaFormat.count(123456)).toBe('1,23,456');
    expect(indiaFormat.shortDate('2026-03-02')).toBe('2 Mar');
    expect(indiaFormat.currencySymbol).toBe('₹');
  });

  it('prints a UAE company in dirhams, with western grouping', () => {
    expect(dubai.money('123456789')).toContain('1,234,567.89');
    expect(dubai.money('123456789')).not.toContain('₹');
    expect(dubai.moneyShort('4200000000')).not.toContain('Cr');
    expect(dubai.count(123456)).toBe('123,456');
    expect(dubai.currencyDigits).toBe(2);
  });

  it('keeps a dinar to three places', () => {
    expect(kuwait.currencyDigits).toBe(3);
    expect(kuwait.money('1250500')).toContain('1,250.500');
  });

  it('puts an instant on the company’s clock, not the server’s', () => {
    // 18:40 UTC is past midnight in Kolkata (00:10 next day) and still the evening in Dubai.
    const instant = '2026-10-04T18:40:00Z';
    expect(indiaFormat.instantDate(instant)).toBe('5 Oct');
    expect(dubai.instantDate(instant)).toContain('4');
  });

  it('shows the stored calendar day whatever the zone', () => {
    expect(dubai.shortDate('2026-03-02')).toContain('2');
    expect(dubai.shortDate(null)).toBe('—');
  });
});

describe('amountToMinorString', () => {
  it('is unchanged for rupees', () => {
    expect(rupeesToPaiseString('1,250.50')).toBe('125050');
    expect(rupeesToPaiseString('₹650')).toBe('65000');
    expect(paiseToRupeesInput('65000')).toBe('650');
    expect(paiseToRupeesInput('125050')).toBe('1250.50');
  });

  it('scales by the currency’s places and strips its symbol', () => {
    expect(amountToMinorString('1.250', 3)).toBe('1250');
    expect(amountToMinorString('AED 1,250', 2, 'AED')).toBe('125000');
    expect(() => amountToMinorString('1.2345', 3)).toThrow(RangeError);
    expect(minorToAmountInput('1250', 3)).toBe('1.250');
    expect(minorToAmountInput('2000', 3)).toBe('2');
  });
});
