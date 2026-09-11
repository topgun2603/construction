import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { toE164Indian } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * Verifies a Firebase phone-auth ID token and returns the phone number it proves
 * (spec §6.2). Firebase is the OTP vendor; it never becomes our session.
 */
@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);
  private readonly config = env();
  private app?: App;

  async verify(idToken: string): Promise<string> {
    if (this.config.DEV_AUTH_BYPASS) {
      const phone = devBypassPhone(idToken);
      if (phone) {
        this.logger.warn(`DEV_AUTH_BYPASS accepted a token for ${phone}`);
        return phone;
      }
    }

    const decoded = await this.verifyWithFirebase(idToken);
    const phone = decoded.phone_number;
    if (!phone) throw ApiError.invalidToken('Firebase token carries no phone number');

    const normalised = normalisePhone(phone);
    if (!normalised) {
      // Firebase will happily verify a number from any country; we only issue
      // sessions for Indian mobiles, which is what every stored phone is.
      this.logger.warn('Firebase token carried a phone we cannot store');
      throw ApiError.invalidToken('Only Indian mobile numbers can sign in');
    }
    return normalised;
  }

  private async verifyWithFirebase(idToken: string) {
    try {
      return await getAuth(this.firebaseApp()).verifyIdToken(idToken, true);
    } catch (error) {
      this.logger.warn({ err: error }, 'Firebase token verification failed');
      throw ApiError.invalidToken('Could not verify the sign-in token');
    }
  }

  private firebaseApp(): App {
    if (this.app) return this.app;

    const existing = getApps()[0];
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

  /**
   * The Admin SDK credential. A file path is preferred over inline JSON: the key is
   * a multi-line PEM, and round-tripping it through a shell variable is where
   * "invalid PEM formatted message" comes from.
   */
  private serviceAccount(): Record<string, string> {
    const path = this.config.FIREBASE_SERVICE_ACCOUNT_FILE;
    if (path) {
      try {
        return JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, string>;
      } catch (error) {
        throw new Error(
          `Could not read FIREBASE_SERVICE_ACCOUNT_FILE at ${path}: ${(error as Error).message}`,
        );
      }
    }

    const raw = this.config.FIREBASE_SERVICE_ACCOUNT;
    if (raw) return JSON.parse(raw) as Record<string, string>;

    throw new Error(
      'No Firebase credential configured. Set FIREBASE_SERVICE_ACCOUNT_FILE (preferred) ' +
        'or FIREBASE_SERVICE_ACCOUNT, or set DEV_AUTH_BYPASS=true and sign in with a ' +
        '"dev:<phone>" token for local development.',
    );
  }
}

/**
 * Local development and the e2e suite need a way to sign in without a real SMS.
 * The token shape is `dev:919876543210`. Guarded twice: the flag defaults to false
 * and env validation refuses to let it be true in production.
 */
function devBypassPhone(token: string): string | null {
  if (!token.startsWith('dev:')) return null;
  return normalisePhone(token.slice('dev:'.length));
}

/**
 * Store phones as `91XXXXXXXXXX`: E.164 without the plus. Returns null when the
 * input is not an Indian mobile.
 *
 * Delegates to the shared helper rather than repeating the rules, because this and
 * `phoneSchema` have to agree exactly: invite writes the phone through the schema
 * and sign-in looks it up through here, so any drift between the two locks a real
 * person out of their account with nothing to show in the logs.
 */
export function normalisePhone(phone: string): string | null {
  return toE164Indian(phone);
}
