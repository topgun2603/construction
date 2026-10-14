import { z } from 'zod';
import { USER_ROLES } from '../enums';
import {
  SECURITY_ABSOLUTE_LIFETIME_RANGE,
  SECURITY_IDLE_TIMEOUT_RANGE,
  SECURITY_IP_MODES,
  SECURITY_MAX_IP_RULES,
  SECURITY_MFA_POLICIES,
  ipNormaliseCidr,
} from '../security';

/**
 * Settings → Security: one body per section, because each section saves on its own and a form
 * that sent all three would overwrite whatever another owner changed in the others meanwhile.
 */

/** `PUT /security/mfa-policy`. */
export const securityMfaPolicySchema = z.object({
  mfa_policy: z.enum(SECURITY_MFA_POLICIES),
  /** Count a sign-in through the company's own identity provider as two-factor. Default on. */
  trust_idp_mfa: z.boolean().default(true),
});
export type SecurityMfaPolicyInput = z.infer<typeof securityMfaPolicySchema>;

/** `PUT /security/session-policy`. Null switches a limit off. */
export const securitySessionPolicySchema = z.object({
  idle_timeout_minutes: z
    .number()
    .int()
    .min(SECURITY_IDLE_TIMEOUT_RANGE.min)
    .max(SECURITY_IDLE_TIMEOUT_RANGE.max)
    .nullable(),
  absolute_lifetime_hours: z
    .number()
    .int()
    .min(SECURITY_ABSOLUTE_LIFETIME_RANGE.min)
    .max(SECURITY_ABSOLUTE_LIFETIME_RANGE.max)
    .nullable(),
});
export type SecuritySessionPolicyInput = z.infer<typeof securitySessionPolicySchema>;

/** One allow-list entry. The block is stored in its canonical form (`192.168.1.0/24`). */
export const securityIpRuleSchema = z.object({
  cidr: z
    .string()
    .max(64)
    .transform((value, ctx) => {
      const cidr = ipNormaliseCidr(value);
      if (!cidr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'expected an address or block like 203.0.113.0/24 or 2001:db8::/48',
        });
        return z.NEVER;
      }
      return cidr;
    }),
  label: z.string().trim().max(80).default(''),
});
export type SecurityIpRuleInput = z.infer<typeof securityIpRuleSchema>;

/** `PUT /security/ip-policy`. */
export const securityIpPolicySchema = z
  .object({
    ip_mode: z.enum(SECURITY_IP_MODES),
    ip_rules: z.array(securityIpRuleSchema).max(SECURITY_MAX_IP_RULES),
    /** Owners are never checked — the break-glass that keeps a wrong list from locking everyone out. */
    ip_exempt_owners: z.boolean().default(true),
    /** Base roles never checked, e.g. site supervisors on mobile data. Owner is covered above. */
    ip_exempt_roles: z.array(z.enum(USER_ROLES)).max(USER_ROLES.length).default([]),
    /**
     * The saver's own address is outside the list and they mean it. Without this the API refuses a
     * list that would shut out the person saving it.
     */
    confirm_self_lockout: z.boolean().default(false),
  })
  .refine((value) => value.ip_mode === 'off' || value.ip_rules.length > 0, {
    message: 'add at least one address or block before turning the allow-list on',
    path: ['ip_rules'],
  });
export type SecurityIpPolicyInput = z.infer<typeof securityIpPolicySchema>;

/** A six-digit authenticator code. */
const mfaCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'enter the 6-digit code'));

/** `POST /auth/mfa/enrol/confirm` — the first code from the app proves it was set up. */
export const mfaConfirmSchema = z.object({ code: mfaCodeSchema });
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

/**
 * `POST /auth/mfa/verify` — an authenticator code, or one of the recovery codes. One field rather
 * than two so the screen can take either in the same box.
 */
export const mfaVerifySchema = z.object({ code: z.string().trim().min(6).max(32) });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
