import { bot } from './bot';
import { startServer } from './server';
import { config } from './config';

/**
 * Entry point: start the score API, then run the bot via long polling (works
 * locally with just the token — no public webhook needed for dev). For production,
 * switch to a webhook (see README) and host both behind HTTPS.
 */
async function main(): Promise<void> {
  startServer();
  if (!bot) {
    console.warn('[bot] BOT_TOKEN not set — running server-only (game + API + matchmaking).');
    return;
  }
  const me = await bot.api.getMe();
  // Publish the command list so /play shows in the menu button (no manual /setcommands).
  await bot.api.setMyCommands([
    { command: 'play', description: 'Play Bull or Bear' },
    { command: 'start', description: 'Open the game' },
  ]);
  console.log(`[bot] @${me.username} ready · game "${config.gameShortName}"`);
  await bot.start({ drop_pending_updates: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
