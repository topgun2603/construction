import { randomBytes } from 'node:crypto';
import { FieldCipher, hintOf } from './field-cipher';

describe('FieldCipher', () => {
  const cipher = new FieldCipher(randomBytes(32).toString('base64'));

  it('round-trips, and never stores the same number the same way twice', () => {
    const a = cipher.encrypt('784-1990-1234567-1');
    const b = cipher.encrypt('784-1990-1234567-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('1234567');
    expect(cipher.decrypt(a)).toBe('784-1990-1234567-1');
  });

  it('refuses a tampered value rather than returning rubbish', () => {
    const stored = cipher.encrypt('P1234567');
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    expect(() => cipher.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('cannot be read with another key', () => {
    const other = new FieldCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(cipher.encrypt('P1234567'))).toThrow();
  });

  it('shows only the last four characters', () => {
    expect(hintOf('784-1990-1234567-1')).toBe('5671');
    expect(hintOf('P12')).toBe('P12');
  });
});
