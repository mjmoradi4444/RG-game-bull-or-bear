# PRD — Seasonal Scoring, Token Economy & Rebate Prizes

**Product:** Bull or Bear (Rebate Rush) — Telegram HTML5 game for RebateGain
**Version:** 1.0 · **Date:** 2026-07-20 · **Status:** Draft for review
**Persian version:** [`PRD-SCORING-TOKENS.fa.md`](PRD-SCORING-TOKENS.fa.md)

---

## 1. Executive Summary

We are replacing the current best-score leaderboard (hard-capped at 15 points) with a **seasonal, cumulative points system (Rush Points — RP)** gated by a **daily token allowance (10 Rush Tokens/day)**. Leaderboards reset **monthly**; the previous season's top 3 are showcased with their **name, avatar, and gold/silver/bronze medals**, and win a real prize: an upgraded **rebate share of 100% / 90% / 80%** on their linked RebateGain account for the entire following month. This turns a one-shot novelty into a daily habit loop and makes "link your RebateGain account" a prerequisite for claiming prizes — directly serving the game's funnel purpose.

---

## 2. Background & Problem Statement

### 2.1 Current state (as implemented in code)

- A match is 5 rounds; each correct call scores `1 × level weight` (Retail ×1, Pro ×2, Whale ×3). Only Quick Play submits `correctCount × weight` to the global board (`Game.ts` §"Quick Play feeds the GLOBAL leaderboard"; live duels and async challenges award **nothing**).
- The bot keeps only the **best single-match score per user** (`leaderboard.ts → recordScore`), so the theoretical ceiling is `5 × 3 = 15` points.
- There is no play limit, no reset, no reward, and no reason to return tomorrow.

### 2.2 Why this is a problem

- **Ceiling monotony:** Several players reach 13–15 within days, then the board freezes. Nothing a player does today can change their rank. (Current data file already shows clustered scores: 9, 7, 7, 5, 4, 4.)
- **No retention loop:** Unlimited free play means no scarcity, no session cadence, no "come back tomorrow."
- **No funnel pressure:** The game's business goal is RebateGain signups (`SIGNUP_URL` CTA), but nothing in the competitive loop requires or rewards a linked account.

### 2.3 Evidence

- Leaderboard persistence keeps `max(score)` only — confirmed in `packages/bot/src/leaderboard.ts`.
- Score cap confirmed by design: `CONFIG.ROUNDS = 5`, max weight 3 (`levels.ts`).
- Product owner feedback: "no player can exceed 15 points and this uniformity is boring."

---

## 3. Goals & Non-Goals

### Goals

| # | Goal | Signal |
|---|------|--------|
| G1 | Make daily play a habit | DAU/MAU ≥ 30%, token utilization ≥ 60% |
| G2 | Make the leaderboard feel alive all month | P90/P50 RP spread ≥ 3×, rank changes daily |
| G3 | Convert players into linked RebateGain accounts | Linked-account conversion from prize flow |
| G4 | Keep matches fair and cheat-resistant | Server-authoritative tokens & scoring |

### Non-Goals

- No real-money wagering, no purchasable tokens (v1). Points and tokens are **never money** (compliance §12).
- No change to core round gameplay (chart playback, 15s decision, 5 rounds).
- No change to the rule that **a duel's winner is decided purely by correct count** — bonuses affect leaderboard RP only, never who wins a match.

---

## 4. Users

- **Competitive player (primary):** plays daily, chases rank, motivated by status and the rebate prize. Often already a trader — prime RebateGain ICP (MT4/MT5 retail traders).
- **Casual player:** plays a few rounds when a friend challenges them. Needs free practice and low-pressure entry.
- **RebateGain (business):** wants measurable game → signup → linked-account conversion.

---

## 5. Solution Overview

Five pillars: **(A)** daily Rush Tokens, **(B)** cumulative Rush Points, **(C)** monthly Seasons with Hall of Fame, **(D)** rebate-share prizes for the top 3, **(E)** engagement mechanics around them.

### 5.A Token economy — Rush Tokens ⚡

