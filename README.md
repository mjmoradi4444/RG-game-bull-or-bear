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
3. `/newgame` → set title, description, photo, and the **short name** (`bull_or_bear`).

**Env** — `packages/bot/.env` (git-ignored; copy from `.env.example`):
`BOT_TOKEN` (never commit — regenerate via BotFather if leaked) · `GAME_SHORT_NAME=bull_or_bear` ·
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

**Seasonal scoring & Rush Tokens** (`PRD-SCORING-TOKENS.md`, Phase A). The best-score
board is superseded by a **cumulative, monthly-reset Rush Points (RP)** system gated by
**10 daily Rush Tokens** (00:00 UTC refill, 1 token per ranked match, free unlimited
Practice). All server-authoritative — no new env, reuses `SCORE_SECRET`; state persists
to `.data/seasons.json` (atomic writes; single pm2 instance). API (`packages/bot`):

| Endpoint | Purpose |
|----------|---------|
| `GET /profile?gctx=` | tokens, streak ×multiplier, season, RP, rank |
| `POST /match/start` | atomically spend a token → single-use `matchToken` (402 when out) |
| `POST /match/result` | server recomputes RP from the round log (replay → 409) |
| `POST /match/abort` | refund a token if the match died before round 1 |
| `GET /leaderboard?gctx=` | season rows + Hall of Fame podium (prev top 3) + self |
| `GET /prizes` | previous season's winners + claim state |

RP = `Σ correct × (10·weight)` + flawless + duel-win (halved vs AI fill) + win-streak,
all `× daily-streak multiplier` (cap ×1.25), hard-capped per match. Season close is lazy
(first request after a month boundary): archives the top 3, writes prizes (100/90/80%
rebate share for the eligible top 3, ≥20-match floor) + an ops report, opens the new
season at 0 RP. Winners are DM'd and claim via the bot's `/link` command. `/score` +
`/highscores` remain for backward-compat during rollout. Math is unit-tested
(`_rptest.ts`); RP is never trusted from the client (recomputed + clamped).

**Email capture & admin dashboard** (`PRD-ADMIN-EMAIL.md`, Phase A) — makes the rebate
prize deliverable by bridging a Telegram player to a RebateGain account.

- *In-game email capture:* an email screen (a real HTML `<input>` overlaid on the canvas
  — the one place the canvas-only rule is broken, for native keyboard/autofill) stores the
  address the player registered with on rebategain.com, as a *matching hint* (no
  verification in v1). Title chip + Prizes-sheet CTA + a one-time top-20 result nudge.
  `POST /account/email` (validate → normalize → duplicate-flag → 3-changes/season cap →
  freeze during prize application), `GET /account`, `POST /account/delete`. Validation is
  unit-tested (`_emailtest.ts`).
