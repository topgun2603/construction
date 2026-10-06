/**
 * The emails the product sends from a company's own Microsoft 365 mailbox, and the body of the
 * meeting invites it books.
 *
 * Deliberately plain: one column, inline styles only (Outlook ignores `<style>` blocks in half its
 * versions and every webmail strips them), system fonts, a single button that is also written out
 * as a link underneath for clients that draw no buttons. Branded with the *company's* name — the
 * mail comes from their mailbox, so it should read as theirs, with this product a small footer line.
 *
 * Every value a person typed (a subject, a question, a name, the minutes) goes through `escapeHtml`
 * — an RFI subject is not markup, and a `<script>` or `<a href=…>` in one must arrive as text. Links
 * are only ever URLs this API built, and still pass `safeUrl`.
 *
 * Graph's JSON sendMail takes one body; this is the HTML one, and Exchange adds the plain-text
 * alternative to the outgoing MIME for clients that want text. The markup is written so that
 * reading (`textOf`, which the unit tests check) stays a sensible letter: every link is also
 * printed in full, and nothing important lives only in styling.
 */

export interface EmailContent {
  subject: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links, escaped for an attribute. Anything else becomes `#`. */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? escapeHtml(url.toString()) : '#';
  } catch {
    return '#';
  }
}

/** Escaped text with its line breaks kept — a question typed over three lines reads as three lines. */
function paragraphText(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, '<br>');
}

/** A subject line is a header: no line breaks (header injection), and not a novel. */
export function subjectLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250);
}

interface LayoutInput {
  companyName: string;
  heading: string;
  /** Plain text; escaped here. */
  paragraphs?: string[];
  /** The sender's own words above the standard text, escaped and set apart. */
  note?: string | null;
  details?: Array<[string, string | null | undefined]>;
  /** Preformatted, already-escaped HTML blocks (lists, minutes). Only built in this file. */
  blocks?: string[];
  button?: { label: string; url: string } | null;
  footer?: string;
}

