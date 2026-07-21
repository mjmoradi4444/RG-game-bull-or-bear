# PRD — First-Run Tutorial, Forex-First Charts & Task System

**Product:** Bull or Bear (Rebate Rush) — Telegram HTML5 game for RebateGain
**Version:** 1.0 · **Date:** 2026-07-21 · **Status:** Draft for implementation
**Persian version:** [`PRD-ONBOARDING-TASKS.fa.md`](PRD-ONBOARDING-TASKS.fa.md)
**Depends on:** [`PRD-SCORING-TOKENS.md`](PRD-SCORING-TOKENS.md) (RP, tokens, seasons) · [`PRD-ADMIN-EMAIL.md`](PRD-ADMIN-EMAIL.md) (admin panel, email link)

---

## 1. Executive Summary

Three connected changes that fix the first five minutes and the daily middle of the player journey:

1. **Step-by-step tutorial** — an interactive, in-engine first-run guide (spotlight tour + one guided free round) so a new player understands the chart, the BUY/SELL call, levels, tokens, RP, and the leaderboard before their first ranked match — and never feels lost.
2. **Forex-first chart weighting** — the puzzle pool is currently **72% crypto** (BTC/ETH/SOL 216 of 300 clips). For a forex rebate brand this is backwards. We set a target of **~70% forex / 15% commodities / 15% crypto** via a runtime weighted picker now and a dataset rebuild next.
3. **Task system** — one-time tasks (follow socials, link your RebateGain email, finish the tutorial) and rotating daily tasks (play, win, call streaks) that pay **RP**, feeding the seasonal economy from `PRD-SCORING-TOKENS.md` and giving lapsed players a concrete reason to open the game every day.

---

## 2. Background & Problem Statement

### 2.1 Current state (as implemented)

- **No tutorial exists.** A first-time player lands on the title screen and is expected to infer everything: what the playback is, when to call, what levels mean, what tokens/RP/seasons are (grep confirms no tutorial/FTUE code in `packages/game/src`). The game's own design compounds this: playback deliberately runs 13s and the decision window is 15s — a confused player's first round is over before they understand it was a round.
- **Asset mix is crypto-heavy.** `puzzles.json` (300 clips): BTC 72, ETH 72, SOL 72 → **216 crypto (72%)**; EUR/USD 18, GBP/USD 12, USD/JPY 16, XAU/USD 20 → 66 forex (22%); WTI 18 (6%). SOL isn't even in the declared `ASSETS` list in `config.ts` (doc/config drift). `PuzzleBank.pick` optimizes for asset *variety* per match, not asset *class* — so a typical 5-round match shows 3+ crypto charts.
- **No task/quest surface exists.** The only daily driver shipped so far is the token refill and streak multiplier from the scoring PRD.

### 2.2 Why this is a problem

- **Lost players don't return.** The first session decides retention, and today it starts with an unexplained freezing chart and two unlabeled-context buttons. Confusion in minute one is invisible churn — those players never reach the systems we built.
- **Brand mismatch.** RebateGain is a **forex** rebate platform (primary ICP: MT4/MT5 retail forex traders, 23 forex broker partners). A game that mostly shows Solana charts trains the wrong instinct and weakens the funnel claim "this is your world — get paid rebates on it." XAU/USD and EUR/USD are declared brand-non-negotiable in the game's own config comments, yet are 12% of the pool combined.
- **Nothing to do between matches.** Tokens cap play (by design); without tasks there is no structured "do this next," no bridge to our social channels, and no lightweight daily goal for players who won't chase the podium.

### 2.3 Evidence

- Asset counts measured directly from `packages/game/src/data/puzzles.json` (see §2.1).
- `CONFIG.PLAYBACK_MS = 13000`, `DECISION_SECONDS = 15` — a full first round is ~30s with zero guidance.
- Product owner: "we're a forex rebate site, not crypto"; "tutorial needed so users don't get lost."

---

## 3. Goals & Non-Goals

### Goals

| # | Goal | Signal |
|---|------|--------|
| G1 | New players understand the game before their first ranked match | Tutorial completion ≥ 70%; first-session match completion up |
| G2 | The game *feels* forex | ≥ 70% of rounds shown are forex pairs; XAU + EUR present in most matches |
| G3 | Tasks create a daily checklist habit and social growth | ≥ 50% of DAU claims ≥ 1 daily task; social follows attributable to tasks |
| G4 | Task RP never distorts competitive integrity | Task RP ≤ ~5% of a competitive player's season RP |

