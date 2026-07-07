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
  gameShortName: process.env.GAME_SHORT_NAME ?? 'bullorbear',
  gameUrl: process.env.GAME_URL ?? 'http://localhost:8080',
  scoreSecret: required('SCORE_SECRET'),
  port: Number(process.env.PORT ?? 8080),
  allowOrigin: process.env.ALLOW_ORIGIN ?? '*',
} as const;
