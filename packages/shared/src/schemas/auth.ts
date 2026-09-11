import { z } from 'zod';
import { USER_ROLES } from '../enums';
import { phoneSchema, uuidSchema } from './common';

/** `POST /auth/exchange` — Firebase ID token in, app JWT pair out (spec §6.2). */
export const authExchangeSchema = z.object({
  firebase_token: z.string().min(1),
  device_id: z.string().min(1).max(128).optional(),
});
export type AuthExchangeInput = z.infer<typeof authExchangeSchema>;

export const authRefreshSchema = z.object({
  refresh_token: z.string().min(1),
  device_id: z.string().min(1).max(128).optional(),
});
export type AuthRefreshInput = z.infer<typeof authRefreshSchema>;

/** Returned when the phone is not attached to any tenant yet. */
export const onboardingRequiredSchema = z.object({
  onboarding_required: z.literal(true),
  onboarding_token: z.string().min(1),
  phone: z.string(),
});

export const tokenPairSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

/** Decoded app JWT payload. `project_ids` is empty for owner/accounts (all projects). */
export interface AppJwtClaims {
  sub: string;
  tenant_id: string;
  role: (typeof USER_ROLES)[number];
  project_ids: string[];
  iat: number;
  exp: number;
}

export const inviteUserSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1).max(120),
  role: z.enum(USER_ROLES),
  project_ids: z.array(uuidSchema).max(200).default([]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
