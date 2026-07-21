import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config';
import { adminSession, createAdminSession, destroyAdminSession } from './store';

export { verifyPassword } from './passwords';

/**
 * Admin authentication (PRD-ADMIN-EMAIL §6.1): scrypt password verification (in
 * passwords.ts), a HttpOnly session cookie, and per-IP login lockout. No external
 * crypto dep — Node's built-in scrypt keeps the unattended `npm ci` deploy solid.
 *
 * Password hash format (what ADMIN_PASSWORD_HASH holds):  scrypt$<saltHex>$<hashHex>
 * Generate with `npm run admin:hash -- <password>` (adminHash.ts).
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'rg_admin';

// ---- per-IP login lockout (in-memory; 5 failures / 15 min → 15-min lock) ----

interface Attempt {
  count: number;
  first: number;
  lockedUntil: number;
}
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

export function isLockedOut(ip: string): boolean {
  const a = attempts.get(ip);
  return !!a && a.lockedUntil > Date.now();
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now - a.first > WINDOW_MS) a = { count: 0, first: now, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_FAILS) a.lockedUntil = now + WINDOW_MS;
  attempts.set(ip, a);
}

export function clearFailures(ip: string): void {
  attempts.delete(ip);
}

// ---- request helpers --------------------------------------------------------

export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

export function ipAllowed(ip: string): boolean {
  if (config.adminIpAllowlist.length === 0) return true;
  return config.adminIpAllowlist.includes(ip);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** True when the request arrives over HTTPS (directly or via a trusted proxy). */
function isSecure(req: IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') return proto.split(',')[0]!.trim() === 'https';
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string): void {
  const secure = isSecure(req) ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/admin; HttpOnly;${secure} SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/** Start a session for a verified admin. */
export function login(req: IncomingMessage, res: ServerResponse, admin: string): void {
  const token = createAdminSession(admin, clientIp(req), SESSION_TTL_MS);
  setSessionCookie(req, res, token);
}

export function logout(req: IncomingMessage, res: ServerResponse): void {
  const token = parseCookies(req)[SESSION_COOKIE];
  destroyAdminSession(token);
  clearSessionCookie(res);
}

/** The authenticated admin for this request, or null. */
export function sessionAdmin(req: IncomingMessage): string | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  return adminSession(token)?.admin ?? null;
}

/** Standard hardening headers for every /admin* response (PRD §6.1). */
export function adminSecurityHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  // Admin routes are same-origin only — never emit the game API's CORS wildcard.
}

export { SESSION_TTL_MS };
