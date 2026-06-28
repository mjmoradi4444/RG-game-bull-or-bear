# Bull or Bear — RebateGain Trading Duel

A 2-player Telegram trading-prediction duel for **RebateGain**. A real chart of a
real asset plays, **freezes**, and you call the next move — **BUY ▲ / SELL ▼** — on
an 8-second timer. Then the **real future** reveals what actually happened in
history. 4 shared rounds per match; whoever reads the charts better wins.

> The non-negotiable: **provably fair and real**. Outcomes come from real historical
> data, never synthesized, and every reveal shows a **verify chip** (real date +
> source). See `SPEC.md` §3.

> Pivoted from the earlier *Rebate Rush* build — the engine, brand layer, frosted
> glass, title treatment, and `TelegramAdapter` are reused; the gameplay is new.

## Monorepo layout

```
packages/
  game/            platform-agnostic Canvas2D game (TypeScript + Vite) — zero Telegram imports
    src/
      engine/      REUSED: loop, input, viewport, audio synth, particles, rng, math
      brand/       REUSED: tokens.ts, copy.ts (rewritten for the duel)
      ui/          glass, Button, text (reused) · Title (reskinned) · round/result (Phase 3+)
      game/        NEW: config.ts, Puzzle.ts, types.ts · Round/Match (Phase 3+)
      data/        puzzles.json (built offline; initial batch bundled, rest lazy-loaded)
      telegram/    REUSED adapter + Noop; Games/MiniApp + deep-link parsing (Phase 6)
  bot/             grammY bot + score/match backend (Phase 5/6)
  data-pipeline/   NEW offline: fetch → slice → label → curate → emit puzzles.json (Phase 2)
```

Every Telegram-specific call lives behind a single `TelegramAdapter`
(`packages/game/src/telegram/`), selected at runtime. The engine stays 100%
Telegram-free.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — plays in any browser via NoopAdapter
npm run build      # type-check + production build
```

## Data & fairness

The puzzle dataset is built **offline** by `data-pipeline/` from **real, free**
sources (Binance for crypto; Dukascopy / Alpha Vantage for FX, Gold, Oil) — never a
live API at game time. Curation balances outcomes ~50/50, drops degenerate clips,
mixes assets/timeframes, and dedupes, so a coin-flipper averages ~50% and any higher
score is provably skill. The real date is stored only in a `verify` field, shown
after the call. **Never fake a candle.**

## Telegram & the bot (`packages/bot`)

The bot serves the game on Telegram's **Games platform** and holds the score-writing
token server-side (the browser never sees `BOT_TOKEN`).

**BotFather setup (one-time):**
1. `/newbot` → create the bot, get its token.
2. `/setinline` → enable inline mode (mandatory for games).
3. `/newgame` → set title, description, photo, and the **short name** (`bullorbear`).

**Env** — `packages/bot/.env` (git-ignored; copy from `.env.example`):
`BOT_TOKEN` (never commit — regenerate via BotFather if leaked) · `GAME_SHORT_NAME=bullorbear` ·
`GAME_URL` (public HTTPS URL hosting `packages/game`) · `SCORE_SECRET` (HMAC key) ·
`PORT` · `ALLOW_ORIGIN`. The game build reads `VITE_SCORE_API` (the bot's URL).

**Run locally** (Telegram needs HTTPS + outbound to `api.telegram.org`):
```bash
npm run dev -w @rebate-rush/game                  # serves the game on :5174
cloudflared tunnel --url http://localhost:5174    # → https://<id>.trycloudflare.com
#   put that URL in bot/.env GAME_URL; put the bot's URL in the game's VITE_SCORE_API
npm start -w @rebate-rush/bot                      # bot (long polling) + score API on :8080
```
Then open the bot in Telegram → `/start` → **Play**.

**Runtime flow (SPEC §5.2):** Play → bot receives the `callback_query` → answers with
`GAME_URL#tgctx=<signed>` → the game `POST`s its score + that token to `/score` → the
bot verifies the HMAC, clamps, and calls **`setGameScore`**; the in-game board reads
**`getGameHighScores`** via `GET /highscores`. Client scores are untrusted (signed
context + clamp + per-user rate limit).

**Deploy:** frontend (`npm run build -w @rebate-rush/game`) to Cloudflare Pages /
Vercel (HTTPS); bot to Railway / Render / Fly (set env; switch long polling to a
webhook for production).

## Status — phased build (see `SPEC.md` §11)

- [x] **Phase 1 — pivot scaffold:** gutted Rebate Rush gameplay; reskinned title to the
  three duel modes; added `config.ts` / `Puzzle.ts` / `data/`; kept engine, brand,
  glass, adapter. Bootable, on the same polish bar.
- [x] **Phase 2 — data pipeline:** `data-pipeline/` builds a real, exactly-50/50,
  de-duped `puzzles.json` (576, incl. XAU/USD + EUR/USD) from Binance + Dukascopy,
  with `verify` metadata. Run with `npm run build:data -w @rebate-rush/data-pipeline`.
- [x] **Phase 3 — round engine (solo):** fully playable 4-round solo flow via
  `NoopAdapter` — pre-roll → candlestick playback → freeze + 8s BUY/SELL call → real
  future reveal → ✓/✗ with the verify chip + rebate reminder → result. New: `Chart`,
  `RoundView`, `VerifyChip`, `Round`, `Match`, `PuzzleBank`, `scoring`.
- [x] **Phase 4 — juice & brand:** reveal flair (gold/green burst on ✓, screen-shake +
  loss SFX on ✗), cosmetic combo streak, win/loss SFX + haptics, and a branded result
  screen — score · accuracy · best streak · rebate reminder · primary CTA
  (`Trade for real → RebateGain`) · Rematch · Leaderboard · Share. Buttons auto-fit
  long labels.
- [x] **Phase 5 — match layer + async PvP (client):** deterministic match **seed** → the
  same 4 puzzles for both players · unicode-safe challenge **deep-link** codec
  (`?startapp=duel_…`) · incoming-challenge resolve → head-to-head result (You vs
  friend → win / lose / tie) · Rematch · Share link. The bot's **server-side scoring**
  + match endpoints land in Phase 6.
- [~] **Phase 6 — Telegram (Games platform) + bot:** `packages/bot` (grammY) — `/start`
  sends the game, `callback_query` → game URL + HMAC-signed launch context, `POST /score`
  → verify → `setGameScore`, `GET /highscores` → `getGameHighScores`. `GamesPlatformAdapter`
  wired via `selectAdapter` (`#tgctx=` launch). Security: signed context, score clamp,
  per-user rate limit, CORS. README: BotFather + env + run + deploy. **Remaining:** Mini
  App (`startapp`) adapter for the deep-link duel, server-side duel match endpoints, and
  the perf/safe-area/webview hardening pass.
- [ ] Phase 7 — *(later)* real-time live duel

> Verified locally: HMAC sign/verify/expiry/clamp unit-tested; the score API's routing,
> CORS, and 401 gate confirmed via curl; bot + game type-check clean. The
> `setGameScore`/long-poll path runs outside this sandbox (Telegram is unreachable from
> here, though the token is valid) — test it end-to-end from a tunnelled dev server.