| Rule | Value | Rationale |
|------|-------|-----------|
| Daily allowance | **10 tokens/day** per user | ~10 ranked matches ≈ 30–40 min of play; bounds daily RP income so consistency beats grinding |
| Cost | **1 token per ranked match** (Quick Play, live 1v1, async duel) | One clear price, no mental math |
| Refill | Daily at **00:00 UTC**, non-stacking (use it or lose it) | Scarcity + fresh daily reason to open the game |
| Practice mode | **Free, unlimited, 0 RP** | Learning stays free; token-out players keep playing (funnel stays open) |
| Refund | Token refunded if a match aborts before round 1 resolves (no opponent / disconnect) | Fairness; avoids "the game ate my token" |
| Earnable bonus (Phase C) | Up to +5/day: first win of day +1, referred friend plays +1 (max 2), share result card +1 | Turns marketing actions into fuel |
| Enforcement | **Server-side.** `POST /match/start` atomically spends a token and returns a single-use signed `matchToken`; results without a valid matchToken are rejected | Client can't mint plays |

Implementation note: remaining tokens can be computed statelessly as `10 − spent(todayKey)` from a spend ledger — no cron needed for refills.

### 5.B Scoring v2 — Rush Points (RP)

RP is **cumulative for the season** across all ranked matches (this removes the 15-point cap). Per-round base:

| Level | Old pts/correct | New RP/correct | Max base per match (5 correct) |
|-------|----------------|----------------|-------------------------------|
| Retail | 1 | **10** | 50 |
| Pro | 2 | **20** | 100 |
| Whale | 3 | **30** | 150 |

(×10 scale keeps the familiar 1/2/3 ratio but makes totals feel substantial and leaves room for granular bonuses.)

**Match bonuses** (ranked matches only, applied after the 5 base rounds):

| Bonus | Amount | Notes |
|-------|--------|-------|
| Flawless (5/5) | +20 / +40 / +60 (Retail/Pro/Whale) | Equivalent to two extra correct calls |
| Duel win vs human | +30 RP | Async duel win pays when the opponent's result is real (both sides played) |
| Duel win vs AI fill | +15 RP | Halved to prevent bot-farming during dead hours |
| Win streak (consecutive ranked duel wins) | +5 RP × streak, cap +25 | Resets on a loss |
| Sudden-death rounds | **0 RP** | Tie-breaker only — prevents tie-farming |
| Timeout / no call | 0 RP | Unchanged |

**Daily streak multiplier** (applied to the whole match total): `×(1 + 0.05 × min(consecutiveDays − 1, 5))` → day 1 ×1.00, day 2 ×1.05 … day 6+ **×1.25**. Missing a day resets to ×1.00. This is the single strongest daily-return driver.

**Worked example:** Pro level, 4/5 correct, won vs human, day-3 streak:
`(4×20 + 30) × 1.10 = 121 RP`.

**Ceiling math (sanity):** absolute max per match (Whale, flawless, human win, 5-win streak, ×1.25) = `(150+60+30+25) × 1.25 ≈ 331 RP`; absolute daily max ≈ 3,300 RP; realistic active player ≈ 300–800 RP/day → season totals in the 10k–25k range with a wide, meaningful spread.

**Invariant preserved:** duel outcomes are still decided by correct count (then total decision time), exactly as today. RP bonuses are leaderboard-only.

### 5.C Monthly Seasons & Hall of Fame

- A **Season = one calendar month (UTC)**, identified as `YYYY-MM`, displayed as e.g. "Season 8 · August".
- At month end the board **freezes and archives**; a new season starts everyone at 0 RP (fresh-start effect — newcomers always have a chance).
- **Hall of Fame strip** at the top of the leaderboard shows the **previous season's top 3**: avatar (existing `/avatar/:uid` proxy), name, final RP — rank 1 in **gold**, rank 2 **silver**, rank 3 **bronze**, with 🥇🥈🥉 medals. Rank 1 gets the largest, centered podium slot.
- **Final-standings tie-break** (in order): RP → PvP wins → accuracy → fewer matches played → earlier timestamp of final RP.
- **Prize eligibility floor:** ≥ 20 ranked matches in the season (≈ 2 days of tokens) — a lucky afternoon can't win a month.
- Season countdown shown in-game ("Season ends in 3d 4h"); bot pushes a "final 48 hours" reminder.
- Past seasons browsable in a Hall of Fame archive (Phase C).

