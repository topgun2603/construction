import type { MeetingStatus } from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/** Scheduled is still to happen; held has its minutes; cancelled is greyed out. */
export const MEETING_STATUS_TONE: Record<MeetingStatus, Tone> = {
  scheduled: 'pending',
  held: 'done',
  cancelled: 'neutral',
};
