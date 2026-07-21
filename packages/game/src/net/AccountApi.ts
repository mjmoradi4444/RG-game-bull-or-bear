import { apiBase, launchGctx } from './Multiplayer';

/**
 * Client for in-game account/email capture (PRD-ADMIN-EMAIL §5.5). Same transport
 * as the rest: small same-origin JSON with the signed launch context. All calls
 * no-op (resolve null) when the game wasn't launched from the bot (no gctx), so
 * plain-browser dev never shows the email flow.
 */
export interface AccountView {
  masked: string | null;
  changesLeft: number;
  emailSetAt: number | null;
  eligible: boolean;
  frozen: boolean;
}

export type SaveEmailError = 'invalid_email' | 'change_limit' | 'frozen' | 'rate_limited' | 'network';
export type SaveEmailResult =
  | { ok: true; masked: string; changesLeft: number }
  | { ok: false; error: SaveEmailError };

const KNOWN_ERRORS: readonly SaveEmailError[] = [
  'invalid_email',
  'change_limit',
  'frozen',
  'rate_limited',
  'network',
];

const gctx = (): string | null => launchGctx();

export async function fetchAccount(): Promise<AccountView | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const r = await fetch(`${apiBase()}/account?gctx=${encodeURIComponent(g)}`);
    const d = (await r.json()) as { ok: boolean } & AccountView;
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

export async function saveEmail(email: string): Promise<SaveEmailResult> {
  const g = gctx();
  if (!g) return { ok: false, error: 'network' };
  try {
    const r = await fetch(`${apiBase()}/account/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gctx: g, email }),
    });
    const d = (await r.json()) as { ok: boolean; masked?: string; changesLeft?: number; error?: string };
    if (d.ok && d.masked) return { ok: true, masked: d.masked, changesLeft: d.changesLeft ?? 0 };
    const err = KNOWN_ERRORS.find((e) => e === d.error) ?? 'network';
    return { ok: false, error: err };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function deleteEmail(): Promise<boolean> {
  const g = gctx();
  if (!g) return false;
  try {
    const r = await fetch(`${apiBase()}/account/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gctx: g }),
    });
    const d = (await r.json()) as { ok: boolean };
    return d.ok;
  } catch {
    return false;
  }
}

// Client-side helpers mirror the server (email.ts) for instant feedback.
const EMAIL_RE = /^[^\s@"']+(\.[^\s@"']+)*@[^\s@.]+(\.[^\s@]+)+$/;
export function isValidEmailClient(raw: string): boolean {
  const e = raw.trim();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e)) return false;
  const tld = e.slice(e.lastIndexOf('.') + 1);
  return tld.length >= 2 && /^[a-z]+$/i.test(tld);
}

const TLD_FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'outlok.com': 'outlook.com', 'iclould.com': 'icloud.com',
};
export function suggestEmailClient(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return null;
  const fixed = TLD_FIXES[e.slice(at + 1)];
  return fixed ? `${e.slice(0, at)}@${fixed}` : null;
}