### Non-Goals

- No changes to round mechanics, timers, or duel win rules.
- No paid/rewarded ads tasks, no crypto-wallet tasks (off-brand).
- Not removing crypto entirely — variety stays, proportions flip (see §12 Q2).
- Tutorial does not teach *trading*; it teaches *the game* (compliance: the game is entertainment, not trading education or advice).

---

## 4. Users

- **Brand-new player (primary for tutorial):** arrived from a challenge link or bot discovery; has ~60 seconds of patience; may not be a trader at all.
- **Returning casual player (primary for tasks):** opens the game when reminded; needs a 2-minute checklist that feels completable.
- **Competitive player:** will optimize whatever we ship — task rewards must be bounded so ranks stay skill-driven.
- **RebateGain (business):** wants forex-native brand exposure and measurable social-channel growth.

---

## 5. Part A — Step-by-Step Tutorial (FTUE)

### 5.1 Principles

- **Show, don't lecture:** the core is a *guided free round*, not slides. Players learn the loop by playing it once with training wheels.
- **Interruptible and replayable:** skippable at any step (with confirm), replayable later from the title menu ("How to play").
- **Server-remembered:** completion stored server-side (`users.tutorial_done`) so a reinstall or second device doesn't re-force it; a local flag mirrors it for offline start.
- **Short:** target ≤ 90 seconds for the tour + ~45 seconds for the guided round.

### 5.2 Flow (10 steps)

**Stage 1 — Welcome (1 step)**

1. First launch → dimmed title screen, one card: *"Read the chart. Call the next move. Let's play one practice round — it takes under a minute."* Buttons: **Start** / Skip tutorial.

**Stage 2 — Guided free round (5 steps)** — a real Retail-difficulty forex puzzle (always forex: EUR/USD or XAU/USD), practice mode, 0 RP, no token cost:

2. Playback begins at normal speed; coach mark: *"A real market chart is playing — this is genuine EUR/USD history."* The existing "tap to skip" is disabled during the tutorial so the player sees the stream.
3. Chart freezes; spotlight on the timer: *"The chart froze. You have 15 seconds to decide."* Timer is paused until the next step is acknowledged.
4. Spotlight on BUY ▲ / SELL ▼: *"Will the next candles go up or down? Lock in your call."* Both buttons pulse; timer resumes (extended to 30s for this round only).
5. Reveal plays; coach mark on the outcome: *"The real future — this is what actually happened next. ✓ means you called it."*
6. Wrap card: *"That's one round. A match is 5 rounds — most correct calls wins."* (If they got it right, celebrate; if wrong, reassure: *"Even pros read charts wrong — that's why rebates pay win or lose."*)

**Stage 3 — Environment tour (4 spotlight steps over real screens)**

7. Level select spotlight: *"Three levels. Harder charts pay more RP per correct call: +10 / +20 / +30."*
8. Title screen, token chip: *"10 Rush Tokens daily. Each ranked match costs 1. Practice is always free."*
9. Title screen, streak flame + season chip: *"Play daily to grow your multiplier. Seasons last one month — top 3 win real rebate upgrades."*
10. Leaderboard spotlight (podium + prizes button): *"Last season's champions live here. Finish top 3 and your RebateGain rebate share goes up for a whole month."* Final card: **Got it — let's play** → grants the tutorial's one-time task reward (§6.4) and returns to the title screen.

### 5.3 UX details

- Spotlight/coach-mark component: dark overlay (75%), cut-out around the target, one sentence of copy (max ~12 words), progress dots (1–10), Back / Next / Skip.
- All copy lives in `brand/copy.ts` alongside existing strings, same compliance rules (no trading-advice framing; the disclaimer card from the title remains).
- Tutorial state machine is its own module (`game/Tutorial.ts`), driven by the same screen enum — no forks inside `Game.ts` render paths beyond overlay hooks.
- Contextual one-time tooltips after the tutorial: the first time each of Multiplayer, Challenge-link, and Prizes screens is opened, a single dismissible tooltip appears (stored per-screen in the same server flag set).
- Re-entry: "How to play" menu item replays the tour only (stage 3) or the full flow — player's choice.

