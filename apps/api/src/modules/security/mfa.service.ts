import { HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  ERROR_CODES,
  MFA_LOCKOUT_MINUTES,
  MFA_MAX_FAILED_ATTEMPTS,
  MFA_RECOVERY_ALPHABET,
  MFA_RECOVERY_CODE_COUNT,
  MFA_SECRET_BYTES,
  mfaBase32Decode,
  mfaBase32Encode,
  mfaFormatRecoveryCode,
  mfaNormaliseRecoveryCode,
  mfaOtpauthUri,
  mfaTotpVerify,
  securityMfaRequired,
  ssoIsPlaceholderPhone,
} from '@sitebook/shared';
import { env } from '../../config/env';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { SecurityAuditService } from './security-audit.service';
import type { MfaMethod } from './session.service';

/**
 * Our own second factor: an authenticator app (TOTP, RFC 6238) plus single-use recovery codes.
 *
 * WHY OUR OWN, BESIDE FIREBASE'S. Firebase can put an authenticator on an email-and-password
 * sign-in, and when it does the ID token says so (`firebase.sign_in_second_factor`) and the
 * exchange honours it. But most people here sign in by phone OTP, and Firebase refuses a second
 * factor on a phone sign-in — so a company that requires two-factor of everybody needs one that
 * works whatever the first factor was. This is it, and it is held per session: the factor is shown
 * once after sign-in and recorded on the `user_sessions` row for the rest of that session.
 *
 * A PHONE OTP IS ONE FACTOR. It proves possession of the SIM, which is exactly what a SIM swap
 * steals; an authenticator on the same phone is a second, separate secret. So "required" means a
 * phone user enrols an authenticator too.
 *
 * Secrets are encrypted at rest (FieldCipher under MFA_ENCRYPTION_KEY); recovery codes are stored
 * as keyed hashes. Wrong codes count against the factor, and five in a row stop it taking codes for
 * fifteen minutes — on top of the route's own rate limit.
 */
