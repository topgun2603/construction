import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, M365_SCOPES } from '@sitebook/shared';
import { env } from '../../config/env';
import { FieldCipher } from '../../common/crypto/field-cipher';
import { ApiError } from '../../common/errors/api-error';

/**
 * The deployment half of the Microsoft 365 integration: the app registration, Microsoft's hosts and
 * the key the mailbox tokens are encrypted under. Read once per process from `env()`.
 *
 * The hosts are fixed (Microsoft's, or a national cloud's — the env schema refuses anything else in
 * production), so nothing a company types is ever fetched: there is no URL here for SSRF to bend.
 */
@Injectable()
export class M365ConfigService {
  private readonly config = env();
  private cipherInstance: FieldCipher | null = null;

  /** Everything needed to connect: the app registration, its redirect URI and the token key. */
  get configured(): boolean {
    return Boolean(
      this.config.MS_GRAPH_CLIENT_ID &&
        this.config.MS_GRAPH_CLIENT_SECRET &&
        this.config.MS_GRAPH_REDIRECT_URI &&
        this.config.M365_ENCRYPTION_KEY,
    );
  }

  /** Which of the settings are missing, for the settings card to say exactly what to set. */
  get missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.config.MS_GRAPH_CLIENT_ID) missing.push('MS_GRAPH_CLIENT_ID');
    if (!this.config.MS_GRAPH_CLIENT_SECRET) missing.push('MS_GRAPH_CLIENT_SECRET');
    if (!this.config.MS_GRAPH_REDIRECT_URI) missing.push('MS_GRAPH_REDIRECT_URI');
    if (!this.config.M365_ENCRYPTION_KEY) missing.push('M365_ENCRYPTION_KEY');
    return missing;
  }

  get clientId(): string {
    return this.require(this.config.MS_GRAPH_CLIENT_ID);
  }

  get clientSecret(): string {
    return this.require(this.config.MS_GRAPH_CLIENT_SECRET);
  }

  /** Exactly as registered in Entra — sent in the authorize request and again at the code exchange. */
  get redirectUri(): string {
    return this.require(this.config.MS_GRAPH_REDIRECT_URI);
  }

  get scope(): string {
    return M365_SCOPES.join(' ');
  }

  private get authorityBase(): string {
    const login = this.config.MS_GRAPH_LOGIN_URL.replace(/\/+$/, '');
    return `${login}/${encodeURIComponent(this.config.MS_GRAPH_TENANT)}/oauth2/v2.0`;
  }

  get authorizeEndpoint(): string {
    return `${this.authorityBase}/authorize`;
  }

  get tokenEndpoint(): string {
    return `${this.authorityBase}/token`;
  }

  /** `https://graph.microsoft.com/v1.0`, no trailing slash. */
  get graphBase(): string {
    return this.config.MS_GRAPH_API_URL.replace(/\/+$/, '');
  }

  /** The web app, for the links an email carries back to a record. Null when not configured. */
  get webBase(): string | null {
    return this.config.WEB_BASE_URL?.replace(/\/+$/, '') ?? null;
  }

  cipher(): FieldCipher {
    // `configured` already insists on the key; this is the belt to that braces, so no code path can
    // store a token in the clear.
    if (!this.config.M365_ENCRYPTION_KEY) throw notConfigured();
    this.cipherInstance ??= new FieldCipher(this.config.M365_ENCRYPTION_KEY);
    return this.cipherInstance;
  }

  private require(value: string | undefined): string {
    if (!value) throw notConfigured();
    return value;
  }
}

export function notConfigured(): ApiError {
  return new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    ERROR_CODES.CONFLICT,
    'Microsoft 365 is not set up on this server (MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_REDIRECT_URI, M365_ENCRYPTION_KEY).',
  );
}
