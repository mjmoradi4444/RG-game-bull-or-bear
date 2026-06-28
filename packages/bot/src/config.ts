import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}

/** All bot config from the environment. BOT_TOKEN never leaves the server. */
export const config = {
  botToken: required('BOT_TOKEN'),
  gameShortName: process.env.GAME_SHORT_NAME ?? 'bullorbear',
  gameUrl: required('GAME_URL'),
  scoreSecret: required('SCORE_SECRET'),
  port: Number(process.env.PORT ?? 8080),
  allowOrigin: process.env.ALLOW_ORIGIN ?? '*',
} as const;
