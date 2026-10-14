import { describe, expect, it } from 'vitest';
import { M365_SCOPES, m365UniqueEmails, meetingActionIsOverdue } from './m365';
import { m365SendEmailSchema, meetingCreateSchema, meetingUpdateSchema } from './schemas/m365';

describe('m365', () => {
  it('asks Microsoft for the least it needs', () => {
    expect([...M365_SCOPES]).toEqual(['offline_access', 'Mail.Send', 'Calendars.ReadWrite', 'User.Read']);
    expect(M365_SCOPES).not.toContain('Mail.Read' as never);
  });

  it('de-duplicates addresses case-insensitively, keeping the first order', () => {
    expect(m365UniqueEmails(['A@x.com', null, 'b@x.com', 'a@X.com ', ''])).toEqual(['a@x.com', 'b@x.com']);
  });

  it('lower-cases recipients and caps how many', () => {
    expect(m365SendEmailSchema.parse({ to: ['Arch@Firm.COM'] }).to).toEqual(['arch@firm.com']);
    const tooMany = Array.from({ length: 11 }, (_, i) => `p${i}@x.com`);
    expect(m365SendEmailSchema.safeParse({ to: tooMany }).success).toBe(false);
  });
});

describe('meetings', () => {
  const base = { project_id: '7d3f6f0e-7a51-4c55-9d3c-6a8e4f1c2b10', title: 'Weekly coordination' };
  const hour = { starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T11:00:00Z' };

  it('needs the end after the start, and at most twelve hours', () => {
    const ok = { ...base, starts_at: '2026-10-07T10:00:00+05:30', ends_at: '2026-10-07T11:00:00+05:30' };
    expect(meetingCreateSchema.safeParse(ok).success).toBe(true);
    const backwards = { ...base, starts_at: '2026-10-07T10:00:00Z', ends_at: '2026-10-07T09:00:00Z' };
    expect(meetingCreateSchema.safeParse(backwards).success).toBe(false);
    const tooLong = { ...base, starts_at: '2026-10-07T00:00:00Z', ends_at: '2026-10-07T13:00:00Z' };
    expect(meetingCreateSchema.safeParse(tooLong).success).toBe(false);
  });

  it('takes team members by id or anybody by address, nothing else', () => {
    const byAddress = { ...base, ...hour, attendees: [{ email: 'qs@firm.com', name: 'QS' }] };
    expect(meetingCreateSchema.safeParse(byAddress).success).toBe(true);
    expect(meetingCreateSchema.safeParse({ ...base, ...hour, attendees: [{ name: 'Nobody' }] }).success).toBe(false);
  });

  it('moves the start and end together on an edit', () => {
    expect(meetingUpdateSchema.safeParse({ starts_at: '2026-10-07T10:00:00Z' }).success).toBe(false);
    expect(meetingUpdateSchema.safeParse({ minutes: 'Agreed the slab pour for Friday.' }).success).toBe(true);
  });

  it('calls an open action overdue only after its day', () => {
    expect(meetingActionIsOverdue('open', '2026-10-05', '2026-10-06')).toBe(true);
    expect(meetingActionIsOverdue('open', '2026-10-06', '2026-10-06')).toBe(false);
    expect(meetingActionIsOverdue('done', '2026-10-01', '2026-10-06')).toBe(false);
    expect(meetingActionIsOverdue('open', null, '2026-10-06')).toBe(false);
  });
});
