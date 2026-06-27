# Rebate Rush — Claude Code Build Spec / Master Prompt

> Paste this whole file into Claude Code as the project spec (e.g. save as `SPEC.md` at the repo root and tell Claude Code: *"Read SPEC.md fully, then propose a plan before writing any code."*). Build in the phases at the bottom — do not one-shot the whole thing.

---

## 0. Role & non-negotiable rule

You are building **Rebate Rush**, a Telegram HTML5 arcade game for **RebateGain** (a forex rebate / cashback platform — traders get a portion of their spread/commission back on every trade, win or lose).

**The entire game exists to teach ONE idea, viscerally:**

> **"Win or lose, the rebate pays. That's RebateGain."**

Every design decision serves that lesson. If a feature doesn't reinforce it, cut it.

---

## 1. Architecture decision (read before choosing a stack)

Telegram supports two delivery paths. We are building **both-ready**:

- **Path A — Gaming Platform** (classic `/newgame` HTML5 game, native per-chat leaderboards via `setGameScore`). This is the contest target.
- **Path B — Mini App / Web App** (full Telegram WebApp SDK, custom global leaderboard, referral, sign-up funnel). This is the growth target.

**Mandatory architectural principle:** the core game engine must be **100% platform-agnostic** (pure Canvas + TS, zero Telegram imports). All Telegram-specific code lives behind a single `TelegramAdapter` interface with two implementations (`GamesPlatformAdapter`, `MiniAppAdapter`) selected at runtime. Score submission, leaderboard fetch, share, haptics, and user identity all go through this adapter.

Ship **Path A first** for the contest. Keep Path B wired but behind a flag.

---

## 2. Tech stack

- **Frontend (game):** TypeScript + **Vite** + **HTML5 Canvas 2D**. No game framework unless justified — keep the bundle tiny (target < 300 KB gzipped, first interaction < 2 s on 3G; Telegram users open in an in-app webview and bounce on slow loads). Phaser is allowed only if it clearly pays for itself; default to vanilla Canvas.
- **Backend (bot + score):** **Node.js + TypeScript + grammY**. Responsibilities: handle the `callback_query` with `game_short_name` and answer with the game URL; expose `POST /score` (verify + call `setGameScore`) and `GET /highscores` (call `getGameHighScores`). `BOT_TOKEN` stays in env, **never** in the frontend bundle.
- **Hosting:** static frontend on Cloudflare Pages / Vercel / Netlify (HTTPS mandatory). Bot backend on Railway / Render / Fly. Both must be HTTPS.
- **State:** no DB needed for Path A (Telegram stores high scores). For Path B add Postgres/Redis later for the global board + referral.

---

## 3. Repo structure

```
rebate-rush/
  packages/
    game/                  # platform-agnostic Canvas game (TS + Vite)
      src/
        engine/            # loop, input, renderer, audio, particles
        game/              # entities, spawner, difficulty, scoring, state machine
        ui/                # HUD, game-over screen, leaderboard panel
        telegram/
          TelegramAdapter.ts        # interface
          GamesPlatformAdapter.ts
          MiniAppAdapter.ts
          NoopAdapter.ts            # local dev / browser
        brand/             # tokens.ts (colors, fonts), assets
        main.ts
      index.html
    bot/                   # grammY bot + score backend (TS)
      src/
        bot.ts
        routes/score.ts
        routes/highscores.ts
        telegram.ts        # setGameScore / getGameHighScores wrappers
      .env.example         # BOT_TOKEN=, GAME_SHORT_NAME=, GAME_URL=
  README.md
  SPEC.md                  # this file
```

---

## 4. Game design spec (the core loop)

**Format:** mobile-first, portrait, one-thumb. Tap-anywhere control. Endless / survival. Must also work with click + spacebar on desktop.

### 4.1 The screen
- A **price chart scrolls right-to-left** continuously. Speed ramps over time (difficulty curve).
- Two always-on meters, top of screen:
  - **P&L meter (top-left):** volatile. Goes up on winning trades, **down (can go negative, flashes red)** on losing trades. This meter is **purely educational/cosmetic** — it is NOT the score and NEVER ends the game.
  - **Rebate jar (top-right):** golden, **monotonic — only ever increases.** This is the hero element. Every trade adds to it.

### 4.2 The action
- Player **taps to fire a trade** at the current candle (cooldown ~0.35 s, show a small cooldown ring).
- Each trade **instantly resolves**: next candle is green (win) or red (loss). Use slight momentum/streakiness so it feels market-like, not pure coin-flip — but outcome is **not** player-skill-determined and the player cannot "predict" it. (Honesty: we are not implying skill beats the market.)
- **On win:** P&L up, green pop, win SFX.
- **On loss:** P&L down, red shake, loss SFX.
- **On EVERY trade regardless of outcome:** a rebate coin flies into the jar with a satisfying particle burst + coin SFX + haptic. ← this is the teaching moment, make it juicy.

