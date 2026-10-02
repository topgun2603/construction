import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { toE164Indian } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';

/**
 * What a verified Firebase token proves: control of a phone number, or of an email address.
 *
 * Two shapes rather than one nullable pair, because every caller has to handle both and a struct
 * with two optional fields lets one of them be forgotten.
 */
export type VerifiedIdentity =
  | { kind: 'phone'; phone: string }
  | { kind: 'email'; email: string };

/**
 * Verifies a Firebase ID token and returns what it proves (spec §6.2). Firebase is the vendor for
 * OTP and for Google; it never becomes our session.
 */
@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);
  private readonly config = env();
  private app?: App;

  /**
   * The phone a token proves. Kept for the paths that are phone-only by nature — onboarding mints
   * a tenant around a number, and a Google account does not carry one.
   */
  async verify(idToken: string): Promise<string> {
    const identity = await this.verifyIdentity(idToken);
    if (identity.kind !== 'phone') {
      throw ApiError.invalidToken('This step needs a mobile number, not a Google account');
    }
    return identity.phone;
  }

  async verifyIdentity(idToken: string): Promise<VerifiedIdentity> {
    if (this.config.DEV_AUTH_BYPASS) {
      const bypass = devBypassIdentity(idToken);
      if (bypass) {
        this.logger.warn(
          `DEV_AUTH_BYPASS accepted a token for ${bypass.kind === 'phone' ? bypass.phone : bypass.email}`,
        );
        return bypass;
      }
    }

    // A `dev:` token arriving at a server with the bypass off means the *client* was built for
    // development and shipped anyway. Saying so is worth the extra branch: otherwise Firebase
    // rejects the string like any other malformed token and the error blames the token, which sends
    // whoever is debugging it to the service account instead of to the bundle. That happened.
    if (idToken.startsWith('dev:')) {
      this.logger.warn('A development sign-in token reached a server with DEV_AUTH_BYPASS off');
      throw ApiError.invalidToken(
        'This app was built for development and cannot sign in here. Reinstall the release build.',
      );
    }

    const decoded = await this.verifyWithFirebase(idToken);

    if (decoded.phone_number) {
      const normalised = normalisePhone(decoded.phone_number);
      if (!normalised) {
        // Firebase will happily verify a number from any country; we only issue
        // sessions for Indian mobiles, which is what every stored phone is.
        this.logger.warn('Firebase token carried a phone we cannot store');
        throw ApiError.invalidToken('Only Indian mobile numbers can sign in');
      }
      return { kind: 'phone', phone: normalised };
    }

    /*
     * A Google token. `email_verified` is the part that matters and it is not a formality: an
     * unverified address on a federated token is a claim about an inbox nobody has proved they
     * read, and treating it as an identity would let somebody sign up with a colleague's address
     * and be handed their account.
     */
    if (decoded.email && decoded.email_verified) {
      return { kind: 'email', email: normaliseEmail(decoded.email) };
    }
    if (decoded.email) {
      throw ApiError.invalidToken('That Google account has no verified email address');
    }

    throw ApiError.invalidToken('Firebase token carries neither a phone number nor an email');
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
 * Local development and the e2e suite need a way to sign in without a real SMS, and now without a
 * real Google popup. The token shape is `dev:919876543210` or `dev:someone@example.com`; anything
 * with an `@` is read as the second. Guarded twice: the flag defaults to false and env validation
 * refuses to let it be true in production.
 */
function devBypassIdentity(token: string): VerifiedIdentity | null {
  if (!token.startsWith('dev:')) return null;
  const subject = token.slice('dev:'.length).trim();
  if (subject.includes('@')) return { kind: 'email', email: normaliseEmail(subject) };

  const phone = normalisePhone(subject);
  return phone ? { kind: 'phone', phone } : null;
}

/**
 * Lower case and trimmed, because that is how it is stored.
 *
 * Addresses are compared as whole strings here rather than cleverly: Gmail ignores dots and
 * everything after a `+`, but other providers do not, and normalising on Google's rules would
 * quietly merge two addresses that a different mail server treats as two people.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
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
