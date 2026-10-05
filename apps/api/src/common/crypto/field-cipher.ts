import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts one sensitive field — a passport or Emirates ID number — for storage.
 *
 * AES-256-GCM with a fresh 12-byte IV per value, so the same number stored twice gives two
 * different ciphertexts and the column cannot be used to tell that two workers share a passport.
 * The authentication tag means a tampered value fails to decrypt instead of decrypting to rubbish.
 *
 * Stored as `v1:<base64 iv|tag|ciphertext>`. The prefix names the scheme, so a later move to a new
 * key or algorithm can read the old rows while writing new ones.
 */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('FieldCipher needs a 32-byte key');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    if (!stored.startsWith('v1:')) throw new Error('Unknown field encryption scheme');
    const raw = Buffer.from(stored.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** The last four characters, for showing which document this is without showing the number. */
export function hintOf(number: string): string {
  const compact = number.replace(/[\s-]/g, '');
  return compact.length <= 4 ? compact : compact.slice(-4);
}
