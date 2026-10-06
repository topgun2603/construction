import { z } from 'zod';
import { SSO_PRESETS, SSO_PROTOCOLS, ssoNormaliseDomain } from '../sso';
import { uuidSchema } from './common';

/**
 * A browser-held random value that ties the end of a sign-in to the browser that began it. The
 * login page makes one, keeps it in session storage, and sends it at the start and at the finish;
 * a sign-in link carried to another browser cannot be finished there.
 */
const ssoBindingSchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** `POST /auth/sso/start` — a work email in, the identity provider's URL out. */
export const ssoStartSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  binding: ssoBindingSchema,
});
export type SsoStartInput = z.infer<typeof ssoStartSchema>;

/** `POST /auth/sso/complete` — the one-time ticket from the callback, for a token pair. */
export const ssoCompleteSchema = z.object({
  ticket: z.string().min(1).max(4096),
  binding: ssoBindingSchema,
  device_id: z.string().min(1).max(128).optional(),
});
export type SsoCompleteInput = z.infer<typeof ssoCompleteSchema>;

const httpsUrlSchema = z.string().trim().url().max(2048);

/**
 * `PUT /sso/connection` — the company's one connection.
 *
 * Every protocol field is optional so the form can be saved half-filled while the admin is still
 * in the provider's console; the API refuses to *enable* a connection that is incomplete.
 * `oidc_client_secret` is write-only: omitted, the stored one is kept; an empty string clears it.
 */
export const ssoConnectionSchema = z.object({
  protocol: z.enum(SSO_PROTOCOLS),
  preset: z.enum(SSO_PRESETS).default('other'),
  enabled: z.boolean().default(false),

  oidc_issuer: httpsUrlSchema.nullable().optional(),
  oidc_client_id: z.string().trim().max(512).nullable().optional(),
  oidc_client_secret: z.string().max(2048).optional(),
  oidc_scopes: z
    .string()
    .trim()
    .max(512)
    .regex(/^[\w:./-]+( [\w:./-]+)*$/, 'space-separated scopes')
    .optional(),

  saml_idp_entity_id: z.string().trim().max(1024).nullable().optional(),
  saml_idp_sso_url: httpsUrlSchema.nullable().optional(),
  saml_idp_certificate: z.string().trim().max(20_000).nullable().optional(),
  saml_idp_metadata_url: httpsUrlSchema.nullable().optional(),

  jit_enabled: z.boolean().default(false),
  /** The role a person created at first sign-in gets. Never an owner role — the API refuses it. */
  jit_role_id: uuidSchema.nullable().optional(),
  enforce_sso: z.boolean().default(false),
});
export type SsoConnectionInput = z.infer<typeof ssoConnectionSchema>;

/** `POST /sso/saml/metadata` — read an IdP's metadata, from a URL or pasted XML, into the form. */
export const ssoSamlMetadataSchema = z
  .object({
    url: httpsUrlSchema.optional(),
    xml: z.string().max(500_000).optional(),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.xml), {
    message: 'give either a metadata URL or the XML',
  });
export type SsoSamlMetadataInput = z.infer<typeof ssoSamlMetadataSchema>;

/** `POST /sso/domains` — claim an email domain, to be proved by DNS. */
export const ssoDomainSchema = z.object({
  domain: z
    .string()
    .max(300)
    .transform((value, ctx) => {
      const domain = ssoNormaliseDomain(value);
      if (!domain) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected a domain like alnoor.ae' });
        return z.NEVER;
      }
      return domain;
    }),
});
export type SsoDomainInput = z.infer<typeof ssoDomainSchema>;

/** `POST /sso/role-mappings` — people in this provider group get this role. */
export const scimRoleMappingSchema = z.object({
  group_name: z.string().trim().min(1).max(256),
  role_id: uuidSchema,
});
export type ScimRoleMappingInput = z.infer<typeof scimRoleMappingSchema>;
