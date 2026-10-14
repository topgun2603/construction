import { describe, expect, it } from 'vitest';
import {
  dataExportIsSecretColumn,
  dataExportNextAllowedAt,
  DATA_EXPORT_COOLDOWN_HOURS,
  DELETION_GRACE_DAYS,
  deletionPurgeAfter,
  deletionReauthFresh,
} from './data-portability';
import { deletionRequestSchema, dataExportAnonymiseSchema } from './schemas/data-portability';
import { updateTenantPlatformSchema } from './schemas/platform';

describe('export secret columns', () => {
  it('leaves out what the audit log redacts', () => {
    for (const column of [
      'token_hash',
      'fcm_tokens',
      'number_cipher',
      'secret_cipher',
      'oidc_client_secret_cipher',
      'verification_token',
      'password',
      'totp_secret',
      'otp',
      'code_hash',
      'api_key',
    ]) {
      expect(dataExportIsSecretColumn(column)).toBe(true);
    }
  });

  it('keeps ordinary columns, including ones that merely contain the letters', () => {
    for (const column of ['name', 'phone', 'number_hint', 'hotpot', 'tenant_id', 's3_key', 'notes']) {
      expect(dataExportIsSecretColumn(column)).toBe(false);
    }
  });
});

describe('deletion timing', () => {
  it('purges thirty days after the request', () => {
    const asked = new Date('2026-10-01T10:00:00Z');
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(deletionPurgeAfter(asked).toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });

  it('needs a sign-in within the last ten minutes', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(deletionReauthFresh(new Date('2026-10-01T09:55:00Z'), now)).toBe(true);
    expect(deletionReauthFresh(new Date('2026-10-01T09:49:00Z'), now)).toBe(false);
  });

  it('allows the next export a day later', () => {
    const asked = new Date('2026-10-01T10:00:00Z');
    expect(dataExportNextAllowedAt(asked).getTime() - asked.getTime()).toBe(
      DATA_EXPORT_COOLDOWN_HOURS * 3_600_000,
    );
  });
});

describe('schemas', () => {
  it('trims the typed company name', () => {
    expect(deletionRequestSchema.parse({ confirm_name: '  ARK  ' }).confirm_name).toBe('ARK');
    expect(deletionRequestSchema.safeParse({ confirm_name: '   ' }).success).toBe(false);
  });

  it('wants the anonymise confirmation spelled out', () => {
    expect(dataExportAnonymiseSchema.safeParse({ confirm: 'ANONYMISE' }).success).toBe(true);
    expect(dataExportAnonymiseSchema.safeParse({ confirm: 'yes' }).success).toBe(false);
  });

  it('never lets the console set pending_deletion directly', () => {
    expect(updateTenantPlatformSchema.safeParse({ status: 'pending_deletion' }).success).toBe(false);
    expect(updateTenantPlatformSchema.safeParse({ status: 'suspended' }).success).toBe(true);
  });
});
