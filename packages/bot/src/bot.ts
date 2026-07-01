import { Bot } from 'grammy';
import { config } from './config';
import { signContext } from './security';

/**
 * The grammY bot for the Telegram Games platform (SPEC §5.2):
 *   /start        → send the game card (Play button)
 *   inline_query  → share the game into any chat (inline mode is mandatory for games)
 *   Play tapped   → answer the callback with the game URL + a signed launch context
 */
export const bot = new Bot(config.botToken);

bot.catch((err) => console.error('[bot] error:', err.error));

bot.command('start', async (ctx) => {
  await ctx.replyWithGame(config.gameShortName);
});

bot.on('inline_query', async (ctx) => {
  await ctx.answerInlineQuery([{ type: 'game', id: 'bob', game_short_name: config.gameShortName }], {
    cache_time: 0,
  });
});

bot.on('callback_query:game_short_name', async (ctx) => {
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