const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function layout(input: LayoutInput): string {
  const details = (input.details ?? []).filter((row): row is [string, string] => Boolean(row[1]));
  const parts: string[] = [];
  parts.push(
    `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">${escapeHtml(input.companyName)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827">${escapeHtml(input.heading)}</h1>`,
  );
  if (input.note?.trim()) {
    parts.push(
      `<p style="margin:0 0 16px;padding:12px 14px;border-inline-start:3px solid #d97706;background:#fffbeb;color:#111827">${paragraphText(input.note)}</p>`,
    );
  }
  for (const paragraph of input.paragraphs ?? []) {
    parts.push(`<p style="margin:0 0 12px;color:#111827">${paragraphText(paragraph)}</p>`);
  }
  if (details.length > 0) {
    const rows = details
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0;color:#111827">${paragraphText(value)}</td></tr>`,
      )
      .join('');
    parts.push(`<table role="presentation" style="margin:0 0 16px;border-collapse:collapse;font-size:14px">${rows}</table>`);
  }
  parts.push(...(input.blocks ?? []));
  if (input.button) {
    const href = safeUrl(input.button.url);
    parts.push(
      `<p style="margin:20px 0 8px"><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(input.button.label)}</a></p>`,
      `<p style="margin:0 0 16px;font-size:12px;color:#6b7280;word-break:break-all">${href}</p>`,
    );
  }
  parts.push(
    `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${escapeHtml(
      input.footer ?? `Sent by ${input.companyName} with BUILDR.`,
    )}</p>`,
  );
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;${FONT};font-size:15px;line-height:1.5"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px">${parts.join('')}</div></body></html>`;
}

/** The plain-text reading of a body built here: tags out, entities back, blank lines tidied. */
export function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|tr|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keeps a long question from turning an email into the whole RFI. */
function excerpt(value: string | null | undefined, max = 1200): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// --- RFIs and submittals ---------------------------------------------------------------------------

export function rfiSentEmail(input: {
  companyName: string;
  recipientName: string | null;
  siteName: string;
  label: string;
  subject: string;
  question: string | null;
  dueOn: string | null;
  url: string;
  note?: string | null;
}): EmailContent {
  return {
    subject: subjectLine(`${input.label}: ${input.subject} — ${input.siteName}`),
    html: layout({
      companyName: input.companyName,
      heading: `${input.label}: ${input.subject}`,
      note: input.note,
      paragraphs: [
        `${input.recipientName ? `Dear ${input.recipientName},` : 'Hello,'}`,
        `${input.companyName} has a question about ${input.siteName}. Please answer through the link below — no account or password is needed, and you can attach drawings or photos.`,
      ],
      details: [
        ['Site', input.siteName],
        ['Question', excerpt(input.question)],
        ['Answer by', input.dueOn],
      ],
      button: { label: 'Answer this RFI', url: input.url },
      footer: `The link works for 30 days unless ${input.companyName} withdraws it. Sent by ${input.companyName} with BUILDR.`,
    }),
  };
}

export function submittalReviewEmail(input: {
  companyName: string;
  recipientName: string | null;
  siteName: string;
  label: string;
  title: string;
  dueOn: string | null;
  url: string;
  note?: string | null;
}): EmailContent {
  return {
    subject: subjectLine(`For review: ${input.label} ${input.title} — ${input.siteName}`),
    html: layout({
      companyName: input.companyName,
      heading: `For review: ${input.label} ${input.title}`,
      note: input.note,
      paragraphs: [
        `${input.recipientName ? `Dear ${input.recipientName},` : 'Hello,'}`,
        `${input.companyName} has sent a submittal for your review. Open the link to see the documents and record your decision — approved, approved as noted, revise and resubmit, or rejected. No account is needed.`,
      ],
      details: [
        ['Site', input.siteName],
        ['Review by', input.dueOn],
      ],
      button: { label: 'Review the submittal', url: input.url },
      footer: `The link works for 30 days unless ${input.companyName} withdraws it. Sent by ${input.companyName} with BUILDR.`,
    }),
  };
}

/** An in-app notification (RFI answered, RFIs overdue) mirrored to a team member's inbox. */
export function notificationEmail(input: {
  companyName: string;
  title: string;
  body: string;
  url: string | null;
  buttonLabel: string;
}): EmailContent {
  return {
    subject: subjectLine(input.title),
    html: layout({
      companyName: input.companyName,
      heading: input.title,
      paragraphs: [input.body],
      button: input.url ? { label: input.buttonLabel, url: input.url } : null,
      footer: `You get this because you are on the team at ${input.companyName}. Sent with BUILDR.`,
    }),
  };
}

// --- change orders ---------------------------------------------------------------------------------

export function changeOrderEmail(input: {
  companyName: string;
  siteName: string;
  label: string;
  title: string;
  price: string | null;
  days: number | null;
  url: string;
  note?: string | null;
}): EmailContent {
  return {
    subject: subjectLine(`Change order ${input.label} needs your decision — ${input.siteName}`),
    html: layout({
      companyName: input.companyName,
      heading: `Change order ${input.label}: ${input.title}`,
      note: input.note,
      paragraphs: [
        `${input.companyName} has sent a change order on ${input.siteName} for your decision. Sign in to approve or reject it; your answer is recorded with your name.`,
      ],
      details: [
        ['Site', input.siteName],
        ['Price', input.price],
        ['Time', input.days === null ? null : `${input.days} day${input.days === 1 ? '' : 's'}`],
      ],
      button: { label: 'Review the change order', url: input.url },
    }),
  };
}

// --- meetings --------------------------------------------------------------------------------------

export interface MinutesActionItem {
  description: string;
  owner: string | null;
  dueOn: string | null;
  done: boolean;
}

export function meetingMinutesEmail(input: {
  companyName: string;
  siteName: string;
  title: string;
  when: string;
  location: string | null;
  attendees: string[];
  minutes: string | null;
  actionItems: MinutesActionItem[];
  url: string | null;
  note?: string | null;
}): EmailContent {
  const blocks: string[] = [];
  if (input.minutes?.trim()) {
    blocks.push(
      `<h2 style="margin:16px 0 8px;font-size:16px;color:#111827">Minutes</h2>`,
      `<p style="margin:0 0 12px;color:#111827">${paragraphText(input.minutes)}</p>`,
    );
  }
  if (input.actionItems.length > 0) {
    const rows = input.actionItems
      .map(
        (item) =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.description)}${item.done ? ' <span style="color:#059669">(done)</span>' : ''}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(item.owner ?? '—')}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(item.dueOn ?? '—')}</td></tr>`,
      )
      .join('');
    blocks.push(
      `<h2 style="margin:16px 0 8px;font-size:16px;color:#111827">Action items</h2>`,
      `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e5e7eb">Action</th><th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e5e7eb">Owner</th><th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e5e7eb">Due</th></tr>${rows}</table>`,
    );
  }
  return {
    subject: subjectLine(`Minutes: ${input.title} — ${input.siteName}`),
    html: layout({
      companyName: input.companyName,
      heading: `Minutes: ${input.title}`,
      note: input.note,
      details: [
        ['Site', input.siteName],
        ['When', input.when],
        ['Where', input.location],
        ['Attendees', input.attendees.join(', ') || null],
      ],
      blocks,
      button: input.url ? { label: 'Open the meeting', url: input.url } : null,
    }),
  };
}

/** The body of the Outlook invite: the agenda, and a link back for the team. */
export function meetingInviteBody(input: {
  companyName: string;
  siteName: string;
  agenda: string | null;
  url: string | null;
}): string {
  const parts = [`<p>${escapeHtml(input.companyName)} · ${escapeHtml(input.siteName)}</p>`];
  if (input.agenda?.trim()) parts.push(`<p><strong>Agenda</strong><br>${paragraphText(input.agenda)}</p>`);
  if (input.url) parts.push(`<p><a href="${safeUrl(input.url)}">Open the meeting in BUILDR</a></p>`);
  return parts.join('');
}
