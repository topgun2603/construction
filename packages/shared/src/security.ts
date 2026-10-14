/**
 * Enforced two-factor, session timeouts and IP allow-lists per company (roadmap Phase 3, item 2).
 *
 * Pure helpers shared by the API (which enforces) and the web app (which explains): IP and CIDR
 * parsing and matching for IPv4 and IPv6, RFC 6238 TOTP, and the session-timeout arithmetic.
 *
 * No dependencies and no `node:crypto`. This module is imported by the browser bundle too, so the
 * HMAC-SHA1 TOTP needs is written out below (it is short, and tested against the RFC's vectors).
 * Anything that needs real randomness — a new TOTP secret, recovery codes — is made in the API.
 *
 * Everything is named `security…` / `mfa…` / `ip…` so it cannot collide with the modules beside it.
 */

// ---------------------------------------------------------------------------------------------
// The company's policy, as the settings screen and the API both read it
// ---------------------------------------------------------------------------------------------

/**
 * Who must use a second factor.
 *
 * `admins` is anybody holding `tenant.manage` — the owner, and any custom role it was handed to —
 * because that is who can change who gets in. `everyone` is every session, web and mobile app
 * alike: the API cannot tell a browser from the app in a way an attacker could not fake, so a
 * "web only" rule would be a rule a stolen phone OTP walks straight around.
 */
export const SECURITY_MFA_POLICIES = ['off', 'admins', 'everyone'] as const;
export type SecurityMfaPolicy = (typeof SECURITY_MFA_POLICIES)[number];

/**
 * Where the IP allow-list applies.
 *
 * `web` leaves sessions that began in the mobile app alone, because site staff are on mobile data
 * whose address changes every few minutes. It keeps the office screens on the office network; it
 * is not a hard wall — see `securityIpApplies`.
 */
export const SECURITY_IP_MODES = ['off', 'web', 'everyone'] as const;
export type SecurityIpMode = (typeof SECURITY_IP_MODES)[number];

/** The choices the settings screen offers. The API accepts anything inside the range. */
export const SECURITY_IDLE_TIMEOUT_MINUTES = [30, 60, 120, 240, 480, 720, 1440] as const;
export const SECURITY_IDLE_TIMEOUT_RANGE = { min: 30, max: 24 * 60 } as const;

/** Absolute lifetime choices, in hours: a working day up to thirty days (the refresh token's own). */
export const SECURITY_ABSOLUTE_LIFETIME_HOURS = [8, 12, 24, 72, 168, 336, 720] as const;
export const SECURITY_ABSOLUTE_LIFETIME_RANGE = { min: 8, max: 30 * 24 } as const;

/** More than any office has; enough to stop the list being used to store something else. */
export const SECURITY_MAX_IP_RULES = 100;

/**
 * Must this person use a second factor in this company?
 *
 * By permission, not role name, so a custom "Office manager" role given `tenant.manage` is held to
 * the same rule as an owner.
 */
export function securityMfaRequired(
  policy: SecurityMfaPolicy,
  person: { permissions: readonly string[] },
): boolean {
  if (policy === 'everyone') return true;
  if (policy === 'admins') return person.permissions.includes('tenant.manage');
  return false;
}

/**
 * Is this session subject to the IP allow-list at all?
 *
 * Owners are exempt by default — the break-glass that keeps a mistyped list from locking out the
 * one person who can fix it. Exempt roles are base roles (`site_supervisor`), so a custom role
 * built on one is exempt with it. `app` is a session that began in the mobile app.
 */
export function securityIpApplies(
  rule: { mode: SecurityIpMode; exemptOwners: boolean; exemptRoles: readonly string[] },
  session: { role: string; app: boolean },
): boolean {
  if (rule.mode === 'off') return false;
  if (rule.mode === 'web' && session.app) return false;
  if (rule.exemptOwners && session.role === 'owner') return false;
  return !rule.exemptRoles.includes(session.role);
}

