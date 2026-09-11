import { Injectable, Logger } from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens FCM says are dead — safe to drop from the user. */
  staleTokens: string[];
  dryRun: boolean;
}

/**
 * Firebase Cloud Messaging (spec §11).
 *
 * Reports the tokens FCM rejects as unregistered so the caller can prune them.
 * Without that a reinstalled app leaves a dead token on the user forever, and
 * every later send wastes a round trip on it.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly config = env();
  private app?: App;

  get configured(): boolean {
    return Boolean(
      this.config.FIREBASE_SERVICE_ACCOUNT || this.config.FIREBASE_SERVICE_ACCOUNT_FILE,
    );
  }

  async push(message: PushMessage): Promise<PushResult> {
    const tokens = [...new Set(message.tokens)].filter(Boolean);
    if (tokens.length === 0) return { sent: 0, failed: 0, staleTokens: [], dryRun: false };

    if (!this.configured) {
      this.logger.log(
        { tokens: tokens.length, title: message.title },
        'FCM dry run - no Firebase credential configured',
      );
      return { sent: 0, failed: 0, staleTokens: [], dryRun: true };
    }

    try {
      const response = await getMessaging(this.firebaseApp()).sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high' },
      });

      const staleTokens: string[] = [];
      response.responses.forEach((result, index) => {
        const code = result.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const token = tokens[index];
          if (token) staleTokens.push(token);
        }
      });

      return {
        sent: response.successCount,
        failed: response.failureCount,
        staleTokens,
        dryRun: false,
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'FCM send failed');
      return { sent: 0, failed: tokens.length, staleTokens: [], dryRun: false };
    }
  }

  private firebaseApp(): App {
    if (this.app) return this.app;
    const existing = getApps().find((app) => app.name === 'sitebook');
    this.app =
      existing ??
      initializeApp(
        {
          credential: cert(this.serviceAccount()),
          ...(this.config.FIREBASE_PROJECT_ID
            ? { projectId: this.config.FIREBASE_PROJECT_ID }
            : {}),
        },
        'sitebook',
      );
    return this.app;
  }

  private serviceAccount(): Record<string, string> {
    const path = this.config.FIREBASE_SERVICE_ACCOUNT_FILE;
    if (path) return JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, string>;
    return JSON.parse(this.config.FIREBASE_SERVICE_ACCOUNT ?? '{}') as Record<string, string>;
  }
}