### 4.3 Fail state (skill layer)
Score must be earnable through skill, so add a light discipline mechanic:
- Occasionally a candle is flagged **"HIGH SPREAD"** (visually distinct, brief warning telegraph). Trading during a high-spread candle costs **1 life**.
- 3 lives. Lose all → game over.
- This teaches a sliver of cost-awareness without ever implying rebates change outcomes.

### 4.4 Scoring (critical brand rule)
- **Score = total Rebate banked.** Only rebate. The leaderboard ranks who banked the most rebate — **never P&L.** (The whole point: the consistent, rankable, positive thing is the rebate.)
- Rebate per trade = `baseRate × brokerTierMultiplier × comboMultiplier`.

### 4.5 Progression & juice
- **Broker tiers:** every N rebate coins, unlock the next broker (LiteFinance → Vantage Markets → ECMarkets → … "+20 more"). Each tier bumps `brokerTierMultiplier` and shows a broker badge toast. This naturally showcases RebateGain's 23-broker network. Frame as "23 brokers and expanding."
- **Combo multiplier:** consecutive trades without losing a life build a combo that boosts rebate; resets on life loss.
- **Difficulty:** scroll speed and high-spread frequency increase with time/score.
- **Juice budget (do not skip):** screen shake on loss, coin particle bursts, number pop/tween on both meters, subtle bg parallax, snappy SFX (mute toggle), haptic feedback via the Telegram adapter on mobile. Polished feel IS the brand — RebateGain's #1 differentiator is UI/UX, so the game must feel like a premium fintech product, not a cheap flash game.

### 4.6 Game-over screen (the payoff)
Show the two numbers **side by side**, big:

```
Your P&L this run:      −$240   😬   (volatile — sometimes red)
Your Rebate banked:    +$1,180  ✅   (you got paid every single trade)
```

Then the line:
> **"Win or lose, the rebate pays. That's RebateGain."**
> *Rebate doesn't change your P&L — it's paid back to you on top, every trade.*

Buttons: **Play Again** · **Leaderboard** · **Share** · **Get real rebates → RebateGain** (CTA, see §7).

---

## 5. Telegram integration spec (Path A — Gaming Platform)

### 5.1 BotFather setup (document in README, do not automate token handling)
1. `/newbot` → get bot + token.
2. `/setinline` → enable inline mode (mandatory for games).
3. `/newgame` → set title, description, photo, optional GIF, and the **game short name** (unique id).

### 5.2 Runtime flow (implement exactly this)
1. Bot sends the game via `sendGame` (and supports inline mode for sharing). The message shows a **Play** button.
2. User taps Play → bot receives a `callback_query` containing `game_short_name`.
3. Bot answers the callback with the **game URL** (`answerCallbackQuery({ url })`). Append the Telegram-provided context to the URL so the frontend can echo it back later (user/chat/message identifiers or inline_message_id, plus an HMAC you sign).
4. Frontend loads `https://telegram.org/js/games.js` → `TelegramGameProxy` becomes available. Read launch params via `TelegramGameProxy.initParams` and/or the URL fragment.
5. On game over with a new personal best, frontend `POST`s the score + the signed context to `bot /score`.
6. Backend **verifies the HMAC/context**, then calls **`setGameScore`** (with `user_id` + `chat_id` + `message_id`, or `inline_message_id`). The bot — not the browser — holds the token.
7. Leaderboard panel: frontend `GET`s `/highscores`; backend calls **`getGameHighScores`** and returns the list to render in-game.

### 5.3 Security (hard requirements)
- `BOT_TOKEN` only on the server. Never shipped to the client.
- Every `/score` call must carry a server-signed token tying it to a real launch context; reject unsigned or replayed submissions. Rate-limit per user.
- Treat any score from the client as untrusted; clamp to sane bounds and prefer server-side sanity checks (max rebate per second given the cooldown).

### 5.4 Adapter contract (so Path B drops in later)
```ts
interface TelegramAdapter {
  ready(): Promise<void>;
  getUser(): { id?: string; name?: string } | null;
  submitScore(score: number): Promise<void>;     // Games: POST→setGameScore; MiniApp: backend global board
  getLeaderboard(): Promise<LeaderEntry[]>;
  share(): void;                                  // inline share / WebApp share
  haptic(kind: 'success' | 'warning' | 'impact'): void;
  openLink(url: string): void;                    // sign-up CTA
}
```
For **Path B (Mini App)** later: use `window.Telegram.WebApp` (`initData` verified server-side, `HapticFeedback`, `openTelegramLink`, `CloudStorage`, `MainButton`), and a custom backend global leaderboard + referral via start params.

---

## 6. Brand & visual direction

Match **RebateGain** brand: clean, modern, premium **fintech**, dark theme. UI/UX polish is the brand's core differentiator — hold a high bar.