// ---------------------------------------------------------------------------------------------
// Session timeouts
// ---------------------------------------------------------------------------------------------

export interface SecuritySessionTimes {
  startedAt: Date;
  lastActiveAt: Date;
  now: Date;
  /** Null for no idle timeout. */
  idleMinutes: number | null;
  /** Null for no lifetime beyond the refresh token's own. */
  absoluteHours: number | null;
}

/**
 * Has a session outlived the company's rules? The absolute limit wins when both have passed, since
 * that is the one no amount of activity could have prevented.
 */
export function securitySessionVerdict(times: SecuritySessionTimes): 'active' | 'idle' | 'expired' {
  const now = times.now.getTime();
  if (times.absoluteHours !== null) {
    if (now - times.startedAt.getTime() >= times.absoluteHours * 3_600_000) return 'expired';
  }
  if (times.idleMinutes !== null) {
    if (now - times.lastActiveAt.getTime() >= times.idleMinutes * 60_000) return 'idle';
  }
  return 'active';
}

/**
 * When the absolute lifetime ends, or null without one. Access tokens are cut to it so a session
 * cannot outlive its limit by an access token's fifteen minutes.
 */
export function securityAbsoluteDeadline(startedAt: Date, absoluteHours: number | null): Date | null {
  return absoluteHours === null ? null : new Date(startedAt.getTime() + absoluteHours * 3_600_000);
}

// ---------------------------------------------------------------------------------------------
// IP addresses and CIDR blocks
// ---------------------------------------------------------------------------------------------

/** A parsed address: 4 bytes for IPv4, 16 for IPv6. */
export interface IpAddress {
  version: 4 | 6;
  bytes: Uint8Array;
}

export interface IpCidr {
  address: IpAddress;
  prefix: number;
}

/**
 * Parses an IPv4 or IPv6 address. Null for anything else.
 *
 * Strict on purpose. IPv4 parts with leading zeros are refused, because `010.0.0.1` means 8.0.0.1
 * to some parsers and 10.0.0.1 to others, and an allow-list must not mean two things. An IPv6 zone
 * (`%eth0`) and URL brackets are dropped. An IPv4-mapped IPv6 address (`::ffff:10.0.0.1`, how Node
 * reports an IPv4 client on a dual-stack socket) is returned as the IPv4 address it carries.
 */
export function ipParse(input: string): IpAddress | null {
  let text = input.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (text.length === 0 || text.length > 45) return null;

  if (!text.includes(':')) {
    const bytes = parseIpv4(text);
    return bytes ? { version: 4, bytes } : null;
  }
  const bytes = parseIpv6(text);
  if (!bytes) return null;
  if (isIpv4Mapped(bytes)) return { version: 4, bytes: bytes.slice(12) };
  return { version: 6, bytes };
}

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i] as string;
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function parseIpv6(text: string): Uint8Array | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;

  const groupsOf = (half: string): number[] | null => {
    if (half === '') return [];
    const out: number[] = [];
    const pieces = half.split(':');
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] as string;
      // The last piece may be a dotted IPv4 tail (`::ffff:10.0.0.1`, `64:ff9b::1.2.3.4`).
      if (i === pieces.length - 1 && piece.includes('.')) {
        const v4 = parseIpv4(piece);
        if (!v4) return null;
        out.push(((v4[0] as number) << 8) | (v4[1] as number), ((v4[2] as number) << 8) | (v4[3] as number));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = groupsOf(halves[0] as string);
  const tail = halves.length === 2 ? groupsOf(halves[1] as string) : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    // `::` stands for at least one group of zeros.
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/** The canonical text form: dotted IPv4, or RFC 5952 compressed lower-case IPv6. */
export function ipFormat(address: IpAddress): string {
  if (address.version === 4) return Array.from(address.bytes).join('.');

  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((address.bytes[i] as number) << 8) | (address.bytes[i + 1] as number));
  }
  // The longest run of two or more zero groups becomes `::` (the first, on a tie).
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/**
 * Parses `10.0.0.0/8`, `2001:db8::/32`, or a bare address (a single host: /32 or /128).
 *
 * Host bits are cleared, so `192.168.1.77/24` reads as `192.168.1.0/24` — what the admin meant —
 * and the settings screen shows the block it saved. Null for anything unparseable or a prefix out
 * of range.
 */
