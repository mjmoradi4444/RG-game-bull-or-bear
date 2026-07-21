import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}

/** All bot config from the environment. BOT_TOKEN never leaves the server.
 *  BOT_TOKEN/GAME_URL are optional so the HTTP+matchmaking server can run locally
 *  (server-only dev mode) without Telegram; production must set both. */
export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  // Hardcoded (not env-driven) so a stale GAME_SHORT_NAME in the server .env can't
  // reintroduce the old value. Must exactly match the short name registered in
  // BotFather via /newgame.
  gameShortName: 'bull_or_bear',
  gameUrl: process.env.GAME_URL ?? 'http://localhost:8080',
  scoreSecret: required('SCORE_SECRET'),
  port: Number(process.env.PORT ?? 8080),
  allowOrigin: process.env.ALLOW_ORIGIN ?? '*',

  // Admin dashboard (PRD-ADMIN-EMAIL §6.1). Optional: the panel is DISABLED (routes
  // 404) until both ADMIN_USER and ADMIN_PASSWORD_HASH are set, so production stays
  // locked down until the operator provisions credentials. The password is stored
  // ONLY as a scrypt hash (generate with `npm run admin:hash -- <password>`).
  adminUser: process.env.ADMIN_USER ?? '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  // Session-signing key, domain-separated from SCORE_SECRET if not set separately.
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET ?? '',
  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  backofficeUrl: process.env.REBATEGAIN_BACKOFFICE_URL ?? '',
} as const;

/** Whether the admin dashboard is provisioned (both creds present). */
export const adminEnabled = (): boolean => !!config.adminUser && !!config.adminPasswordHash;
