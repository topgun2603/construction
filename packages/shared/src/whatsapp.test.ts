import { describe, expect, it } from 'vitest';
import {
  inviteMessageText,
  listPhrase,
  siteUpdateMessageText,
  whatsappHref,
} from './whatsapp';

describe('whatsappHref', () => {
  it('builds a chat link from a stored number', () => {
    const href = whatsappHref('919876543210', 'hello');
    expect(href).toBe('https://wa.me/919876543210?text=hello');
  });

  it('strips whatever punctuation the number was typed with', () => {
    expect(whatsappHref('+91 98765 43210', 'hi')).toBe('https://wa.me/919876543210?text=hi');
  });

  it('encodes the text, newlines and links included', () => {
    const href = whatsappHref('919876543210', 'Line one\nhttps://a.example/x?y=1&z=2');
    // A raw & would end the text parameter and lose everything after it.
    expect(href).toContain('%0A');
    expect(href).toContain('%26z%3D2');
    expect(href).not.toMatch(/text=.*&z=/);
  });

  it('refuses a number that could not be dialled', () => {
    // Better no button than a chat opened with nobody.
    expect(whatsappHref('98765', 'hi')).toBeNull();
    expect(whatsappHref('', 'hi')).toBeNull();
    expect(whatsappHref(null, 'hi')).toBeNull();
    expect(whatsappHref('9198765432101234567', 'hi')).toBeNull();
  });

  it('clips a very long message', () => {
    const href = whatsappHref('919876543210', 'x'.repeat(5000));
    expect(href).not.toBeNull();
    expect(decodeURIComponent(href!.split('text=')[1]!)).toHaveLength(1200);
  });
});

describe('listPhrase', () => {
  it('reads like a sentence', () => {
    expect(listPhrase([])).toBe('');
    expect(listPhrase(['Lakeview'])).toBe('Lakeview');
    expect(listPhrase(['Lakeview', 'Green Acres'])).toBe('Lakeview and Green Acres');
    expect(listPhrase(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('message text', () => {
  const base = {
    name: 'Ravi',
    companyName: 'Sri Realtime',
    senderName: 'Gowtham',
    roleLabel: 'Client',
    url: 'https://buildr.example/login',
  };

  it('names the sites somebody was given', () => {
    const text = inviteMessageText({ ...base, siteNames: ['Lakeview Tower', 'Green Acres'] });
    expect(text).toContain('for Lakeview Tower and Green Acres');
    expect(text).toContain('as Client');
    expect(text).toContain(base.url);
    // The number being messaged is the number that signs in — that is the whole instruction.
    expect(text).toMatch(/sign in with this number/i);
  });

  it('says nothing about sites when none were given', () => {
    const text = inviteMessageText({ ...base, roleLabel: 'Accounts', siteNames: [] });
    expect(text).not.toContain(' for ');
    expect(text).toContain('as Accounts');
  });

  it('greets without a name when there is none', () => {
    const text = siteUpdateMessageText({
      siteName: 'Lakeview Tower',
      companyName: 'Sri Realtime',
      senderName: 'Gowtham',
      url: 'https://buildr.example/projects/1',
    });
    expect(text.startsWith('Hi,')).toBe(true);
    expect(text).toContain('Lakeview Tower');
    expect(text).toContain('- Gowtham, Sri Realtime');
  });
});