export function ipCidrParse(input: string): IpCidr | null {
  const text = input.trim();
  const slash = text.indexOf('/');
  const address = ipParse(slash >= 0 ? text.slice(0, slash) : text);
  if (!address) return null;
  const max = address.version === 4 ? 32 : 128;

  let prefix = max;
  if (slash >= 0) {
    const raw = text.slice(slash + 1);
    if (!/^\d{1,3}$/.test(raw)) return null;
    prefix = Number(raw);
    // A mapped address written with an IPv6 prefix (`::ffff:10.0.0.0/104`) is an IPv4 block.
    if (address.version === 4 && text.slice(0, slash).includes(':')) {
      if (prefix < 96 || prefix > 128) return null;
      prefix -= 96;
    }
    if (prefix > max) return null;
  }

  const bytes = address.bytes.slice();
  for (let bit = prefix; bit < max; bit++) {
    const index = bit >> 3;
    bytes[index] = (bytes[index] as number) & ~(0x80 >> (bit & 7));
  }
  return { address: { version: address.version, bytes }, prefix };
}

export function ipCidrFormat(cidr: IpCidr): string {
  return `${ipFormat(cidr.address)}/${cidr.prefix}`;
}

/** The canonical form of what an admin typed, or null when it is not a block. */
export function ipNormaliseCidr(input: string): string | null {
  const cidr = ipCidrParse(input);
  return cidr ? ipCidrFormat(cidr) : null;
}

/** Is `address` inside `cidr`? Never across versions — an IPv4 rule says nothing about IPv6. */
export function ipInCidr(address: IpAddress, cidr: IpCidr): boolean {
  if (address.version !== cidr.address.version) return false;
  const whole = cidr.prefix >> 3;
  for (let i = 0; i < whole; i++) {
    if (address.bytes[i] !== cidr.address.bytes[i]) return false;
  }
  const rest = cidr.prefix & 7;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((address.bytes[whole] as number) & mask) === ((cidr.address.bytes[whole] as number) & mask);
}

/**
 * Is this address on the list? An address that does not parse is never allowed: the caller gets a
 * refusal rather than the benefit of the doubt.
 */
export function ipAllowed(address: string, cidrs: readonly string[]): boolean {
  const parsed = ipParse(address);
  if (!parsed) return false;
  return cidrs.some((text) => {
    const cidr = ipCidrParse(text);
    return cidr !== null && ipInCidr(parsed, cidr);
  });
}

// ---------------------------------------------------------------------------------------------
// TOTP (RFC 6238 over RFC 4226 HOTP, HMAC-SHA1)
// ---------------------------------------------------------------------------------------------

export const MFA_TOTP_PERIOD_SECONDS = 30;
export const MFA_TOTP_DIGITS = 6;
/** One step either side: a phone clock thirty seconds out still works, ninety does not. */
export const MFA_TOTP_WINDOW = 1;
/** 20 bytes = 160 bits, the size RFC 4226 recommends for an HMAC-SHA1 key. */
export const MFA_SECRET_BYTES = 20;
export const MFA_RECOVERY_CODE_COUNT = 10;
/** Wrong codes in a row before the account stops taking codes for a while. */
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_MINUTES = 15;
/** What authenticator apps show above the code. */
export const MFA_ISSUER = 'BUILDR';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding — what authenticator apps expect a secret in. */
export function mfaBase32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive; spaces, hyphens and padding ignored (people copy secrets in groups). Null if invalid. */
export function mfaBase32Decode(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** SHA-1 (FIPS 180-4). Only ever used inside HMAC for TOTP, where it remains sound. */
function sha1(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6));
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // Bit length as a 64-bit big-endian integer; messages here are far below 2^32 bits.
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number);
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = 64;
  const k = key.length > block ? sha1(key) : key;
  const inner = new Uint8Array(block + message.length);
  const outer = new Uint8Array(block + 20);
  for (let i = 0; i < block; i++) {
    const byte = (k[i] as number | undefined) ?? 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  inner.set(message, block);
  outer.set(sha1(inner), block);
  return sha1(outer);
}