- **Typography:** Inter (RebateGain brand font).
- **Brand assets provided:** `Logo1.png` = the standalone **square icon mark** (use as the in-app brand mark, favicon, and square game icon). `Logo2.png` = the **horizontal lockup** with the "Rebate Gain" wordmark (use on the loading screen and the game-over header).
- **Brand tokens — sampled directly from the official logos. Use these exact values in `brand/tokens.ts`:**
  - **Brand dark / background base** `#101830` (the logo navy). Background `#101830`, surface `#171F3A`, border `#283154`.
  - **Brand blue gradient** `#0A78FF → #2A4BFF` (left→right). Primary brand accent — UI chrome, primary buttons, the brand mark, "brand moment" highlights.
  - **Text** `#FFFFFF`, muted `#8A94A6`.
  - **Functional trading colors** (universal convention, NOT brand colors): **win/up green** `#16C784`, **loss/down red** `#EA3943`. Used ONLY for the P&L meter and hazards.
  - **Rebate gold** `#F5C451` — the hero color for the rebate jar and coins. **Keep it gold on purpose:** it must stay distinct from the brand blue (so it pops) and from the win-green (so the lesson "rebate is NOT the same as winning" stays visually obvious). Do not "correct" rebate to brand blue.
- Coins = gold, jar fills with a glow as it grows. The rebate jar is the most satisfying thing on screen.
- Respect Telegram theme params (`themeParams` / safe-area insets) so it sits cleanly in the webview.

---

## 7. Sign-up funnel & CTA

- Game-over CTA **"Get real rebates → RebateGain"** opens the RebateGain sign-up URL via `adapter.openLink()`, with a tagged deep link: `?utm_source=telegram&utm_medium=game&utm_campaign=rebate_rush` (+ broker tier reached, if useful).
- Make the bridge explicit and honest: the coins in the game are a **score**; real rebates require signing up on RebateGain and connecting a broker.

---

## 8. Compliance / no-go (RebateGain rules — enforce in all copy)

- Never imply rebates change trade outcomes, P&L, or broker behavior. (The game keeps P&L and Rebate strictly separate — preserve that.)
- No "get rich", "guaranteed income", "passive income machine", or overnight-success framing anywhere.
- In-game currency is clearly a **game score**, not real money or a payout promise.
- Don't promise specific rebate rates. Frame the broker network as "23 brokers and expanding."
- Keep it accurate: rebates are paid **on top of** P&L, win or lose — that's the only claim the game makes, and it's true.

---

## 9. Performance & platform requirements

- Bundle < 300 KB gzipped; lazy-load audio. First playable < 2 s on a throttled connection.
- 60 fps target on mid-range Android; degrade particles gracefully on low-end.
- Fully responsive portrait; handle notches/safe areas; works in Telegram webview on iOS + Android + Desktop.
- Pointer + touch + keyboard input. Mute + pause. Visibility change pauses the game.

---

## 10. Definition of Done (acceptance checklist)

- [ ] Core loop playable in a plain browser via `NoopAdapter` (no Telegram needed for dev).
- [ ] Dual-meter HUD: P&L volatile (can go red), Rebate jar monotonic gold.
- [ ] Every trade adds rebate regardless of win/loss, with juice + haptic hook.
- [ ] 3-life high-spread fail mechanic; difficulty ramps.
- [ ] Broker-tier progression showing real RebateGain broker names.
- [ ] Game-over screen with side-by-side P&L vs Rebate + the brand line + CTA.
- [ ] Score = total rebate; leaderboard ranks rebate only.
- [ ] `TelegramAdapter` with Games + MiniApp + Noop implementations; runtime selection.
- [ ] grammY bot: callback→URL, `/score`→`setGameScore`, `/highscores`→`getGameHighScores`, token server-side only, signed/verified submissions.
- [ ] README: BotFather steps, env vars, deploy steps for frontend + bot.
- [ ] All copy passes the §8 compliance list.

---

## 11. How to drive Claude Code (phased — don't one-shot)

1. **Plan:** "Read SPEC.md. Propose folder structure + the `TelegramAdapter` interface + a build plan. No code yet."
2. **Engine:** game loop, input, renderer, audio, particles + a grey-box playable build with `NoopAdapter`.
3. **Gameplay:** trades, dual meters, rebate scoring, high-spread lives, combo, difficulty, broker tiers.
4. **Juice & brand:** tokens, polish, game-over screen, CTA.
5. **Telegram (Path A):** grammY bot + `GamesPlatformAdapter` + score/leaderboard + README/BotFather.
6. **Hardening:** security on `/score`, perf budget, responsive/webview/safe-area pass.
7. **(Later) Path B:** `MiniAppAdapter`, global board, referral.

Commit per phase. Keep the engine free of any Telegram import — that separation is the whole point.
