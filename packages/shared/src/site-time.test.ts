import { describe, expect, it } from 'vitest';
import { siteTimeToday, siteTimeZone, siteTimeZoneDiffers, siteTimeZoneHint } from './site-time';

const company = { timezone: 'Asia/Kolkata' };

describe('siteTimeZone', () => {
  it('is the site’s own zone when it has one, in either spelling', () => {
    expect(siteTimeZone({ time_zone: 'Asia/Dubai' }, company)).toBe('Asia/Dubai');
    expect(siteTimeZone({ timeZone: 'Asia/Dubai' }, company)).toBe('Asia/Dubai');
  });

  it('falls back to the company’s', () => {
    expect(siteTimeZone({ time_zone: null }, company)).toBe('Asia/Kolkata');
    expect(siteTimeZone(null, company)).toBe('Asia/Kolkata');
  });
});

describe('siteTimeToday', () => {
  // 19:00 UTC: already the 7th in Kolkata (00:30), still the 6th in Dubai (23:00).
  const instant = new Date('2026-10-06T19:00:00Z');

  it('turns over at the site’s midnight, not the company’s', () => {
    expect(siteTimeToday(null, company, instant)).toBe('2026-10-07');
    expect(siteTimeToday({ time_zone: 'Asia/Dubai' }, company, instant)).toBe('2026-10-06');
  });
});

describe('siteTimeZoneDiffers and siteTimeZoneHint', () => {
  it('flags only a zone that is not the company’s', () => {
    expect(siteTimeZoneDiffers({ time_zone: 'Asia/Dubai' }, company)).toBe(true);
    expect(siteTimeZoneDiffers({ time_zone: 'Asia/Kolkata' }, company)).toBe(false);
    expect(siteTimeZoneDiffers({}, company)).toBe(false);
  });

  it('names the city and the offset', () => {
    expect(siteTimeZoneHint('Asia/Dubai')).toBe('Dubai · GMT+4');
    expect(siteTimeZoneHint('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(
      'New York · GMT-5',
    );
  });
});