### 5.D Prizes — rebate share boost

| Final rank | Prize (entire next month) | Display |
|-----------|---------------------------|---------|
| 🥇 1st | **100% rebate share** | Gold |
| 🥈 2nd | **90% rebate share** | Silver |
| 🥉 3rd | **80% rebate share** | Bronze |
| 4–10 (suggested) | Champion badge + 20 bonus tokens banked for next season | — |

- **Definition (transparent, on-brand):** "rebate share" = the percentage of the broker commission RebateGain receives that is passed to the trader. Winners get an upgraded share on their linked account from season close until the next season closes. It is a rate upgrade on real trading — **not** a cash payout and **not** convertible from points.
- **Claim requirements:** Telegram identity linked to an **active RebateGain account** (link flow: bot `/link` → `auth.rebategain.com` OAuth), eligibility floor met, anti-abuse review passed. Unclaimed after **7 days** → prize rolls down to the next rank.
- **Funnel by design:** you cannot claim without a linked account — the prize is the strongest signup driver in the product.
- **Ops (Phase A):** rebate boost applied manually in the RebateGain back office from a season-close report; automated later.

### 5.E Engagement mechanics (making people *want* to spend time)

Ranked by expected impact; phases in §10.

1. **Daily streak flame** (×1.25 at stake) — visible on the title screen; the multiplier players are afraid to lose. *(Phase A)*
2. **Rank-delta feedback:** result screen shows "#31 → #28 (+121 RP)" after every match; leaderboard shows "You're 120 RP behind #3" (goal-gradient / loss-aversion framing). *(Phase A)*
3. **Rival alerts:** bot push "Reza just passed you — you're #7" (rate-limited, opt-out). Telegram-native and nearly free to build. *(Phase B)*
4. **Happy Hour:** one announced hour daily with +10% RP; concentrates players into the same matchmaking window → more real humans, fewer AI fills → better matches. *(Phase B)*
5. **Daily quests:** rotating micro-goals ("3 correct calls on Pro: +30 RP") layered on tokens. *(Phase C)*
6. **Shareable season cards:** end-of-season recap image (rank, RP, accuracy, best streak) + existing challenge links — viral loop. *(Phase B)*
7. **Leagues (Bronze/Silver/Gold/Whale)** by RP bands with promotion cutlines — mid-pack players compete for promotion, not just top 3. *(Phase C)*
8. **Personal bests** (best match RP, best accuracy, best streak) — self-competition for players far from the podium. *(Phase B)*
9. **Scarcity nudges:** "2 tokens left — make them count"; refill countdown when out. *(Phase A)*

Psychology map: scarcity (tokens) · loss aversion (streaks, near-miss copy) · variable reward (chart outcomes) · social proof (podium avatars) · status (medals, leagues) · fresh start (monthly reset).

---

## 6. Detailed Requirements (user stories & acceptance criteria)

### Epic hypothesis

We believe that daily tokens + cumulative seasonal RP + a real rebate prize will lift D7 retention and daily matches per user, because players finally have (a) a reason to return daily, (b) a rank that always can move, and (c) a tangible stake — measured by DAU, token utilization, and linked-account conversions 30 days after launch.

### Story 1 — Daily tokens

*As a player, I receive 10 Rush Tokens daily so I can play ranked matches, and I can always practice for free.*

- [ ] Title screen shows a token chip: `⚡ 7/10` and, when 0, a countdown to the next refill (00:00 UTC).
- [ ] Starting any ranked match calls `POST /match/start`; on success a token is atomically deducted server-side and a single-use `matchToken` is returned.
- [ ] With 0 tokens, ranked buttons are disabled with explanatory copy; **Practice (free)** remains enabled and awards 0 RP.
- [ ] A match that ends before round 1 resolves (no opponent, disconnect during lobby) refunds the token.
- [ ] Tokens do not accumulate across days (hard reset to 10 at 00:00 UTC).

### Story 2 — Cumulative seasonal RP

