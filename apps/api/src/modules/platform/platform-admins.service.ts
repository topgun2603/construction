import { Injectable, Logger } from '@nestjs/common';
import { toE164Indian } from '@sitebook/shared';
import { normaliseEmail } from '../auth/phone-auth.service';

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
 *
 * ## The format
 *
 * `PLATFORM_ADMIN_PHONES` is a comma-separated list where each entry is a mobile number,
 * optionally followed by `=` and a Google address that signs in as that same person:
 *
 *     PLATFORM_ADMIN_PHONES=917538891944=someone@gmail.com,919812345678
 *
 * One entry is one person, which is the whole reason the address lives here rather than in
 * a second `PLATFORM_ADMIN_EMAILS` variable. Two parallel lists would have to be kept in
 * the same order to mean anything, and the day they drifted the console would hand one
 * operator's session to another operator's address — a failure nobody would see until they
 * read the audit trail and found the wrong name on it.
 *
 * The number is still the identity. An address is resolved to its number before a session
 * is issued, so the token carries the number, `platform_audit_log.actor_phone` keeps
 * meaning what it has always meant, and signing in by SMS or by Google is the same person
 * in the trail rather than two.
 */
@Injectable()
export class PlatformAdmins {
  private readonly logger = new Logger(PlatformAdmins.name);

  /**
   * The root operators: normalised phone to linked address, or null where there is none.
   * Empty means the console is closed.
   */
  private get allowed(): Map<string, string | null> {
    const raw = process.env['PLATFORM_ADMIN_PHONES'] ?? '';
    const roots = new Map<string, string | null>();

    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      // `split` with a limit would drop anything after a second `=`; indexOf keeps the rest
      // so a malformed address is rejected below rather than silently truncated into a
      // valid-looking one.
      const divider = trimmed.indexOf('=');
      const rawPhone = divider === -1 ? trimmed : trimmed.slice(0, divider);
      const rawEmail = divider === -1 ? '' : trimmed.slice(divider + 1).trim();

      const phone = toE164Indian(rawPhone);
      if (!phone) {
        // Warn rather than throw: one typo in the list must not take the API down, but
        // it must not silently shrink the allowlist without saying so either.
        this.logger.warn('PLATFORM_ADMIN_PHONES contains an entry that is not a mobile number');
        continue;
      }

      if (rawEmail === '') {
        roots.set(phone, null);
        continue;
      }

      // Deliberately shallow: an `@` with something either side. Anything stricter would
      // reject a legitimate address somebody actually owns, and the address is only ever
      // compared against what Firebase says a verified account is — this cannot admit
      // anybody, only fail to admit somebody.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        this.logger.warn(
          'PLATFORM_ADMIN_PHONES has an entry whose address is not an email; the number still works',
        );
        roots.set(phone, null);
        continue;
      }

      roots.set(phone, normaliseEmail(rawEmail));
    }

    return roots;
  }

  get configured(): boolean {
    return this.allowed.size > 0;
  }

  /// The root numbers, for showing an operator list that does not pretend they are absent.
  get phones(): string[] {
    return [...this.allowed.keys()];
  }

  /** `phone` must already be in stored form (`91XXXXXXXXXX`). */
  allows(phone: string): boolean {
    return this.allowed.has(phone);
  }

  /** The Google address configured for a root operator, or null where none is. */
  emailFor(phone: string): string | null {
    return this.allowed.get(phone) ?? null;
  }

  /**
   * The root operator who signs in with this address, or null if nobody does.
   *
   * Resolves to a *phone*, because that is the console's identity. Compared case-folded,
   * since the address arrives from Firebase in whatever case the person typed it.
   */
  phoneForEmail(email: string): string | null {
    const wanted = normaliseEmail(email);
    for (const [phone, linked] of this.allowed) {
      if (linked !== null && linked === wanted) return phone;
    }
    return null;
  }
}
