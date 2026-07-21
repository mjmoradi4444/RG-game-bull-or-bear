/**
 * Email validation + normalization (PRD-ADMIN-EMAIL §5.3). Pure functions, no I/O —
 * unit-tested in _emailtest.ts. The email is a *matching hint*, never proof of
 * identity (no verification in v1), so this is deliberately lenient about exotic
 * addresses and strict only about the shapes that break back-office search.
 */

/** RFC-5322-lite: one @, a sane local part, a dotted domain, ≤ 254 chars. */
const EMAIL_RE = /^[^\s@"']+(\.[^\s@"']+)*@[^\s@.]+(\.[^\s@]+)+$/;

export const MAX_EMAIL_LEN = 254;

export function isValidEmail(raw: string): boolean {
  const e = raw.trim();
  if (e.length < 6 || e.length > MAX_EMAIL_LEN) return false;
  if (!EMAIL_RE.test(e)) return false;
  const tld = e.slice(e.lastIndexOf('.') + 1);
  return tld.length >= 2 && /^[a-z]+$/i.test(tld);
}

/** Clean the address as typed (store this): trim + lowercase. */
export function cleanEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Normalized key for DUPLICATE DETECTION only (never stored as the address):
 * lowercase, and for Gmail-style providers strip dots + everything after `+`,
 * since those all deliver to one inbox. Store `cleanEmail` as the real address.
 */
export function normalizeEmail(raw: string): string {
  const e = cleanEmail(raw);
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

// Common TLD/domain typos → the intended value, for the "Did you mean …?" hint.
const TLD_FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'iclould.com': 'icloud.com',
};

/** Suggest a correction for an obvious domain typo, else null (client-side hint). */
export function suggestEmail(raw: string): string | null {
  const e = cleanEmail(raw);
  const at = e.lastIndexOf('@');
  if (at < 0) return null;
  const domain = e.slice(at + 1);
  const fixed = TLD_FIXES[domain];
  return fixed ? `${e.slice(0, at)}@${fixed}` : null;
}
