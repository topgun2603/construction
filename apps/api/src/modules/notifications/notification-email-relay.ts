/**
 * Something that can copy an in-app notification to people's inboxes — the Microsoft 365
 * integration, when a company has connected a mailbox.
 *
 * A token rather than an import so notifications do not depend on the integration (which depends,
 * through the features it sends for, on modules that depend on notifications). Optional: with
 * nothing bound — a unit test, or a build without the integration — notifications behave exactly as
 * they always did.
 */
export const NOTIFICATION_EMAIL_RELAY = Symbol('NOTIFICATION_EMAIL_RELAY');

export interface NotificationEmail {
  tenantId: string;
  userIds: string[];
  projectId?: string;
  type: string;
  title: string;
  body: string;
  payload?: unknown;
}

export interface NotificationEmailRelay {
  /** Never throws: an email that could not go must not undo the notification that did. */
  relay(notice: NotificationEmail): Promise<void>;
}
