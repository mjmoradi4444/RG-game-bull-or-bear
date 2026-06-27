# Rebate Rush

A Telegram HTML5 arcade game for **RebateGain**. One lesson, made visceral:

> **Win or lose, the rebate pays. That's RebateGain.**

A price line ticks up and down. Every "trade" you fire drops a gold **rebate coin**
into your jar — whether the candle turns green or red. Your **P&L** swings and can go
negative; your **rebate jar only ever rises**. Score = total rebate banked, and the
leaderboard ranks rebate, never P&L.

## Monorepo layout

```
packages/
  game/   platform-agnostic Canvas2D game (TypeScript + Vite) — zero Telegram imports
  bot/    grammY bot + score backend (added in Phase 5)
```

Every Telegram-specific call lives behind a single `TelegramAdapter` interface
(`packages/game/src/telegram/`), with Games-platform (Path A), Mini App (Path B),
and Noop (dev) implementations selected at runtime by `selectAdapter()`. The engine
stays 100% Telegram-free — that separation is the whole architectural point.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — plays in any browser via NoopAdapter
npm run build      # type-check + production build
npm run typecheck  # type-check only
```

## Brand

Colors, gradients, and fonts are sampled from the official RebateGain logos and
live in `packages/game/src/brand/tokens.ts` (the single source of truth). Gold is
the rebate, blue is the brand, green/red are trading-only — never mixed.

## Build status (phased — see `SPEC.md` §11)

- [x] **Phase 1 — scaffold:** monorepo, Vite, brand tokens, `TelegramAdapter` + `NoopAdapter`, bootable brand splash
- [ ] Phase 2 — engine: loop, input, renderer, audio, particles (grey-box playable)
- [ ] Phase 3 — gameplay: trades, dual meters, rebate scoring, 3-life high-spread mechanic, combo, difficulty, broker tiers
- [ ] Phase 4 — juice & brand: polish, game-over screen, CTA
- [ ] Phase 5 — Telegram Path A: grammY bot, `setGameScore` / `getGameHighScores`, signed score submission, BotFather guide
- [ ] Phase 6 — hardening: security, perf budget, responsive / safe-area
- [ ] Phase 7 — Path B Mini App: global leaderboard, referral
