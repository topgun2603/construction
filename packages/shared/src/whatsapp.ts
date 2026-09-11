/**
 * WhatsApp click-to-chat.
 *
 * BUILDR never sends a message *as* somebody's personal WhatsApp account. Doing that needs an
 * unofficial client driving WhatsApp Web, which breaks WhatsApp's terms and gets numbers banned —
 * and the number at risk would be the builder's own, the one their clients and suppliers reach them
 * on. Losing it is not a bug report, it is the end of their week.
 *
 * So the app composes the message and hands it to WhatsApp with the recipient and text already
 * filled in. The builder presses send, from their own number, in their own app. No API, no cost, no
 * template approval, and the client gets a message from a person rather than from a robot.
 *
 * Automated sends — the daily summary, indent alerts — go through the Cloud API on the company's
 * own business number instead. That is the other half of the picture and it lives in the API.
 */

/**
 * A chat link for a stored phone number, or null when the number cannot be dialled.
 *
 * Numbers are stored E.164 without the plus (`919876543210`), which is exactly what wa.me wants.
 * Anything that is not a plausible international number returns null so the caller can leave the
 * button out rather than open a chat with nobody.
 */
export function whatsappHref(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  // ITU E.164: at most 15 digits, and nothing under 10 is a mobile with a country code on it.
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(clip(text))}`;
}

/**
 * Long messages are cut rather than sent whole.
 *
 * The text rides in a URL, and some Android launchers hand WhatsApp a truncated intent well before
 * any documented limit. A message that ends mid-sentence is bad; one whose sign-in link has lost its
 * last characters is worse, because it looks like it worked.
 */
const MESSAGE_LIMIT = 1200;

function clip(text: string): string {
  return text.length <= MESSAGE_LIMIT ? text : `${text.slice(0, MESSAGE_LIMIT - 1).trimEnd()}…`;
}

/** `['A', 'B', 'C']` → `'A, B and C'`. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface InviteMessageInput {
  /** Who is being invited. */
  name: string;
  /** The builder's company, as the client knows it. */
  companyName: string;
  /** Who is sending — a name the recipient recognises, not "BUILDR". */
  senderName: string;
  /** What they were invited as, in the words the invite form used. */
  roleLabel: string;
  /** The sites they were given, if any. */
  siteNames: string[];
  /** Where to sign in. */
  url: string;
}

/**
 * "You have been added, here is how to get in."
 *
 * Written to be read on a phone by somebody who has never heard of this software: what it is, who
 * added them, and the one thing they have to do. No password, because there isn't one — the invite
 * is tied to the number the message is going to.
 */
export function inviteMessageText(input: InviteMessageInput): string {
  const scope = input.siteNames.length > 0 ? ` for ${listPhrase(input.siteNames)}` : '';
  return [
    `Hi ${input.name},`,
    '',
    `I've added you to ${input.companyName} on BUILDR as ${input.roleLabel}${scope}.`,
    '',
    `Open ${input.url} and sign in with this number — you'll get a one-time code by SMS. Nothing to install and no password to remember.`,
    '',
    `- ${input.senderName}`,
  ].join('\n');
}

export interface SiteUpdateMessageInput {
  /** Who it is going to. Left out of the greeting when unknown. */
  name?: string;
  siteName: string;
  companyName: string;
  senderName: string;
  url: string;
}

/**
 * "Here is the live view of your building."
 *
 * The link is the same dashboard the site team uses, scoped by the recipient's role — a client sees
 * their own site and nothing else. So this says what they will find, rather than promising a report
 * that somebody then has to remember to write.
 */
export function siteUpdateMessageText(input: SiteUpdateMessageInput): string {
  return [
    input.name ? `Hi ${input.name},` : 'Hi,',
    '',
    `Live view of ${input.siteName} — progress, site photos and the daily reports as we file them:`,
    input.url,
    '',
    `Sign in with this number to open it; you'll get a one-time code by SMS.`,
    '',
    `- ${input.senderName}, ${input.companyName}`,
  ].join('\n');
}
