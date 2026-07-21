import { bot } from './bot';
import { startServer } from './server';
import { config } from './config';
import { onSeasonClose } from './store';

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
    { command: 'link', description: 'Link RebateGain to claim season prizes' },
  ]);
  // Season close → congratulate the winners with the claim CTA (PRD Story 5).
  // Best-effort: sendMessage works because every player has started the bot.
  const api = bot.api;
  onSeasonClose(({ seasonId, prizes }) => {
    for (const p of prizes) {
      void api
        .sendMessage(
          p.u,
          `🏆 Season ${seasonId} is over — you finished #${p.rank}!\n` +
            `Your prize: a ${p.sharePct}% rebate share for the entire next month.\n` +
            `Claim it within 7 days: send /link to connect your RebateGain account.`,
        )
        .catch((e) => console.warn('[season] winner DM failed:', e instanceof Error ? e.message : e));
    }
  });
  console.log(`[bot] @${me.username} ready · game "${config.gameShortName}"`);
  await bot.start({ drop_pending_updates: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
