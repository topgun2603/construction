import { Injectable, Logger } from '@nestjs/common';
import { toE164Indian } from '@sitebook/shared';

/**
 * Who may use the platform console.
 *
 * The list is env, not a table, and that is the point: the console can change a
 * tenant's plan and suspend accounts, so the set of people allowed to do that must not
 * be editable from inside the console itself. Adding an operator is a deploy, which
 * leaves a record somewhere the application cannot rewrite.
 *
 * It is re-read on every check rather than captured at boot, so removing someone takes
 * effect on their very next request instead of waiting out an 8-hour token.
 *
 * That is also why this reads `process.env` directly instead of the validated `env()`
 * helper: `env()` parses once and caches the whole object for the life of the process,
 * which is right for everything else and wrong here — a cached allowlist cannot be
 * revoked. The shape is validated on each read instead, which is cheap for a handful of
 * numbers.
 */
@Injectable()
export class PlatformAdmins {
  private readonly logger = new Logger(PlatformAdmins.name);

  /** Normalised phones allowed in. Empty means the console is closed. */
  private get allowed(): Set<string> {
    const raw = process.env['PLATFORM_ADMIN_PHONES'] ?? '';
    const phones = new Set<string>();
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const normalised = toE164Indian(trimmed);
      if (!normalised) {
        // Warn rather than throw: one typo in the list must not take the API down, but
        // it must not silently shrink the allowlist without saying so either.
        this.logger.warn(`PLATFORM_ADMIN_PHONES contains an entry that is not a mobile number`);
        continue;
      }
      phones.add(normalised);
    }
    return phones;
  }

  get configured(): boolean {
    return this.allowed.size > 0;
  }

  /** `phone` must already be in stored form (`91XXXXXXXXXX`). */
  allows(phone: string): boolean {
    return this.allowed.has(phone);
  }
}
