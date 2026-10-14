import { describe, expect, it } from 'vitest';
import {
  rfiAverageDays,
  rfiCanMove,
  rfiDaysBetween,
  rfiDueDate,
  rfiIsDueSoon,
  rfiIsOverdue,
  rfiLabel,
  rfiLinkMessage,
  submittalIsOverdue,
  submittalLabel,
} from './rfis';
import { createRfiSchema, rfiFileSchema, reviewSubmittalSchema } from './schemas/rfis';

describe('RFI labels and workflow', () => {
  it('numbers per site with three digits', () => {
    expect(rfiLabel(7)).toBe('RFI-007');
    expect(rfiLabel(1234)).toBe('RFI-1234');
    expect(submittalLabel(4)).toBe('SUB-004');
    expect(submittalLabel(4, 0)).toBe('SUB-004');
    expect(submittalLabel(4, 2)).toBe('SUB-004 Rev 2');
  });

  it('only moves forward, with answered able to go back to open', () => {
    expect(rfiCanMove('draft', 'open')).toBe(true);
    expect(rfiCanMove('open', 'answered')).toBe(true);
    expect(rfiCanMove('answered', 'open')).toBe(true);
    expect(rfiCanMove('answered', 'closed')).toBe(true);
    expect(rfiCanMove('open', 'closed')).toBe(false);
    expect(rfiCanMove('closed', 'open')).toBe(false);
    expect(rfiCanMove('void', 'open')).toBe(false);
  });
});

describe('RFI dates', () => {
  it('works the default due date on the calendar', () => {
    expect(rfiDueDate('2026-10-28', 7)).toBe('2026-11-04');
  });

  it('is overdue only while open and after the due day', () => {
    expect(rfiIsOverdue('open', '2026-10-05', '2026-10-06')).toBe(true);
    expect(rfiIsOverdue('open', '2026-10-06', '2026-10-06')).toBe(false);
    expect(rfiIsOverdue('answered', '2026-10-01', '2026-10-06')).toBe(false);
    expect(rfiIsOverdue('open', null, '2026-10-06')).toBe(false);
    expect(submittalIsOverdue('under_review', '2026-10-01', '2026-10-06')).toBe(true);
    expect(submittalIsOverdue('approved', '2026-10-01', '2026-10-06')).toBe(false);
  });

  it('is due soon inside the reminder window', () => {
    expect(rfiIsDueSoon('2026-10-08', '2026-10-06', 2)).toBe(true);
    expect(rfiIsDueSoon('2026-10-09', '2026-10-06', 2)).toBe(false);
    expect(rfiIsDueSoon('2026-10-05', '2026-10-06', 2)).toBe(false);
  });

  it('counts days and averages response times', () => {
    expect(rfiDaysBetween('2026-10-01', '2026-10-01')).toBe(0);
    expect(rfiDaysBetween('2026-10-01', '2026-10-04')).toBe(3);
    expect(rfiDaysBetween('2026-10-04', '2026-10-01')).toBe(-3);
    const day = (d: number) => new Date(Date.UTC(2026, 9, d));
    expect(rfiAverageDays([])).toBeNull();
    expect(
      rfiAverageDays([
        { from: day(1), to: day(3) },
        { from: day(1), to: day(4) },
        { from: day(2), to: null },
      ]),
    ).toBe(2.5);
  });
});

describe('RFI schemas', () => {
  it('needs a library document or an upload, not both', () => {
    expect(rfiFileSchema.safeParse({ document_id: '8a1d6c3e-6c43-4a8e-9c35-0d4a64c5b4a1' }).success).toBe(true);
    expect(rfiFileSchema.safeParse({ s3_key: 't/rfi_attachment/x.pdf' }).success).toBe(true);
    expect(rfiFileSchema.safeParse({}).success).toBe(false);
    expect(
      rfiFileSchema.safeParse({ document_id: '8a1d6c3e-6c43-4a8e-9c35-0d4a64c5b4a1', s3_key: 'x' }).success,
    ).toBe(false);
  });

  it('defaults discipline and priority, and treats an empty email as none', () => {
    const parsed = createRfiSchema.parse({
      project_id: '8a1d6c3e-6c43-4a8e-9c35-0d4a64c5b4a1',
      subject: 'Beam depth',
      question: 'What is the depth of B12?',
      addressed_to_email: '',
    });
    expect(parsed.discipline).toBe('other');
    expect(parsed.priority).toBe('normal');
    expect(parsed.addressed_to_email).toBeNull();
  });

  it('accepts only the four review outcomes', () => {
    expect(reviewSubmittalSchema.safeParse({ outcome: 'approved_as_noted' }).success).toBe(true);
    expect(reviewSubmittalSchema.safeParse({ outcome: 'under_review' }).success).toBe(false);
  });
});

describe('the link message', () => {
  it('says who is asking, what, by when and where', () => {
    const text = rfiLinkMessage({
      recipientName: 'Priya',
      companyName: 'Asha Builders',
      siteName: 'Harbour Point',
      label: 'RFI-003',
      subject: 'Slab level at grid C',
      dueOn: '2026-10-13',
      url: 'https://app.example/respond/abc',
      kind: 'rfi',
    });
    expect(text).toContain('Hello Priya,');
    expect(text).toContain('RFI-003 — Slab level at grid C');
    expect(text).toContain('2026-10-13');
    expect(text).toContain('https://app.example/respond/abc');
  });
});