/** The time step a moment falls in. */
export function mfaTotpStep(nowMs: number, period = MFA_TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

/** The HOTP code for one counter value (RFC 4226 §5.3, dynamic truncation). */
export function mfaHotp(secret: Uint8Array, counter: number, digits = MFA_TOTP_DIGITS): string {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = hmacSha1(secret, message);
  const offset = (mac[19] as number) & 0x0f;
  const binary =
    (((mac[offset] as number) & 0x7f) << 24) |
    ((mac[offset + 1] as number) << 16) |
    ((mac[offset + 2] as number) << 8) |
    (mac[offset + 3] as number);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code an authenticator shows at `nowMs`. */
export function mfaTotp(secret: Uint8Array, nowMs: number, digits = MFA_TOTP_DIGITS): string {
  return mfaHotp(secret, mfaTotpStep(nowMs), digits);
}

/**
 * Checks a typed code against the steps around now, and returns the step it matched (to be stored,
 * so the same code cannot be used twice) or null.
 *
 * `afterStep` is the last step already accepted: a code from that step or earlier is refused even
 * if it is still inside the window — otherwise somebody reading it over a shoulder could replay it
 * in the next minute. Every candidate is computed and compared without an early exit, so how long
 * a refusal takes says nothing about which step was close.
 */
export function mfaTotpVerify(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  options: { window?: number; afterStep?: number | null; digits?: number } = {},
): number | null {
  const digits = options.digits ?? MFA_TOTP_DIGITS;
  const typed = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(typed)) return null;
  const window = options.window ?? MFA_TOTP_WINDOW;
  const current = mfaTotpStep(nowMs);

  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    if (options.afterStep !== undefined && options.afterStep !== null && step <= options.afterStep) continue;
    if (constantTimeEqual(mfaHotp(secret, step, digits), typed) && matched === null) matched = step;
  }
  return matched;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The `otpauth://` URI an authenticator app reads from the QR code (the Google Authenticator key
 * URI format, which every authenticator follows). The label names the company as well as the
 * person, because somebody in two companies has two entries and must be able to tell them apart.
 */
export function mfaOtpauthUri(input: { secret: string; account: string; company: string }): string {
  // Plain ASCII and no colon: some authenticators split the label on `:` and mangle anything else.
  const issuer = `${MFA_ISSUER} - ${input.company.replace(/:/g, ' ')}`.slice(0, 64);
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(MFA_TOTP_DIGITS),
    period: String(MFA_TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Recovery codes are `xxxxx-xxxxx` from this alphabet: no 0/o, 1/l/i to misread off paper. */
export const MFA_RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Ten alphabet characters as `xxxxx-xxxxx`. The API supplies the random characters. */
export function mfaFormatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

/**
 * What a typed recovery code is compared as: lower case, no spaces or hyphens. Null when it cannot
 * be one, so a six-digit authenticator code is never mistaken for a recovery code.
 */
export function mfaNormaliseRecoveryCode(input: string): string | null {
  const clean = input.toLowerCase().replace(/[\s-]/g, '');
  if (clean.length !== 10) return null;
  for (const char of clean) if (!MFA_RECOVERY_ALPHABET.includes(char)) return null;
  return clean;
}