@Injectable()
export class MfaService {
  private readonly config = env();
  private cipherInstance: FieldCipher | null = null;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
    private readonly audit: SecurityAuditService,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.MFA_ENCRYPTION_KEY);
  }

  private cipher(): FieldCipher {
    if (!this.config.MFA_ENCRYPTION_KEY) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.CONFLICT,
        'Authenticator apps are not set up on this deployment (MFA_ENCRYPTION_KEY).',
      );
    }
    this.cipherInstance ??= new FieldCipher(this.config.MFA_ENCRYPTION_KEY);
    return this.cipherInstance;
  }

  /**
   * Recovery codes are stored as HMAC-SHA256 under the deployment key rather than a bare hash: a
   * code has about fifty bits in it, few enough that a stolen table alone could be ground through.
   * With the key held outside the database, the table is useless on its own.
   */
  private hashRecoveryCode(normalised: string): string {
    return createHmac('sha256', this.config.MFA_ENCRYPTION_KEY ?? '')
      .update(`mfa-recovery:${normalised}`)
      .digest('hex');
  }

  /** `GET /auth/mfa` — what the two-factor screens need to know about this person and session. */
  async status(actor: RequestUser) {
    const gate = (await this.tenantCache.get(actor.tenantId))?.security ?? null;
    const data = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [factor, codesLeft, user, tenant] = await Promise.all([
        tx.mfaFactor.findUnique({
          where: { userId: actor.userId },
          select: { confirmedAt: true, lockedUntil: true },
        }),
        tx.mfaRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } }),
        tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } }),
        tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } }),
      ]);
      return { factor, codesLeft, user, tenant };
    });
    const locked = data.factor?.lockedUntil && data.factor.lockedUntil > new Date() ? data.factor.lockedUntil : null;
    return {
      required: gate ? securityMfaRequired(gate.mfaPolicy, actor) : false,
      enrolled: Boolean(data.factor?.confirmedAt),
      session_verified: actor.mfa === true,
      recovery_codes_left: data.factor?.confirmedAt ? data.codesLeft : 0,
      locked_until: locked?.toISOString() ?? null,
      configured: this.configured,
      user_name: data.user?.name ?? '',
      company_name: data.tenant?.name ?? '',
    };
  }

  /**
   * `POST /auth/mfa/enrol` — a new secret, shown once as a QR code. Saved unconfirmed: it counts
   * for nothing until a code from it comes back.
   *
   * Somebody without an authenticator yet may enrol on the strength of their sign-in alone — that
   * is how anybody ever gets one. Somebody who has one must remove it first, from a session that
   * has shown it; otherwise a stolen phone OTP could swap the authenticator for the thief's.
   */
  async beginEnrol(actor: RequestUser) {
    const cipher = this.cipher();
    const secret = mfaBase32Encode(randomBytes(MFA_SECRET_BYTES));

    const account = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.mfaFactor.findUnique({
        where: { userId: actor.userId },
        select: { confirmedAt: true },
      });
      if (existing?.confirmedAt) {
        throw ApiError.conflict(
          actor.mfa
            ? 'You already have an authenticator app. Remove it first to set up a different one.'
            : 'You already have an authenticator app. Enter a code from it to continue.',
        );
      }
      await tx.mfaFactor.upsert({
        where: { userId: actor.userId },
        create: { tenantId: actor.tenantId, userId: actor.userId, secretCipher: cipher.encrypt(secret) },
        update: {
          secretCipher: cipher.encrypt(secret),
          confirmedAt: null,
          lastUsedStep: null,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      const [user, tenant] = await Promise.all([
        tx.user.findFirst({ where: { id: actor.userId }, select: { phone: true, email: true, name: true } }),
        tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } }),
      ]);
      // What the authenticator lists the entry as: the number they sign in with, or their email
      // when the account was made by single sign-on and has no real number.
      const label =
        user && !ssoIsPlaceholderPhone(user.phone) ? `+${user.phone}` : (user?.email ?? user?.name ?? 'BUILDR');
      return { label, company: tenant?.name ?? 'BUILDR' };
    });

    return {
      secret,
      otpauth_uri: mfaOtpauthUri({ secret, account: account.label, company: account.company }),
    };
  }

  /**
   * `POST /auth/mfa/enrol/confirm` — the first code proves the app holds the secret. Confirms the
   * factor, makes the recovery codes (shown this once), and counts as this session's second factor.
   */
  async confirmEnrol(actor: RequestUser, code: string): Promise<{ recovery_codes: string[] }> {
    const cipher = this.cipher();
    const factor = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.mfaFactor.findUnique({
        where: { userId: actor.userId },
        select: { id: true, secretCipher: true, confirmedAt: true, lockedUntil: true },
      }),
    );
    if (!factor || factor.confirmedAt) {
      throw ApiError.conflict('Start setting up the authenticator again.');
    }
    assertNotLocked(factor.lockedUntil);

    const secret = mfaBase32Decode(cipher.decrypt(factor.secretCipher));
    const step = secret ? mfaTotpVerify(secret, code, Date.now()) : null;
    if (step === null) {
      await this.recordFailure(actor, factor.id, 'enrol');
      throw wrongCode();
    }

    const codes = this.newRecoveryCodes();
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const confirmed = await tx.mfaFactor.updateMany({
        where: { id: factor.id, confirmedAt: null },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null },
      });
      if (confirmed.count !== 1) throw ApiError.conflict('Start setting up the authenticator again.');
      await this.replaceRecoveryCodes(tx, actor, codes);
      await this.markSession(tx, actor, 'totp');
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'mfa.enrolled',
          entity: 'mfa_factors',
          entityId: factor.id,
          after: { method: 'totp', recovery_codes: codes.length },
        },
      });
    });
    return { recovery_codes: codes };
  }

  /**
   * `POST /auth/mfa/verify` — an authenticator code or a recovery code, for this session.
   *
   * Both are claimed atomically: the TOTP step only moves forward (so the same code cannot be used
   * twice, even by two requests racing), and a recovery code is spent by the update that matches
   * it unspent. Returns how the factor was shown.
   */
  async verify(actor: RequestUser, code: string): Promise<{ method: MfaMethod; recovery_codes_left: number }> {
    if (!actor.sessionId) throw ApiError.forbidden('Sign out and sign in again to continue.');
    const cipher = this.cipher();
    const factor = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.mfaFactor.findUnique({
        where: { userId: actor.userId },
        select: { id: true, secretCipher: true, confirmedAt: true, lockedUntil: true, lastUsedStep: true },
      }),
    );
    if (!factor?.confirmedAt) {
      throw ApiError.conflict('Set up an authenticator app first.', { reason: 'not_enrolled' });
    }
    assertNotLocked(factor.lockedUntil);

    const recovery = mfaNormaliseRecoveryCode(code);
    let method: MfaMethod | null = null;

    if (recovery) {
      const spent = await this.tenantDb.transaction(actor.tenantId, (tx) =>
        tx.mfaRecoveryCode.updateMany({
          where: { userId: actor.userId, codeHash: this.hashRecoveryCode(recovery), usedAt: null },
          data: { usedAt: new Date() },
        }),
      );
      if (spent.count === 1) method = 'recovery_code';
    } else {
      const secret = mfaBase32Decode(cipher.decrypt(factor.secretCipher));
      const step = secret
        ? mfaTotpVerify(secret, code, Date.now(), {
            afterStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
          })
        : null;
      if (step !== null) {
        const claimed = await this.tenantDb.transaction(actor.tenantId, (tx) =>
          tx.mfaFactor.updateMany({
            where: {
              id: factor.id,
              OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
            },
            data: { lastUsedStep: BigInt(step) },
          }),
        );
        if (claimed.count === 1) method = 'totp';
      }
    }

    if (!method) {
      await this.recordFailure(actor, factor.id, 'verify');
      throw wrongCode();
    }

    const left = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await this.markSession(tx, actor, method as MfaMethod);
      const remaining = await tx.mfaRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'mfa.verified',
          entity: 'user_sessions',
          entityId: actor.sessionId,
          after: { method, recovery_codes_left: remaining },
        },
      });
      return remaining;
    });
    return { method, recovery_codes_left: left };
  }

  /** `POST /auth/mfa/recovery-codes` — a fresh set; every earlier code stops working. */
  async regenerateRecoveryCodes(actor: RequestUser): Promise<{ recovery_codes: string[] }> {
    this.cipher();
    if (!actor.mfa) throw ApiError.mfaRequired();
    const codes = this.newRecoveryCodes();
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const factor = await tx.mfaFactor.findUnique({
        where: { userId: actor.userId },
        select: { id: true, confirmedAt: true },
      });
      if (!factor?.confirmedAt) throw ApiError.conflict('Set up an authenticator app first.');
      await this.replaceRecoveryCodes(tx, actor, codes);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'mfa.recovery_codes_regenerated',
          entity: 'mfa_factors',
          entityId: factor.id,
          after: { recovery_codes: codes.length },
        },
      });
    });
    return { recovery_codes: codes };
  }

  /**
   * `DELETE /auth/mfa` — remove my authenticator, from a session that has shown it.
   *
   * Every one of my sessions loses its second factor with it (at its next refresh, within the
   * access token's fifteen minutes). Where the company requires two-factor that sends me straight
   * back to set one up — which is exactly how "use a different phone" works.
   */
  async remove(actor: RequestUser): Promise<void> {
    if (!actor.mfa) throw ApiError.mfaRequired();
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const factor = await tx.mfaFactor.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!factor) throw ApiError.notFound('Authenticator');
      await this.wipe(tx, actor.userId);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'mfa.removed',
          entity: 'mfa_factors',
          entityId: factor.id,
        },
      });
    });
  }

  /**
   * Removes a person's authenticator and recovery codes and takes the second factor off their
   * sessions. Shared by removing your own and by the platform console's reset.
   */
  async wipe(tx: TenantTx, userId: string): Promise<void> {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaFactor.deleteMany({ where: { userId } });
    await tx.userSession.updateMany({
      where: { userId, mfaAt: { not: null } },
      data: { mfaAt: null, mfaMethod: null },
    });
  }

  private async markSession(tx: TenantTx, actor: RequestUser, method: MfaMethod): Promise<void> {
    if (!actor.sessionId) return;
    await tx.userSession.updateMany({
      where: { id: actor.sessionId, userId: actor.userId, revokedAt: null },
      data: { mfaAt: new Date(), mfaMethod: method },
    });
  }

  private newRecoveryCodes(): string[] {
    const codes = new Set<string>();
    while (codes.size < MFA_RECOVERY_CODE_COUNT) {
      let raw = '';
      for (let i = 0; i < 10; i++) raw += MFA_RECOVERY_ALPHABET[randomInt(MFA_RECOVERY_ALPHABET.length)];
      codes.add(mfaFormatRecoveryCode(raw));
    }
    return [...codes];
  }

  private async replaceRecoveryCodes(tx: TenantTx, actor: RequestUser, codes: string[]): Promise<void> {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        tenantId: actor.tenantId,
        userId: actor.userId,
        codeHash: this.hashRecoveryCode(mfaNormaliseRecoveryCode(code) as string),
      })),
    });
  }

  /**
   * One more wrong code, committed on its own so the refusal that follows cannot roll it back. The
   * fifth in a row locks the factor for fifteen minutes and starts the count again.
   */
  private async recordFailure(actor: RequestUser, factorId: string, stage: 'enrol' | 'verify'): Promise<void> {
    const outcome = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const bumped = await tx.mfaFactor.update({
        where: { id: factorId },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      if (bumped.failedAttempts < MFA_MAX_FAILED_ATTEMPTS) return { locked: false, attempts: bumped.failedAttempts };
      await tx.mfaFactor.update({
        where: { id: factorId },
        data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + MFA_LOCKOUT_MINUTES * 60_000) },
      });
      return { locked: true, attempts: bumped.failedAttempts };
    });
    await this.audit.record(actor.tenantId, {
      actorId: actor.userId,
      action: outcome.locked ? 'mfa.locked' : 'mfa.verify_failed',
      entity: 'mfa_factors',
      entityId: factorId,
      after: { stage, attempts: outcome.attempts },
    });
  }
}

function assertNotLocked(lockedUntil: Date | null): void {
  if (lockedUntil && lockedUntil > new Date()) {
    throw ApiError.rateLimited(
      `Too many wrong codes. Wait ${MFA_LOCKOUT_MINUTES} minutes and try again.`,
      { locked_until: lockedUntil.toISOString() },
    );
  }
}

function wrongCode(): ApiError {
  return ApiError.validationFailed({ code: 'not right' }, 'That code is not right. Check the app and try again.');
}