*As a player, every ranked match adds to my season total so my rank can always improve.*

- [ ] Server computes RP per §5.B from the submitted round results bound to the matchToken; client-displayed RP is presentational only.
- [ ] `season_scores` accumulates: rp, matches, wins, correct, rounds, daily streak state.
- [ ] Result screen animates the breakdown: base + bonuses × streak multiplier, then the new season total and rank delta.
- [ ] Duel winner determination is unchanged (correct count → total time); bonuses never affect it.
- [ ] Sudden-death rounds contribute 0 RP.
- [ ] One RP submission per matchToken; replays rejected (`409`).

### Story 3 — Monthly season reset with Hall of Fame

*As a player, I see a fresh board each month, and last season's champions displayed with their name and photo.*

- [ ] At month boundary (UTC), the season freezes: standings become immutable, winners computed with the §5.C tie-break, archived to `hall_of_fame`.
- [ ] Leaderboard header renders previous top 3 as a podium: avatar + name + final RP, gold/silver/bronze styling, 🥇🥈🥉.
- [ ] Players with no avatar fall back to the existing initial-letter circle (never broken images).
- [ ] Season countdown visible on title + leaderboard screens.
- [ ] New season starts automatically with everyone at 0 RP; no downtime required.

### Story 4 — Top-3 styling on the live board

*As a player, I instantly see who's winning right now.*

