# Bull or Bear — RebateGain Trading Duel · Claude Code Build Spec

> This REPLACES the Rebate Rush gameplay. Paste this whole file in as the project spec (save as `SPEC.md`), and: *"Read SPEC.md fully. We are pivoting the game. Reuse the proven foundation per §1, rewrite the gameplay layer, and propose a plan before writing code."* Build in the phases at the bottom — do not one-shot.

---

## 0. Role & the one idea

You are building **Bull or Bear**, a 2-player Telegram trading-prediction duel for **RebateGain** (a forex rebate / cashback platform).

**Core loop:** a real chart of a real asset (Gold/XAUUSD, EUR/USD, GBP/USD, USD/JPY, WTI oil, BTC, ETH) plays forward for a few seconds, then **freezes**. The player calls the next move — **BUY (up)** or **SELL (down)** — against a short timer. Then the chart reveals **what actually happened in real history**. 4 rounds. Two players face the **same** 4 charts; whoever gets more right wins.

**The non-negotiable promise:** the game must be **provably fair and real** so players never suspect it's rigged. Every fairness decision in §3 exists to protect that.

---

## 1. Reuse vs rewrite (there is an existing repo)

The previous build (`Rebate Rush`) has a solid foundation. **Keep the foundation, replace the gameplay.**

**REUSE as-is (do not rebuild):**
- The **engine** (`engine/`: loop, input, renderer, audio synth, particle pool, rng, tween) — it's clean and tiny.
- The **brand layer** (`brand/tokens.ts` — exact colors/gradient/fonts sampled from the logos) and the **frosted-glass plate** (`glass.ts`).
- The **polished start/title screen treatment** (glass logo plate on brand-navy, Inter, ambient glow, bobbing coin). **The start screen must stay at this exact quality bar — the founder specifically liked it. Re-skin its buttons for the duel, but do not downgrade the polish.**
- The **`TelegramAdapter`** interface + `Noop`/`GamesPlatform` adapters and `selectAdapter()`.
- The **`bot/`** scaffold (grammY + `/score` + `/highscores` + `security.ts`) — extend it, don't restart it.
- `copy.ts` pattern (all user-facing strings centralized + compliance-checked).

**REWRITE / REMOVE:**
- The whole `game/` layer (Rebate Rush trade/scoring/lives/brokers/world). Replace with the duel modules in §2.
- Game-over "Rebate jar vs P&L" payoff → replaced by the round reveal + match-result screens.

**ADD (new):**
- `data-pipeline/` (offline puzzle builder, §3).
- A **match/duel layer** (§4) + deep-link challenge flow.
- A `puzzles.json` dataset.

> Keep the engine 100% Telegram-free; keep the bundle small (< 400 KB gzipped incl. an initial puzzle batch; lazy-load the rest of the dataset).

---

## 2. Game concept & round flow (exact params — all in a `config.ts`, easy to tune)

One **round** = one puzzle:

1. **Pre-roll (~1s):** "Round X / 4" + asset name shown (e.g. "GOLD · XAU/USD", "BITCOIN", "EUR/USD"). Asset is shown for flavor; **absolute date/time is hidden** (anti-lookup).
2. **Playback (~4s):** stream ~30 lead-up candles in, eased, so it feels live. Real OHLC, real wicks. Subtle "scanning"/live feel.
3. **Freeze:** chart freezes at the decision candle. Flash + "CALL IT". Two big buttons: **BUY ▲** (brand green) and **SELL ▼** (red). An **8s countdown ring** starts.
4. **Lock-in:** player taps BUY or SELL → locked, "Locked ✓". **Timeout with no call = counts as a miss** (keeps pressure; never silently helps the house either way).
5. **Reveal (~3s):** animate the **real future candles** (horizon `H`) playing out from the freeze. Resolve: price's close at `freeze + H` vs the freeze close → **up / down**. Show **✓ Correct** (green burst, point, combo flair) or **✗ Wrong** (red). Show the **verify chip** (§3.4) + the **rebate reminder** (§6).
6. **Tally** updates. Next round.

After 4 rounds → match result (§4). 