- *Admin dashboard* at **`/admin`** (server-rendered HTML + vanilla JS, no build step,
  served by the same bot): Overview tiles, a searchable/sortable Players table + detail
  drawer, Season standings, the **Prize Workflow** (per-winner eligibility, Mark-applied,
  Roll-down to the next eligible rank, winner DMs, UTF-8-BOM CSV export), an Anomalies/
  review queue (heuristic flags: duplicate-email, accuracy/speed outliers, burst play),
  and an append-only Audit log for every mutating action. Auth is scrypt (built-in, no
  dep) + an HttpOnly/SameSite=Strict session cookie with per-IP lockout; admin routes are
  same-origin only (never the game API's CORS wildcard) with `no-store`/`DENY`/strict-CSP.
  **Disabled until `ADMIN_USER` + `ADMIN_PASSWORD_HASH` are set** (`npm run admin:hash --
  '<password>'`). The RebateGain back office is behind a one-module seam
  (`rebategainAdapter.ts`, manual now / API later).

**Onboarding, forex-first charts & tasks** (`PRD-ONBOARDING-TASKS.md`, Phase A) — fixes
the first five minutes and the daily middle.

- *Forex-first charts (Lever 1):* the raw pool is 72% crypto — wrong for a forex brand.
  `PuzzleBank.pick` now draws each round's class from `ASSET_CLASS_WEIGHTS` (forex .70 /
  commodity .15 / crypto .15 — XAU counts as forex), guarantees ≥1 XAU/EUR clip per
  match, drops SOL, and stays **deterministic per seed** (the duel invariant).
  `_pickertest.ts` asserts the distribution (±5pp), determinism, and brand guarantee.
  *(Lever 2 — a data-pipeline rebuild to ~500 forex-majority clips — is the remaining
  follow-up so the Whale tier isn't crypto-heavy.)*
- *First-run tutorial:* a 10-step FTUE (`Game.ts` + `Tutorial` flow) — welcome → a guided
  forex practice round (paused/extended, no-skip) → a 4-step environment tour with a
  spotlight overlay. Skippable, replayable via "How to play", remembered server-side
  (`users.tutorial_done`, `/onboarding`), shown only to brand-new players (never over a
  challenge link).
- *Tasks:* one-time (tutorial, socials, email-link, first-duel, referral) + 3 rotating
  daily tasks (same for everyone), paying RP/tokens through the same server-side pipeline
  (tagged `source: task`), capped so task RP stays ≲5% of a season. Gameplay progress is
  server-authoritative from match submissions; Telegram-join verifies via
  `getChatMember`; socials use a 30s click-claim. `GET/POST /tasks*`, a Tasks sheet in the
  game, and an admin **Tasks** view (CRUD + funnel, rewards clamped ≤200 RP / ≤2 tokens).
  Social URLs/channel are set in the admin panel — no redeploy, no new env.

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
- [~] **Phase 7 — seasonal scoring, tokens & rebate prizes** (`PRD-SCORING-TOKENS.md`):
  Phase A shipped — daily Rush Tokens + `/match/start`→`matchToken`, cumulative RP
  (base · flawless · duel-win · win-streak · daily multiplier), monthly seasons with a
  Hall of Fame podium + top-3 medal styling, rebate-share prizes (100/90/80%) with the
  bot `/link` claim flow, token/streak/countdown HUD, free Practice, and an in-game
  Prizes sheet. Server-authoritative (recompute + clamp + single-use tokens);
  `_rptest.ts` covers the RP math. **Remaining (B/C):** rival/Happy-Hour nudges, share
  cards, daily quests, leagues, server-side round validation, automated prize application.
- [~] **Phase 8 — email capture + admin dashboard** (`PRD-ADMIN-EMAIL.md`): Phase A
  shipped — in-game email capture (HTML input overlay, validation/dedupe/change-cap/
  freeze, `_emailtest.ts`), and the `/admin` dashboard (scrypt+session auth with lockout,
  Overview/Players/Season/Prizes/Flags/Audit, prize apply + roll-down + CSV + winner DMs,
  heuristic anomaly flags, append-only audit log, back-office adapter seam). Admin routes
  are same-origin only and disabled until credentials are provisioned. **Remaining (B/C):**
  Telegram 2FA, sparklines, expiry auto-reminders, and the automated back-office API.
- [~] **Phase 9 — onboarding, forex-first charts & tasks** (`PRD-ONBOARDING-TASKS.md`):
  Phase A shipped — forex-weighted deterministic picker (Lever 1, `_pickertest.ts`), the
  10-step first-run tutorial (guided forex round + spotlight tour, server-remembered,
  replayable), and the task system (one-time + daily, server-authoritative progress,
  Telegram-join verify, click-claim socials, referral, Tasks sheet + admin Tasks CRUD,
  reward clamps). **Remaining:** dataset rebuild (Lever 2, forex-majority ~500 clips),
  contextual tooltips polish, and Persian localization of the new copy.

> Verified locally: HMAC sign/verify/expiry/clamp unit-tested; the score API's routing,
> CORS, and 401 gate confirmed via curl; bot + game type-check clean. The
> `setGameScore`/long-poll path runs outside this sandbox (Telegram is unreachable from
> here, though the token is valid) — test it end-to-end from a tunnelled dev server.
