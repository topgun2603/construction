import { escapeHtml, rfiSentEmail, safeUrl, subjectLine, textOf } from './email-templates';

describe('email templates', () => {
  it('escapes everything a person typed', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
    const email = rfiSentEmail({
      companyName: 'Acme <Builders>',
      recipientName: '<b>Priya</b>',
      siteName: 'Tower "A"',
      label: 'RFI-001',
      subject: '<img src=x onerror=alert(1)>',
      question: 'Line one\n<a href="javascript:alert(1)">two</a>',
      dueOn: '2026-10-10',
      url: 'https://app.example/respond/abc',
      note: '<i>urgent</i>',
    });
    expect(email.html).not.toMatch(/<img|<b>|<i>|<a href="javascript/);
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Line one<br>&lt;a href=');
    expect(textOf(email.html)).toContain('https://app.example/respond/abc');
  });

  it('only links to http(s)', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('not a url')).toBe('#');
    expect(safeUrl('https://app.example/a?b=1&c=2')).toBe('https://app.example/a?b=1&amp;c=2');
  });

  it('keeps a subject on one line, so it cannot add headers', () => {
    expect(subjectLine('RFI-001: slab\r\nBcc: everyone@example.com')).toBe('RFI-001: slab Bcc: everyone@example.com');
    expect(subjectLine('x'.repeat(400))).toHaveLength(250);
  });
});
