import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * scrypt password hashing (PRD-ADMIN-EMAIL §6.1). Pure + config-free so the
 * `admin:hash` CLI can run without loading the server's env (no SCORE_SECRET
 * needed just to mint a hash). No external dep — Node's built-in scrypt.
 *
 * Format:  scrypt$<saltHex>$<hashHex>
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(password, salt, KEYLEN);
  return timingSafeEqual(actual, expected);
}
