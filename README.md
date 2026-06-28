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
- [ ] Phase 6 — Telegram + hardening: Mini App `startapp` + Games score, bot endpoints, security, README
- [ ] Phase 7 — *(later)* real-time live duel