### 5.4 Edge cases

- Player arrived via a **challenge deep link**: the duel is the hook — don't block it. Offer a 1-card micro-intro (*"Your friend scored X/5. Read the chart, call the moves."*), run the duel, then offer the full tutorial after the result screen.
- Skip at any point → mark `tutorial_skipped`; the "How to play" entry gets a one-time attention dot.
- Mid-tutorial disconnect → resume at the same stage on next launch (state saved per step).
- Returning player (has matches recorded but no tutorial flag, i.e. pre-release accounts) → never show the forced flow; only the menu entry.

---

## 6. Part B — Forex-First Chart Weighting

### 6.1 Target distribution

| Asset class | Assets | Current share | Target share |
|-------------|--------|---------------|--------------|
| **Forex** | EUR/USD, XAU/USD*, GBP/USD, USD/JPY (+ future: AUD/USD, USD/CHF) | 22% (66/300) | **~70%** |
| Commodities | WTI (+ XAU if classed here) | 6% | ~15% |
| Crypto | BTC, ETH (drop SOL — it isn't in the declared `ASSETS` list) | 72% | ~15% |

*XAU/USD counts toward the forex bucket for weighting (it's the brand's flagship chart); the split is a config constant, not a hardcode.

### 6.2 Two levers, in order

**Lever 1 — Runtime weighted picker (ships immediately).**
`PuzzleBank.pick` gains a class-weighting pass: before the existing variety/fill logic, each round slot is assigned an asset class by weighted draw from `ASSET_CLASS_WEIGHTS = { forex: 0.7, commodity: 0.15, crypto: 0.15 }` (new constant in `game/config.ts`), then a puzzle of that class/difficulty is drawn. Constraints preserved: deterministic under the seeded `Rng` (duel fairness — both players still get identical puzzles from the same seed), no repeated asset within a match where the pool allows, difficulty tier respected. If a class/difficulty bucket is exhausted, fall back to the next class rather than repeating a clip.

**Lever 2 — Dataset rebuild (required for full effect).**
The current pool cannot honor 70% forex at the Whale tier: forex-hard clips number just 16 vs crypto-hard 72. Re-run `packages/data-pipeline` (Dukascopy source) to produce a ~500-clip pool at roughly: forex ≥ 320 clips balanced across easy/med/hard, WTI ~75, BTC+ETH ~105. Drop SOL from the pool to match the declared `ASSETS` list. Until Lever 2 lands, Lever 1's fallback means Whale matches will still lean crypto — accepted and time-boxed.

### 6.3 Presentation reinforcement

- Pre-roll asset label stays prominent (`GOLD · XAU/USD`, `EUR/USD`) — the brand moment is *recognizing* the pair.
- The rebate reminder line on reveal already says rebates pay on every trade; on forex charts, prefer pair-specific flavor where cheap (*"Traders pay spread on every EUR/USD lot — RebateGain pays some of it back."*). Copy through the usual compliance filter.
- Guarantee: **every match contains ≥ 1 XAU/USD or EUR/USD clip** where the difficulty bucket allows (brand non-negotiables, per the config's own comment).

### 6.4 Verification

Add a dev-only histogram counter (behind a debug flag) logging drawn asset classes per 1,000 picks; CI-adjacent script asserts the empirical distribution is within ±5pp of config weights.

---

## 7. Part C — Task System

### 7.1 Structure

Two tabs in one "Tasks" sheet, opened from a title-screen button with a badge counting claimable rewards:

- **General** (one-time): social follows, account linking, milestones.
- **Daily**: 3 rotating tasks, reset with the token refill at 00:00 UTC.

All rewards are claimed manually (tap **Claim**) — the claim tap is the dopamine moment and the analytics event.

### 7.2 One-time (General) task catalog — launch set

| Task | Reward | Verification |
|------|--------|-------------|
| Complete the tutorial | +2 Rush Tokens (today) | Server flag from §5 |
| Join our Telegram channel | +100 RP | **Verifiable:** bot `getChatMember(channel, user)` |
| Follow RebateGain on Instagram | +50 RP | Click-through claim (unverifiable; see §7.5) |
| Follow RebateGain on X | +50 RP | Click-through claim |
| Subscribe on YouTube | +50 RP | Click-through claim |
| Link your RebateGain email | +150 RP + "Linked" badge | Server flag from `PRD-ADMIN-EMAIL.md` §5 |
| Play your first live duel | +50 RP | Server match log |
| Win your first duel vs a human | +75 RP | Server match log |
| Invite a friend who plays 1 match | +1 Rush Token (max 5 friends) | Referral param on challenge link |

One-time RP is granted **in the season it is claimed** — every player, old or new, gets the same one-shot boost exactly once, so seasonal fairness holds.

### 7.3 Daily task pool — 3 drawn per day (same 3 for all players; server-picked)

| Task | Reward |
|------|--------|
| Play 3 ranked matches | +20 RP |
| Win a duel | +25 RP |
| Make 3 correct calls on Pro or Whale | +25 RP |
| Score 4/5 or better in any match | +30 RP |
| Play a match on a forex chart and get 3+ correct | +20 RP |
| Spend all 10 tokens | +20 RP |
| Share a result card | +15 RP |

Daily task RP cap ≈ 60–75/day — deliberately ~2–10% of an active player's match RP (300–800/day per the scoring PRD), so tasks are seasoning, never the meal. Same-3-for-everyone keeps the leaderboard playing field level and makes tasks a shared daily conversation.

### 7.4 Economy guardrails (binding)

- Total task RP available in a season (all one-times + max dailies) must stay **≤ ~5%** of a realistic competitive season total (~10k–25k RP per the scoring PRD). Launch set: one-times ≈ 500 RP + dailies ≈ 2,100 RP max ≈ 2.6k — within bounds at the top, generous for casuals. Rebalance only at season boundaries.
- Task RP flows through the **same server-side RP pipeline** (`season_scores`) as match RP, tagged `source: task` in `match_log`-style records for audit and analytics.
- Tokens from tasks respect the daily earnable cap from `PRD-SCORING-TOKENS.md` §5.A (base 10, max +5 earned).

### 7.5 Verification honesty (unverifiable socials)

Instagram/X/YouTube follows can't be verified from a Telegram bot. Policy: open the link → the Claim button unlocks after a 30-second delay → claim once, low reward (50 RP). We knowingly pay a small amount for an *intent signal*, not proof — that's why these rewards are ~half the verifiable Telegram-join reward. No retroactive punishment for unfollows (not detectable, not worth the sourness). Documented so nobody later mistakes claims for verified follows.

### 7.6 UI spec

- **Title screen:** "Tasks" button with badge (count of claimable). Subtle pulse when ≥ 1 claimable.
- **Task sheet:** two tabs (Daily / General). Each row: icon, title, reward chip (+25 RP), progress (e.g. 2/3 with bar), and state: locked → in progress → **Claim** (accent color) → claimed ✓ (dimmed). Daily tab header shows reset countdown, synced with the token refill clock.
- Claiming animates the RP flying into the player's season total (same juice as match scoring).
- Empty/complete state for Daily: *"All done — tomorrow's tasks land with your tokens."*

### 7.7 Data model & API (extends prior PRDs' SQLite schema)

```
tasks(id PK, kind, cadence,              -- kind: social|gameplay|account|referral · cadence: once|daily
      title, reward_type, reward_amount, -- reward_type: rp|token
      verify_method,                     -- server|tg_member|click_claim|referral
      url NULL, active, sort)

daily_rotation(day PK 'YYYY-MM-DD', task_ids_json)      -- server-picked 3, same for all

task_progress(u, task_id, day NULL,                     -- day set for daily instances
              state,                                    -- in_progress|completed|claimed
              progress_int, completed_at, claimed_at,
              PK(u, task_id, day))
```

```
GET  /tasks?gctx=…            → { daily:[{task, state, progress}], general:[…], resetAt }
POST /tasks/claim {gctx, taskId, day?}
                              → 200 { reward, newSeasonRp | newTokens }
                              → 409 already_claimed | not_completed
POST /tasks/visit {gctx, taskId}    -- starts the 30s click-claim timer server-side
```

Progress for gameplay tasks is computed server-side from the existing match result submissions — the client never self-reports task completion. Claims are idempotent and rate-limited (existing `rateLimit` helper).

### 7.8 Admin integration (extends `PRD-ADMIN-EMAIL.md`)

New **Tasks** view in the admin panel: CRUD on the task catalog (title, reward, URL, active, sort) without redeploy; daily-pool membership toggle; completion/claim funnel stats per task; all edits audit-logged. Reward amounts are clamped server-side to the §7.4 guardrails (an admin typo cannot mint 10,000 RP).

---

## 8. Requirements (user stories & acceptance criteria)

### Story 1 — First-run tutorial

- [ ] A first launch (no server flag, no local flag) enters the tutorial before anything else; challenge-link arrivals get the micro-intro variant instead (§5.4).
- [ ] All 10 steps render with spotlight, copy, progress dots, Back/Next/Skip; Skip asks for confirmation once.
- [ ] The guided round is free, forex-only, 0 RP, with the extended 30s decision timer and paused-timer explains.
- [ ] Completion sets `users.tutorial_done` server-side and unlocks the tutorial task reward (+2 tokens).
- [ ] "How to play" in the title menu replays tour-only or full flow; replays never re-grant rewards.
- [ ] Mid-tutorial exit resumes at the same step next launch.

### Story 2 — Forex-first picking

- [ ] `ASSET_CLASS_WEIGHTS` exists in `game/config.ts` with the §6.1 targets and is the only source of the ratio.
- [ ] Weighted pick is deterministic per seed: two clients with the same seed and level draw identical puzzle sequences (duel invariant).
- [ ] Every match includes ≥ 1 XAU/USD or EUR/USD clip when the difficulty bucket has one.
- [ ] Class-exhausted buckets fall back gracefully; no clip repeats within a match while alternatives exist.
- [ ] Debug histogram confirms drawn distribution within ±5pp of config over 1,000 picks.
- [ ] Dataset rebuild ticket filed with the §6.2 clip targets; SOL removed from the pool at rebuild.

### Story 3 — Daily tasks

- [ ] At 00:00 UTC the server picks 3 tasks from the daily pool; all players see the same 3.
- [ ] Gameplay progress accrues automatically from server-recorded match results; the sheet reflects it without reopening the app (refresh on screen entry).
- [ ] Claim pays exactly the configured reward into `season_scores` via the standard RP pipeline, tagged `source: task`.
- [ ] Unclaimed completed dailies expire at reset (no banking).
- [ ] Double-claim returns 409 and does not double-pay (idempotent).

### Story 4 — One-time tasks

- [ ] Telegram-join verifies via `getChatMember` at claim time; not-a-member shows "Join first" state.
- [ ] Click-claim socials: link opens, Claim unlocks 30s later server-side (`/tasks/visit` timestamp), claimable once ever.
- [ ] Email-link and tutorial tasks flip automatically when their server flags set (no manual claim gating besides the tap).
- [ ] Referral token grants cap at 5 and require the invitee to complete 1 match.

### Story 5 — Tasks UI

- [ ] Title-screen Tasks button shows a correct claimable count; zero-state hides the badge.
- [ ] Reward claim animates RP into the season total and updates rank delta immediately.
- [ ] Daily tab shows the reset countdown consistent with the token refill clock.

### Edge cases

- Clock skew / day boundary during play: task day is stamped by the server at match submission, matching the token day-key logic.
- Channel membership revoked after claim: reward keeps (no clawback), user can't re-claim.
- Task catalog edited mid-day: in-flight daily instances keep their original definition (snapshot on rotation).
- Season rollover: daily task RP claims after the boundary land in the new season; one-time claims land in whichever season the tap happens.

---

## 9. Success Metrics

| Type | Metric | Target (60 days) |
|------|--------|------------------|
| **Primary** | Tutorial completion rate (of first launches) | ≥ 70% |
| **Primary** | Forex share of rounds actually shown | ≥ 70% (post dataset rebuild); ≥ 55% (Lever 1 only) |
| **Primary** | DAU claiming ≥ 1 daily task | ≥ 50% |
| Secondary | First-session ranked-match completion (new players) | +30% relative |
| Secondary | D1 retention of tutorial completers vs skippers | Completers ≥ 1.5× |
| Secondary | Telegram channel joins via task | Tracked; baseline season 1 |
| Secondary | Email links attributed to the task (vs organic prompt) | Tracked split |
| Guardrail | Task RP as share of top-100 players' season RP | ≤ 5% |
| Guardrail | Time-to-first-ranked-match for new players | Does not exceed +90s vs pre-tutorial |
| Guardrail | Duel determinism (same seed → same puzzles) | 100% (automated test) |

---

## 10. Rollout Plan

| Phase | Scope | Est. |
|-------|-------|------|
| **A1 — Forex weighting (Lever 1)** | `ASSET_CLASS_WEIGHTS`, weighted deterministic picker, XAU/EUR guarantee, debug histogram | 2–3 days |
| **A2 — Tutorial** | Spotlight component, `Tutorial.ts` state machine, guided round, tour, server flag, menu replay, challenge-link variant | 5–7 days |
| **A3 — Tasks core** | Schema + `/tasks` APIs, daily rotation, gameplay auto-progress, Tasks sheet UI, Telegram-join verify, claim pipeline | 5–7 days |
| **B — Tasks extended** | Click-claim socials, referral tokens, admin Tasks view, contextual tooltips, share-card task | 3–5 days |
| **C — Dataset rebuild (Lever 2)** | Data-pipeline run: ~500 clips, forex-majority per §6.2, drop SOL, re-grade difficulties | 2–4 days + review |

Order rationale: A1 is two days of pure win; the tutorial should exist before any new-user marketing push; tasks land last within phase A because they depend on the RP pipeline being live.

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Tutorial adds friction before the fun | New-player drop at step 1 | ≤ 90s tour, skippable, guided round IS gameplay; measure step-level drop-off and cut the weakest steps |
| Forex-hard clip shortage makes Whale crypto-heavy until rebuild | Brand goal partially met | Time-box Lever 2; interim fallback order prefers commodity over crypto |
| Task farming (e.g. share-card spam) | RP inflation | Server-side progress only, per-task caps, §7.4 economy ceiling, admin clamps |
| Unverifiable social claims feel dishonest internally | Misread metrics | §7.5 policy documented; claims labeled "click-through" in analytics and admin stats |
| Same-3 daily tasks don't fit some players (e.g. "win a duel" for practice-only users) | Dead task day | Pool curated so at most 1 of 3 requires a duel win; monitor per-task completion |
| Determinism regression in weighted picker breaks duels | Unfair matches | Property test in CI: same seed+level ⇒ identical sequence; ship behind a flag first |
| Reward tuning wrong at launch | Economy distortion | All amounts in config/DB, admin-editable within clamps; rebalance at season boundary only |

---

## 12. Open Questions

| # | Question | Default if undecided |
|---|----------|----------------------|
| Q1 | Persian localization of tutorial + tasks copy (large FA audience; game copy is EN-only today)? | File as separate i18n initiative; tutorial copy written to be translation-ready (short, no idioms) |
| Q2 | Exact class weights — 70/15/15 vs harder 80/10/10? | 70/15/15; revisit with season-1 data on per-class accuracy/engagement |
| Q3 | Social channel URLs and which networks actually exist at launch? | Marketing to supply; tasks ship disabled until URL set in admin panel |
| Q4 | Should the tutorial's guided round count toward "first match" analytics? | No — tagged `tutorial`, excluded from match KPIs |
| Q5 | Streak-repair task ("play 2 matches to restore yesterday's streak")? | Phase C candidate; pairs with the streak-freeze idea from the scoring PRD |

---

## Appendix A — Quick reference

```
tutorial: 10 steps = welcome (1) + guided free forex round (5) + tour (4)
          skippable · replayable · server flag users.tutorial_done · reward +2 tokens
charts:   ASSET_CLASS_WEIGHTS = forex 0.70 · commodity 0.15 · crypto 0.15
          ≥1 XAU or EUR clip per match · deterministic per seed · SOL dropped at rebuild
tasks:    general (once): tutorial +2⚡ · TG join +100 RP (verified) · IG/X/YT +50 RP (click-claim)
                          email link +150 RP · first duel +50 · first human win +75 · referral +1⚡ ×5
          daily (3/day, same for all): +15…+30 RP each · cap ≈75 RP/day · reset 00:00 UTC with tokens
          guardrail: all task RP ≤ ~5% of a competitive season total · server-side progress only
```
