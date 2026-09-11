/**
 * Queue names and job payloads (spec §10).
 *
 * Every payload carries `tenantId` because a worker has no request to infer it
 * from: it sets `app.tenant_id` from the job itself before touching a tenant table,
 * so RLS holds in the background exactly as it does on the API.
 */

export const QUEUE = {
  notifications: 'notifications',
  whatsapp: 'whatsapp',
  reports: 'reports',
  media: 'media',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

// --- notifications (FCM + in-app) -----------------------------------------

export interface IndentStatusJob {
  tenantId: string;
  indentId: string;
  status: string;
  actorId: string;
}

export interface DprSubmittedJob {
  tenantId: string;
  dailyReportId: string;
}

export interface SiteMessagePostedJob {
  tenantId: string;
  projectId: string;
  messageId: string;
  authorId: string;
  /** `team` never reaches the client, which is the whole reason the audience exists. */
  audience: 'everyone' | 'team' | 'direct';
  /** Set only for `direct`: the one person told, instead of the job. */
  recipientId?: string | null;
}

export type NotificationJobName = 'indent-status' | 'dpr-submitted' | 'site-message';

export interface NotificationJobs {
  'indent-status': IndentStatusJob;
  'dpr-submitted': DprSubmittedJob;
  'site-message': SiteMessagePostedJob;
}

// --- whatsapp --------------------------------------------------------------

/** Fan-out job: enumerates tenants and queues one summary each. */
export interface FanOutJob {
  /** ISO date the run is *for*; absent means "today in IST". */
  date?: string;
}

export interface DailySummaryJob {
  tenantId: string;
  date: string;
}

export interface DprReminderJob {
  tenantId: string;
  date: string;
}

export interface WagePeriodFinalisedJob {
  tenantId: string;
  wagePeriodId: string;
}

export type WhatsappJobName =
  | 'fan-out-daily-summary'
  | 'daily-summary'
  | 'fan-out-dpr-reminder'
  | 'dpr-reminder'
  | 'wage-period-finalised';

export interface WhatsappJobs {
  'fan-out-daily-summary': FanOutJob;
  'daily-summary': DailySummaryJob;
  'fan-out-dpr-reminder': FanOutJob;
  'dpr-reminder': DprReminderJob;
  'wage-period-finalised': WagePeriodFinalisedJob;
}

// --- reports ---------------------------------------------------------------

export interface LabourRollupJob {
  tenantId: string;
  date: string;
}

export interface WagePeriodDraftJob {
  tenantId: string;
  date: string;
}

export type ReportJobName =
  | 'fan-out-labour-rollup'
  | 'labour-rollup'
  | 'fan-out-wage-period-draft'
  | 'wage-period-draft'
  | 'drop-lapsed-subscriptions';

export interface ReportJobs {
  'fan-out-labour-rollup': FanOutJob;
  'labour-rollup': LabourRollupJob;
  'fan-out-wage-period-draft': FanOutJob;
  'wage-period-draft': WagePeriodDraftJob;
  /**
   * No payload and no fan-out: the sweep finds its own candidates from `billing_identities`, which is
   * the only way to enumerate subscribed tenants without an RLS-bypassing connection.
   */
  'drop-lapsed-subscriptions': Record<string, never>;
}

// --- media -----------------------------------------------------------------

export interface ThumbnailJob {
  tenantId: string;

  /**
   * Which table the row is in. Optional so jobs queued before site photos were thumbnailed still
   * process — they are all DPR photos.
   */
  kind?: 'dpr_photo' | 'project_media';

  /** The `dpr_photos.id` or `project_media.id` this thumbnail is for. */
  mediaId: string;
  s3Key: string;
}

export type MediaJobName = 'thumbnail';

export interface MediaJobs {
  thumbnail: ThumbnailJob;
}

/**
 * Retry policy (spec §15: "jobs retried 3× with backoff").
 *
 * Completed jobs are trimmed aggressively and failures kept for a week — a
 * WhatsApp summary that never arrived is a support question days later, and the
 * failed job is the only record of why.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};
