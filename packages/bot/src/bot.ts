import { Bot } from 'grammy';
import { config } from './config';
import { signContext } from './security';

/**
 * The grammY bot for the Telegram Games platform (SPEC §5.2):
 *   /start        → send the game card (Play button) — fired the instant an ad-clicker
 *                   opens the bot, so they see Play immediately (no blank screen)
 *   /play         → same as /start; the command shown in the menu / command list
 *   inline_query  → share the game into any chat (inline mode is mandatory for games)
 *   Play tapped   → answer the callback with the game URL + a signed launch context
 */
/** Null when BOT_TOKEN is unset (local server-only dev) — guard all uses. */
export const bot = config.botToken ? new Bot(config.botToken) : null;

bot?.catch((err) => console.error('[bot] error:', err.error));

/** Send the game card (green Play button). Shared by /start and /play. */
const sendGame = (ctx: { replyWithGame: (n: string) => Promise<unknown> }) =>
  ctx.replyWithGame(config.gameShortName);

// /start fires immediately on first open — critical for Telegram Ads: an ad-clicker
// must land on the Play button, not an empty chat.
bot?.command('start', sendGame);
bot?.command('play', sendGame);

// Prize-claim flow (PRD-SCORING-TOKENS §5.D): winners link their RebateGain
// account to claim the rebate-share boost. Phase A: point at the auth entry; the
// boost is applied manually in the back office from the season-close report.
bot?.command('link', async (ctx) => {
  await ctx.reply(
    'To claim season prizes, link your RebateGain account:\n' +
      'https://auth.rebategain.com/login\n\n' +
      'Sign in (or create an account), then reply here with the email you used. ' +
      'Prizes are a rebate-share upgrade on real trading — not a cash payout.',
  );
});

bot?.on('inline_query', async (ctx) => {
  await ctx.answerInlineQuery([{ type: 'game', id: 'bob', game_short_name: config.gameShortName }], {
    cache_time: 0,
  });
});

bot?.on('callback_query:game_short_name', async (ctx) => {
  const q = ctx.callbackQuery;
  if (q.game_short_name !== config.gameShortName) {
    await ctx.answerCallbackQuery({ text: 'Unknown game' });
    return;
  }
  // Tie this launch to the real user + message so /score can be verified later.
  console.log(
    `[launch] u=${ctx.from.id} chat=${q.message?.chat.id ?? '-'} msg=${q.message?.message_id ?? '-'} inline=${q.inline_message_id ?? '-'}`,
  );
  const token = signContext({
    u: ctx.from.id,
    n: ctx.from.first_name,
    c: q.message?.chat.id,
    m: q.message?.message_id,
    i: q.inline_message_id,
    t: Date.now(),
  });
  const url = `${config.gameUrl}#tgctx=${encodeURIComponent(token)}`;
  await ctx.answerCallbackQuery({ url });
});