- [ ] Current-season rows 1–3 are tinted gold / silver / bronze (existing `colors.rebateGold` for #1) with medal icons.
- [ ] My own row is highlighted and pinned below the list when I'm outside the top 50, showing my exact rank.
- [ ] Rows show: rank, avatar, name, season RP.

### Story 5 — Prize claim

*As a season winner, I claim my rebate boost by linking my RebateGain account.*

- [ ] Season-close bot message to top 3 with prize details and a `/link` CTA (OAuth to `auth.rebategain.com`).
- [ ] Prize state machine: `pending → linked → applied → expired`; unclaimed after 7 days rolls down one rank.
- [ ] In-game "Prizes" sheet explains the 100/90/80% shares, eligibility floor, and full terms; visible to everyone all season.
- [ ] Ops report generated at season close (winners, link status) for manual back-office application (Phase A).

### Story 6 — Streaks & nudges

- [ ] Daily streak increments on the first ranked match of a UTC day; missing a day resets it; multiplier per §5.B.
- [ ] Streak flame + current multiplier shown on title screen and in the result breakdown.
- [ ] "First win of the day" toast; "2 tokens left" nudge at low balance.

### Edge cases

- **Clock/timezone:** all boundaries in UTC; the client renders local time ("refills at 03:30 your time").
- **Name changes:** display name refreshed from Telegram context at each launch (existing behavior).
- **AI-fill matches:** count toward the 20-match eligibility floor; win bonus halved per §5.B.
- **Mid-match season rollover:** the match scores into the season in which its matchToken was issued.
- **Deleted/blocked users:** ineligible for prizes; rolled down.

---

## 7. UX Spec by Screen (summary)

| Screen | Additions |
|--------|-----------|
| Title | Token chip `⚡ n/10`, streak flame ×multiplier, season countdown chip, Prizes entry point |
| Level select | Shows `+10/+20/+30 RP per correct` (replacing +1/+2/+3) |
| Round / reveal | Unchanged (core loop untouched) |
| Result | RP breakdown animation → season total → rank delta; share card CTA |
| Leaderboard | Hall of Fame podium header (prev top 3) → season name + countdown → current rows with top-3 metal styling → pinned self row → Prizes info button |
| Out-of-tokens | Disabled ranked buttons + refill countdown + free Practice CTA + RebateGain CTA |

---

## 8. Technical Design

### 8.1 Storage

Move from the single JSON file to **SQLite (better-sqlite3)** — single-node, atomic token spends, cheap migration. Tables:

```
users(u PK, name, created_at, rg_linked, rg_account_id NULL)
seasons(id PK 'YYYY-MM', starts_at, ends_at, status)          -- status: active|closed
season_scores(season_id, u, rp, matches, wins, correct, rounds,
              streak_days, last_played_day, last_rp_at, PK(season_id, u))
token_ledger(id PK, u, day, delta, reason, match_id NULL, ts)  -- audit trail; remaining = 10 + Σ(bonus) − Σ(spend) for day
match_log(match_id PK, u, mode, level, correct, rp, breakdown_json, opponent_kind, ts)
hall_of_fame(season_id, rank, u, name_snapshot, rp, PK(season_id, rank))
prizes(season_id, rank, u, share_pct, state, claimed_at NULL, PK(season_id, rank))
```

### 8.2 API (extends the existing single bot server)

```
GET  /profile?gctx=…            → { tokens, streakDays, multiplier, season: {id, endsAt}, rp, rank }
POST /match/start {gctx, mode, level}
                                → { matchToken }            | 402 no_tokens | 401 bad_context
POST /match/result {gctx, matchToken, rounds:[{n, call, correct, ms}], won, oppKind}
                                → { rp, breakdown, seasonRp, rank, rankDelta }   | 409 already_scored
GET  /leaderboard?gctx=…&season=current|prev
                                → { season, endsAt, hallOfFame:[…3], rows:[…50], self:{rank, rp} }
GET  /prizes                    → prize terms + current winners' claim state (public copy)
```

`/score` and `/highscores` remain temporarily for backward compatibility during rollout, then are removed. Telegram-native `setGameScore` stays best-effort with the season RP total.

### 8.3 Auth & anti-abuse

- All writes require the existing HMAC-signed `gctx` (unchanged) **plus** the new single-use `matchToken` (HMAC over `{u, matchId, seasonId, level, mode, iat}`).
- Per-match RP hard cap (≈ 331, §5.B) clamps any tampered submission; per-user rate limit already exists.
- Server recomputes RP from submitted rounds; it never trusts a client-computed total. Full server-side validation of round *correctness* against the puzzle seed is Phase C (matches the codebase's planned "Phase 6 server-side scoring").
- AI-fill wins pay half bonus; sudden death pays 0 — the two known farm vectors.
- Monitoring: daily RP distribution, per-level accuracy, flag accounts > 3σ; manual review of the top 10 before prizes are applied (ops runbook).
- Multi-accounting: mitigated by the linked-RebateGain-account requirement (broker-level KYC behind it), the 20-match floor, and logged IP/device heuristics. Residual risk accepted for v1 (see §11).

### 8.4 Season close job

On the first request after month boundary (or a timer): mark season `closed` → compute standings with tie-breaks → write `hall_of_fame` + `prizes(pending)` → open the new season row → bot broadcast (opt-in) → generate ops report. Idempotent; safe on restart.

### 8.5 Migration

Current JSON board is archived and displayed once as "Preseason" in the Hall of Fame archive (no prizes). Season 1 announces via bot broadcast + pinned chat message. No existing scores carry over (fresh start is the point).

---

## 9. Success Metrics

| Type | Metric | Baseline | Target (60 days post-launch) |
|------|--------|----------|------------------------------|
| **North star (business)** | Linked RebateGain accounts via prize/link flow | ~0 | ≥ 5% of MAU |
| Primary engagement | Token utilization (tokens spent ÷ granted, active users) | — | ≥ 60% |
| Primary engagement | D7 retention | baseline TBD (analytics needed) | +50% relative |
| Secondary | Ranked matches / DAU | ~? | ≥ 4 |
| Secondary | % of MAU meeting the 20-match season floor | — | ≥ 25% |
| Secondary | Leaderboard spread (P90 RP ÷ P50 RP) | 1.0–1.5 (capped board) | ≥ 3 |
| Guardrail | Practice-mode share of sessions | — | Does not collapse below 15% (learning path intact) |
| Guardrail | AI-fill rate in live duels | — | Decreases during Happy Hour |
| Guardrail | Cheat-flag rate on top-100 | — | < 2% |

---

## 10. Rollout Plan

| Phase | Scope | Est. |
|-------|-------|------|
| **A — Core loop** | Tokens + `/match/start` + matchToken, RP scoring (base, flawless, win, daily streak), monthly season + reset, Hall of Fame podium, top-3 styling, countdowns, prize terms sheet, SQLite migration, ops report | 2–3 wks |
| **B — Engagement** | Rival alerts, Happy Hour, share cards, personal bests, streak/scarcity nudges polish | 1–2 wks |
| **C — Economy+** | Earnable bonus tokens, daily quests, leagues, season archive browser, server-side round validation, automated prize application | 2–4 wks |

Launch checklist: prize terms page approved by RebateGain (compliance §12) → season boundary announced ≥ 3 days ahead → bot broadcast + pinned message → monitor RP distribution daily for week 1 → rebalance levels next season if any level's RP-EV exceeds 1.6× the others (governance rule, not mid-season).

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| High-volume trader wins → 100% share is costly | Real money | Business sign-off; optional cap on boosted volume (e.g., first N lots/month) — **open question Q2** |
| Multi-accounting for prizes | Prize integrity | Linked-account requirement (KYC at broker), 20-match floor, manual top-10 review, halved AI bonus |
| Whale level dominates RP-EV → everyone plays one level | Monotony returns | Monitor per-level accuracy × weight EV; rebalance weights at season boundaries only |
| Tokens frustrate the most engaged players | Churn of best users | Free unlimited practice; Phase C earnable tokens; communicate refill time clearly |
| Streak multiplier punishes travel/illness gaps | Perceived unfairness | Cap at ×1.25 (gentle); optional "streak freeze" token in Phase C |
| JSON→SQLite migration bug | Data loss | Preseason archive is read-only copy; keep JSON file as backup artifact |
| Regulatory optics: game + broker prizes | Compliance | Prize is a rebate-share upgrade on a regulated product, not gambling winnings; disclaimers stay (§12); legal review before launch |

---

## 12. Compliance & Copy Rules (binding)

- Keep the existing disclaimers: the game is entertainment, not trading advice; **points are a game score, not money or a rebate payout** (`copy.ts` already ships both).
- The prize is a **rebate-share percentage**, never a promised dollar/rate figure (RebateGain no-go: never promise specific rebate rates).
- No "get rich" framing anywhere in season/prize copy. Voice: professional, transparent, specific — e.g., *"Finish #1 this season and RebateGain passes 100% of your broker commission back to you next month. Win or lose, the rebate pays."*
- Tokens are a play allowance, not a currency; not purchasable in v1; state this in the terms sheet.

---

## 13. Out of Scope (v1)

- Purchasable tokens or any real-money entry (deliberate — changes the legal category of the game).
- Weekly sub-leaderboards and team/clan play.
- Changing round mechanics, decision timer, or puzzle difficulty grading.
- Localized season boundaries per timezone (single UTC boundary v1 — see Q1).
- Automated prize application in the RebateGain back office (manual in Phase A).

---

## 14. Open Questions

| # | Question | Owner | Default if undecided |
|---|----------|-------|---------------------|
| Q1 | Reset time: 00:00 UTC or 00:00 Tehran (large Persian-speaking audience)? | Product | UTC (single boundary, simplest ops) |
| Q2 | Cap on prize rebate-boosted volume (e.g., first 200 lots/month)? | Business | No cap; treat as CAC, review after season 1 |
| Q3 | Should async-duel wins pay the +30 bonus only after the opponent actually finishes? | Product | Yes (bonus granted retroactively on completion) |
| Q4 | Minimum matches floor: 20 vs 30? | Product | 20 |
| Q5 | Do we broadcast rank-change pushes to everyone or opt-in only? | Product | Opt-in via bot start prompt |

---

## Appendix A — Scoring quick reference

```
match RP = ( Σ correct × [10|20|30]                 base (Retail|Pro|Whale)
           + flawless [20|40|60]                    if 5/5
           + win bonus [30 human | 15 AI]           ranked duels only
           + win-streak 5×n (cap 25) )              consecutive duel wins
           × daily-streak multiplier                1 + 0.05×min(days−1, 5)  (cap ×1.25)

sudden death rounds: 0 RP · practice: 0 RP · duel winner: correct count → total time (unchanged)
tokens: 10/day, 1 per ranked match, no stacking, refund if match dies before round 1
season: calendar month UTC · prize: 100% / 90% / 80% rebate share next month · floor: 20 matches
```