**Tuning defaults (`config.ts`):** `CONTEXT_CANDLES=30`, `HORIZON_H=10`, `DECISION_SECONDS=8`, `PLAYBACK_MS=4000`, `REVEAL_MS=3000`, `ROUNDS=4`, `TIEBREAKER=true`.

---

## 3. THE DATA & FAIRNESS SOLUTION (the crux — get this exactly right)

Fairness rests on **four pillars**. Implement all four.

### 3.1 Real historical data, outcome fixed by history
Each puzzle is a real slice of a real asset's history: a context window, a freeze point, and the **actual** future. The outcome is whatever truly happened — the house cannot influence it. **Never synthesize or fudge candles.**

### 3.2 Pre-baked, curated dataset (no live API at runtime)
Build the dataset **offline**, once, in `data-pipeline/` (Node + TS scripts). Do NOT call market APIs at game time (slow, rate-limited, fragile, and would break PvP symmetry).

**Free, real sources (use these):**
- **Crypto (BTC, ETH):** **Binance klines** REST (`/api/v3/klines`, free, no key, deep history) — the zero-friction anchor. (Kraken's free downloadable full-history OHLCVT CSVs are a fine alternative.)
- **FX majors + Gold (XAUUSD) + Oil (WTI/Brent):** **Dukascopy** historical export or **Forexite** M1 dumps (free, high quality, FX + metals + crypto, history back ~20y), or **Alpha Vantage** free API key (FX intraday + commodities) if you prefer an API to file dumps.

**Pipeline steps (`data-pipeline/src/build.ts`):**
1. **Fetch** raw OHLC per asset/timeframe (timeframes: 5m, 15m, 1h — tag each puzzle).
2. **Slice** into clips: `[ ...CONTEXT_CANDLES, freezeCandle, ...HORIZON_H future ]` at many non-overlapping (or lightly strided) offsets.
3. **Label** `outcome = close[freeze + H] > close[freeze] ? 'up' : 'down'`.
4. **Curate (this is what makes it fair AND fun):**
   - **Balance ~50/50 up/down** overall and per asset → a coin-flipper averages ~50%, so any score above that is provably *skill*, and there's no exploitable directional bias.
   - **Drop degenerate clips:** require `|Δ| ≥ noiseThreshold` (e.g. ≥ 0.15% or ≥ k×ATR) so outcomes are unambiguous — no ties, no "basically flat" feel-cheated cases.
   - **Variety:** mix assets, timeframes, and regimes (trending vs ranging). Optional `difficulty` tag from trend-strength/volatility.
   - **Dedupe** heavily-overlapping windows.
5. **Obfuscate for play:** store the absolute real date only in a `verify` field (revealed AFTER the call, never during). Render relative time on axes during play.
6. **Output** `puzzles.json` — target **≥ 500 clips** (more = less repetition). Shape:
```ts
type Puzzle = {
  id: string;
  asset: string;           // "XAU/USD"
  timeframe: '5m'|'15m'|'1h';
  candles: Candle[];       // context (length CONTEXT_CANDLES)
  future: Candle[];        // length HORIZON_H (shown only on reveal)
  freezeClose: number;
  outcome: 'up' | 'down';
  difficulty?: 'easy'|'med'|'hard';
  verify: { realDateUtc: string; source: 'binance'|'dukascopy'|'forexite'|'alphavantage' };
};
```

### 3.3 Skill horizon, not a coin flip
Predicting the literal next tick is ~50/50 (random walk) and feels unfair. Predicting direction **`H` candles out**, with `CONTEXT_CANDLES` of visible trend/structure, lets a trader read momentum and beat chance. This is what makes it feel *skillful and fair* rather than a slot machine. Keep enough context on screen to actually reason from.

### 3.4 Verifiability (kills the "rigged" suspicion outright)
On every reveal, show a **verify chip**: `Real data · XAU/USD · Mar 2026 · via Dukascopy`. Tapping it shows the exact real timestamp + source (and, where feasible, deep-links to that asset/date on a public chart). This is the single most important trust feature — make it visible, not buried.

### 3.5 Anti-lookup (so recognition can't break fairness)
Historical data is fixed, so in theory a player could recognize the moment and look it up. Mitigate: hide absolute dates during play (3.2.5), keep the 8s timer (no time to search), and rely on the large pool (one of 500+ windows). For a casual viral duel this is sufficient; don't over-engineer it.

---

## 4. PvP / match structure

### 4.1 Match = a seed → the same 4 puzzles for both players
A **match seed** deterministically selects `ROUNDS` puzzle IDs (balanced + varied). **Both players get the identical set, same order** → the duel is decided purely by who reads charts better. Symmetric and fair.

### 4.2 v1 = async "challenge a friend" (Telegram-native, viral)
1. Player A picks **Challenge a friend** → plays 4 rounds → gets a score.
2. App produces a **Telegram share message** with a deep link carrying the match seed (`?startapp=duel_<seed>` for Mini App, or game URL param for the Games platform), e.g. *"I scored 3/4 on the RebateGain Trading Duel 📈 Can you beat me? 👇"*.
3. Player B opens it → plays **the same 4** → results compared → **winner announced** (in-app + a result message back to the chat). **Rematch** button (new seed).

Async needs no realtime infra, fits Telegram's share-to-chat model, and *is* the virality engine. 

### 4.3 Tiebreak
Equal correct counts → **sudden-death Round 5** (one more shared puzzle). Still tied → faster average decision time wins.

### 4.4 Modes on the start screen
- **Challenge a friend** (async PvP, the headline).
- **Quick play / Practice** (solo: play 4, see accuracy, climb a global accuracy leaderboard) — gives solo users an entry and feeds them toward duels.
- **Leaderboard** (duel wins + accuracy).
- *(Flagged for later: real-time live duel — websocket lobby, presence, simultaneous play. Architect the match layer so it can drop in; don't build it now.)*

### 4.5 Backend (extend `bot/`)
Add match endpoints: create match (seed → puzzle IDs), submit a player's results, resolve winner when both have played, leaderboard. Store minimal match state (seed, perPlayer results, winner). Treat all client-submitted results as untrusted: the server holds the puzzle outcomes and **scores server-side** from the submitted calls — never trust a client-sent "correct count."

---

## 5. Scoring
- **1 point per correct call.** Match winner = more points over the shared set. (Keep PvP scoring pure correct-count — no speed/combo weighting — so it's transparently fair.)
- **Solo leaderboard:** accuracy %, with a small combo flair for consecutive correct calls (cosmetic + solo-board only; never affects a duel result).

---

## 6. Brand thread, funnel & start screen

This game stays **strongly RebateGain** (that's why the concept landed):
- **Real assets RebateGain traders trade** (XAU/USD, EUR/USD, GBP/USD, USD/JPY, WTI, BTC, ETH).
- **Reveal reminder (the rebate hook, kept light):** on each reveal — *"On RebateGain, every trade pays you a rebate — win or lose."* This connects the skill game to the rebate value prop without making it the core mechanic.
- **Funnel:** match-result screen has the primary CTA **"Trade for real & earn rebates → RebateGain"** → `rebategain.com/signup?utm_source=telegram&utm_medium=game&utm_campaign=bull_or_bear` via `adapter.openLink()`. Plus **Rematch** and **Share**.
- **Start screen:** reuse the existing polished title treatment (glass plate + logo + ambient glow + Inter) — re-label for the duel modes (§4.4). Keep the white/inverted lockup for the dark surface (the fix already flagged). Hold the same premium-fintech bar.
- **Brand tokens:** unchanged — navy `#101830` bg, blue gradient `#0A78FF → #2A4BFF`, white text, green `#16C784` (BUY/up), red `#EA3943` (SELL/down).

---

## 7. Tech stack & repo structure (extend the existing monorepo)
```
rebate-rush/                 # keep folder name or rename to bull-or-bear
  packages/
    game/
      src/
        engine/              # REUSE
        brand/               # REUSE (tokens, glass, copy)
        ui/                  # title (REUSE+reskin) · round(playback/freeze/reveal) · matchResult · leaderboard · verifyChip
        game/                # NEW: Round.ts · Match.ts · Puzzle.ts · scoring.ts · config.ts
        data/                # puzzles.json (initial batch bundled; rest lazy-loaded)
        telegram/            # REUSE adapter; ADD deep-link/match parsing
        main.ts
    bot/                     # REUSE+extend: matches, results, leaderboard
    data-pipeline/           # NEW offline: fetch · slice · label · curate · emit puzzles.json
  README.md   SPEC.md
```
Frontend: TS + Vite + Canvas2D (no new framework). Backend: grammY + TS. Hosting: static frontend (Cloudflare Pages/Vercel) + bot backend (Railway/Render), both HTTPS.

---

## 8. Telegram integration
- Path A (Games platform) for the contest **and** Path B (Mini App) wired behind a flag — Mini App is the better home for deep-link challenges (`start_param`/`startapp`) and is recommended as the primary for the async duel; keep Games-platform score submission working too. All platform calls go through `TelegramAdapter`.
- Reuse the grammY `/score`+`/highscores` flow; add the match endpoints (§4.5). `BOT_TOKEN` server-side only.
- **Security note for the README (do not print the token in replies):** the bot token for `@SpreadShrinker_bot` was pasted into a chat transcript — **regenerate it via BotFather (`/token`) before production** and keep it only in `bot/.env` (git-ignored).

---

## 9. Compliance / disclaimers (RebateGain rules — enforce in `copy.ts`)
- **"This is a game for entertainment, not trading advice or signals. Past performance does not predict future results."** Show this on the title screen and/or first reveal. Critical: a direction-calling game on real charts must NOT read as financial advice or a signal service.
- No "get rich", "guaranteed", "passive income", or "we'll teach you to beat the market".
- In-game points/score are clearly **not money** and not a rebate payout.
- Don't state broker counts or specific rebate rates; keep the network framing open-ended.
- The only product claim the rebate reminder makes — rebates are paid on every trade, win or lose — is true; keep it to that.

---

## 10. Definition of Done
- [ ] `data-pipeline` produces a balanced (~50/50), de-duped, variety-tagged `puzzles.json` (≥500) from real free sources, with `verify` metadata.
- [ ] Round loop: playback → freeze → 8s call (BUY/SELL) → real-future reveal → ✓/✗, with the verify chip + rebate reminder.
- [ ] Outcome scored from real data; server-side scoring (client calls are untrusted).
- [ ] 4-round match; same 4 puzzles for both players via match seed; sudden-death tiebreak.
- [ ] Async challenge-a-friend deep-link flow end-to-end (A plays → share → B plays same set → winner). Rematch + Share.
- [ ] Start screen at the existing polish bar, re-skinned for duel modes; solo Practice + leaderboard.
- [ ] All copy passes §9 (incl. the not-financial-advice disclaimer).
- [ ] Reuses engine/brand/glass/adapter/bot; bundle < 400 KB gzipped; 60 fps.

---

## 11. Phased build plan (commit per phase, check in after each)
1. **Pivot scaffold:** keep engine/brand/glass/adapter/bot; gut Rebate Rush `game/`; add `config.ts`, `Puzzle.ts` types, `data/` stub. Title screen reskinned to duel modes.
2. **Data pipeline:** `data-pipeline` — fetch (Binance + one FX/gold/oil source) → slice → label → curate/balance → emit a real `puzzles.json`. Verify the balance + no-degenerate-clips stats.
3. **Round engine (solo):** playback → freeze → call → real reveal → ✓/✗ + verify chip; fully playable solo over 4 rounds in the browser via Noop.
4. **Juice & brand:** reveal flair, combo, rebate reminder, result screen + CTA, disclaimers, leaderboard panel. ← natural founder-demo checkpoint: a polished solo game.
5. **Match layer + async PvP:** match seed → shared puzzles; challenge deep-link; winner resolution; rematch; server-side scoring; leaderboard.
6. **Telegram + hardening:** Mini App deep-link (`startapp`) primary + Games-platform score; bot match endpoints; token regen + security; perf/safe-area/webview pass. README (BotFather, env, deploy).
7. **(Later, flagged):** real-time live duel.

Keep the engine Telegram-free. Score on the server. Never fake a candle. Show the verify chip.
