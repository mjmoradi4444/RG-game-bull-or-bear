# PRD — Admin Dashboard & In-Game Email Capture

**Product:** Bull or Bear (Rebate Rush) — Telegram HTML5 game for RebateGain
**Version:** 1.0 · **Date:** 2026-07-21 · **Status:** Draft for implementation
**Persian version:** [`PRD-ADMIN-EMAIL.fa.md`](PRD-ADMIN-EMAIL.fa.md)
**Depends on:** [`PRD-SCORING-TOKENS.md`](PRD-SCORING-TOKENS.md) (seasons, RP, prizes)

---

## 1. Executive Summary

We are building two connected pieces that make the seasonal rebate prize actually deliverable:

1. **In-game email capture** — a lightweight screen where a player enters the email address they used to register on rebategain.com, stored against their Telegram user ID. No verification code in v1 (see §12 Q1); the email is treated as a *matching hint*, not proof of identity.
2. **Admin dashboard** — a password-protected web route (`/admin`) on the existing bot server, showing player data, season standings, and a season-close workflow that hands the operator an exact list of winners with their emails, so their rebate share can be raised manually in the RebateGain back office and marked as applied.

The design keeps the operator in the loop for money-affecting actions while structuring the data so a future RebateGain API can automate the last step without a rewrite.

---

## 2. Background & Problem Statement

### 2.1 Current state

- The bot stores only `{u, name, score, ts}` per player (`packages/bot/src/leaderboard.ts`). There is **no way to contact a player, identify them on the website, or review their activity**.
- There is **no operator surface at all** — no dashboard, no export, no audit log. Everything would be read off a JSON file by hand.
- `PRD-SCORING-TOKENS.md` promises a 100% / 90% / 80% rebate share to the season's top 3, but nothing in the system connects a Telegram player to a RebateGain account.

### 2.2 The problem

**The prize is unclaimable.** A player wins Season 1 as "Reza" with Telegram ID `847392011`. The operations team opens the RebateGain back office and has no way to know which of ~thousands of accounts that is. Without an identity bridge, the whole prize mechanic — the strongest signup driver in the product — cannot ship.

Secondary problem: **we're flying blind.** No dashboard means no way to see whether tokens are being consumed, whether RP is distributed sanely, whether someone is cheating, or how many players ever link an account.

### 2.3 Why now

Both pieces are hard dependencies of Phase A in `PRD-SCORING-TOKENS.md`. Season 1 cannot close without them.

---

## 3. Goals & Non-Goals

### Goals

| # | Goal | Signal |
|---|------|--------|
| G1 | Every season winner can be located in the RebateGain back office within minutes | Time-to-apply < 10 min per winner |
| G2 | Operators can see game health without SSH or reading JSON | Dashboard covers all §6 views |
| G3 | Email capture converts well without blocking play | ≥ 40% of active players submit an email |
| G4 | Every prize action is auditable | 100% of applied prizes have an actor + timestamp |
| G5 | Manual flow today, API-ready tomorrow | Swapping in an API touches one module |

### Non-Goals

- Not a CRM. No email campaigns, no segmentation, no marketing automation from this panel (v1).
- Not a replacement for the RebateGain back office. The panel never becomes the source of truth for rebate rates — it records intent and confirmation.
- No email verification codes in v1 (decision recorded in §12 Q1 with the risk accepted in §11).
- No multi-tenant admin roles in v1 (single admin role; see §12 Q3).

---

## 4. Users

**Operator / Growth admin (primary).** RebateGain team member who runs the season close: reviews winners, checks for abuse, copies emails into the back office, raises rebate shares, marks them applied. Needs speed and unambiguous data — not analytics depth.

**Player (secondary).** Wants the prize. Will give an email if the ask is clear, low-friction, and obviously connected to winning something real. Distrusts unexplained data collection.

**Engineer / on-call (tertiary).** Uses the dashboard to sanity-check token spend, RP distribution, and anomaly flags after a release.

---

## 5. Part A — In-Game Email Capture

### 5.1 Placement & triggers

The email screen is reachable and prompted from several points, all dismissible:

| Trigger | Behavior | Rationale |
|---------|----------|-----------|
| Title screen chip | Persistent "Link your account" / "✓ Account linked" chip | Always available, never nagging |
| Result screen, after a match ends in top 20 | One-time prompt: "You're in the running — add your RebateGain email to be eligible for the prize" | Asks when the prize feels real |
| Prizes sheet | Primary CTA inside the prize terms | Contextual, high-intent |
| Season close, if a winner has no email | Bot DM with a deep link straight to the screen | Last-chance recovery |

Hard rule: **the ask is never modal-blocking before a match**, and never gates gameplay. Prompt at most once per 24h per player; a dismissal is remembered.

### 5.2 Screen spec

```
┌─────────────────────────────────────┐
│  ← Back                             │
│                                     │
│   Link your RebateGain account      │
│                                     │
│   Enter the email you registered    │
│   with on rebategain.com. We use it │
│   only to find your account and     │
│   apply your prize if you win.      │
│                                     │
│   ┌───────────────────────────────┐ │
│   │ you@example.com               │ │
│   └───────────────────────────────┘ │
│                                     │
│   [        Save email        ]      │
│                                     │
│   Don't have an account yet?        │
│   Create one →  (SIGNUP_URL)        │
│                                     │
│   Your email is stored only for     │
│   prize delivery. Not shared, not   │
│   used for marketing.               │
└─────────────────────────────────────┘
```

Post-save state shows the masked email (`re••••@gmail.com`) with an "Update" action.

Implementation note: the game is a `<canvas>` app with no DOM inputs. Use an HTML `<input>` overlaid on the canvas (positioned via the existing `Viewport` scaling) rather than building a canvas keyboard — it gets native mobile keyboards, autofill, and accessibility for free. This is the one screen where the canvas-only rule is deliberately broken.

### 5.3 Validation & storage rules

- **Client:** trim, lowercase, RFC-5322-lite regex, max 254 chars. Reject obvious typos in TLDs (`gmial.com`, `gmail.co`) with a soft "Did you mean …?" suggestion.
- **Server:** re-validate (never trust the client), normalize (lowercase, strip dots for gmail-style comparison **only** for duplicate detection — store the original as typed).
- **Duplicates:** if the same normalized email is submitted by a different Telegram ID, accept it but flag both records `duplicate_email` for admin review. Do not silently reject — legitimate cases exist (shared family device), and abuse cases need to be *visible*, not blocked.
- **Change limit:** max 3 email changes per season per player; further changes require admin action. Every change is written to `email_history` (never overwritten in place).
- **Freeze:** email changes are locked from season close until prizes are applied, so a winner cannot swap in someone else's account after the fact.

### 5.4 Copy (compliance-checked)

Matches the voice rules in `SOUL.md` and the game's existing compliance posture:

- Ask: *"Enter the email you registered with on rebategain.com. We use it only to find your account and apply your prize if you win."*
- Confirmation: *"Saved. If you finish in the top 3 this season, we'll raise your rebate share on this account."*
- No account: *"Don't have a RebateGain account yet? Create one — it takes a minute, and rebates start paying on your next trade."*
- Privacy line: *"Your email is stored only for prize delivery. Not shared, not used for marketing."*

The privacy line is binding — if marketing use is ever wanted, the copy and consent must change first (§11).

### 5.5 API

```
POST /account/email  { gctx, email }
     → 200 { ok: true, masked: "re••••@gmail.com", changesLeft: 2 }
     → 400 { ok: false, error: "invalid_email" }
     → 409 { ok: false, error: "change_limit" | "frozen" }
     → 401 { ok: false, error: "bad_context" }

GET  /account?gctx=…
     → { masked | null, changesLeft, emailSetAt, eligible: bool }
```

Auth uses the existing HMAC-signed `gctx` (`packages/bot/src/security.ts`) — unchanged. Rate limit: 5 writes/hour/user, reusing the existing `rateLimit` helper.

---

## 6. Part B — Admin Dashboard

### 6.1 Access & security

- Served by the **existing bot server** at `/admin` (decision confirmed: one domain, one service, one deploy).
- **Auth:** username + password (`ADMIN_USER`, `ADMIN_PASSWORD_HASH` in env; bcrypt or scrypt hash — never a plaintext password in env), issuing an HttpOnly, Secure, SameSite=Strict session cookie with a 12-hour TTL. Session secret from the existing `SCORE_SECRET` family, separate key.
- **Rate limiting:** 5 failed logins per IP per 15 min → 15-minute lockout. All attempts logged.
- **Hardening:** `/admin*` sets `Cache-Control: no-store`, `X-Frame-Options: DENY`, and a strict CSP. It is excluded from the CORS `Access-Control-Allow-Origin: *` that the game API uses — admin routes are same-origin only.
- **Audit log:** every state-changing admin action writes `{actor, action, target, before, after, ts}` to an append-only table. This is non-negotiable for anything touching prizes.
- Optional hardening for later: IP allowlist, and a Telegram second factor (bot sends a 6-digit code to the admin's chat on login).

### 6.2 Views

**1. Overview (landing)**

Season header (name, days remaining, active players) and health tiles:

- DAU / MAU, new players today
- Tokens granted vs spent today (utilization %)
- Matches played today, split ranked / practice, human / AI-fill
- Email capture rate (players with email ÷ active players)
- Anomaly count awaiting review
- Sparklines for the last 30 days on each tile

**2. Players**

Searchable, sortable table — the workhorse view.

| Column | Notes |
|--------|-------|
| Avatar + name | Via existing `/avatar/:uid` proxy |
| Telegram ID | Copyable |
| Email | Full address (admins need it to search the back office), with copy button |
| Email status | none / provided / duplicate-flagged / frozen |
| Season RP | Current season |
| Rank | Current season |
| Matches / Wins / Accuracy | Season totals |
| Streak | Current daily streak |
| Tokens today | Spent / granted |
| First seen / Last seen | Relative time |
| Flags | Anomaly badges (§6.3) |

Filters: has email · no email · duplicate email · flagged · eligible (≥20 matches) · top 50. Search by name, Telegram ID, or email. Row click → player detail drawer with full match history (`match_log`), RP breakdown per match, email change history, and admin notes.

**3. Season & Standings**

Live standings with the same tie-break rules as `PRD-SCORING-TOKENS.md` §5.C, plus an eligibility column (met the 20-match floor? has an email?). Two banners the operator needs before close:

- ⚠️ "3 of the current top 10 have no email on file" → one-click "Send email reminder" (bot DM to those players).
- ⚠️ "Player #2 is flagged for review."

**4. Prize Workflow (the core screen)**

Available once a season closes. For each of ranks 1–3:

```
🥇  Rank 1 · Reza M.               100% rebate share
    Telegram 847392011 · reza••••@gmail.com  [copy] [copy TG ID]
    Season RP 18,430 · 142 matches · 61% accuracy · no flags
    Eligibility: ✅ 20-match floor  ✅ email on file  ✅ review passed
    State: ● pending

    [ Open RebateGain back office ↗ ]   [ Mark as applied ]   [ Roll down ↓ ]
```

- **Mark as applied** opens a small form: rebate share applied (pre-filled 100/90/80), effective from/until dates (pre-filled with the next season boundaries), optional back-office reference ID, and notes. On submit the prize moves to `applied` and the audit log records the actor.
- **Roll down** moves the prize to the next rank (used for unreachable winners, no email after 7 days, or a confirmed abuse case) with a mandatory reason.
- A **7-day claim countdown** is shown per prize, per `PRD-SCORING-TOKENS.md` §5.D.
- **Export CSV** of the winner list (rank, name, Telegram ID, email, RP, share %, effective dates) for teams who prefer working from a sheet.
- **Expiry reminder:** when a prize period is about to end, the panel flags it so the elevated share is rolled back — an easy thing to forget, and forgetting it costs real money.

**5. Anomalies & Review**

Queue of flagged accounts with the reason and evidence, and actions: clear flag, exclude from prizes this season, ban. Flags are advisory — a human always decides.

**6. Audit Log**

Filterable, read-only, exportable. Every admin action, forever.

### 6.3 Anomaly detection rules (v1, heuristic)

| Flag | Rule | Why |
|------|------|-----|
| `accuracy_outlier` | Season accuracy > 3σ above the mean at ≥30 matches | Human chart-reading has a realistic ceiling |
| `duplicate_email` | Same normalized email on ≥2 Telegram IDs | Multi-accounting for prizes |
| `token_anomaly` | Ranked matches recorded > tokens spent | Client tampering / replay |
| `speed_outlier` | Median decision time < 1.5s across a season | Automation, not reading |
| `burst_play` | > 10 ranked matches in 20 minutes | Scripting |
| `late_email` | Email first added after season close | Post-hoc account swap |

All flags surface in the Players view and the Review queue. None auto-ban.

### 6.4 Data model additions

Extending the SQLite schema in `PRD-SCORING-TOKENS.md` §8.1:

```
users            + email TEXT NULL
                 + email_normalized TEXT NULL        -- for duplicate detection
                 + email_set_at INTEGER NULL
                 + email_changes INTEGER DEFAULT 0
                 + rg_account_ref TEXT NULL          -- back-office ID once matched
                 + banned INTEGER DEFAULT 0

email_history(id PK, u, email, set_at, source)       -- append-only

admin_users(id PK, username, password_hash, created_at, last_login_at)

admin_sessions(token PK, admin_id, created_at, expires_at, ip)

audit_log(id PK, actor, action, target_type, target_id,
          before_json, after_json, note, ts)          -- append-only

flags(id PK, u, season_id, kind, evidence_json, state, created_at, resolved_by, resolved_at)
                                                      -- state: open|cleared|actioned

prizes           + applied_by TEXT NULL
                 + applied_at INTEGER NULL
                 + share_applied INTEGER NULL         -- what was actually set
                 + effective_from INTEGER NULL
                 + effective_until INTEGER NULL
                 + backoffice_ref TEXT NULL
                 + rolled_down_reason TEXT NULL
```

### 6.5 Admin API

```
POST /admin/login          {username, password}        → session cookie
POST /admin/logout                                     → 204
GET  /admin/api/overview                               → health tiles + sparklines
GET  /admin/api/players?q=&filter=&sort=&page=         → paginated rows
GET  /admin/api/players/:u                             → detail + match history + email history
POST /admin/api/players/:u/note      {note}
POST /admin/api/players/:u/ban       {reason}
GET  /admin/api/season/:id/standings                   → standings + eligibility
POST /admin/api/season/:id/close                       → idempotent manual trigger
GET  /admin/api/prizes/:season                         → prize states
POST /admin/api/prizes/:season/:rank/apply
                 {share, effectiveFrom, effectiveUntil, backofficeRef?, note?}
POST /admin/api/prizes/:season/:rank/rolldown  {reason}
POST /admin/api/prizes/:season/remind                  → bot DM to winners missing email
GET  /admin/api/flags?state=open
POST /admin/api/flags/:id/resolve    {action, note}
GET  /admin/api/audit?from=&to=&actor=
GET  /admin/api/export/winners.csv?season=
```

All `/admin/api/*` routes require a valid admin session; all mutations write to `audit_log`.

### 6.6 Tech choice

Server-rendered HTML with a small amount of vanilla JS, served by the existing Node server — no React, no build step, no second deploy target. The panel is a handful of tables and forms used by a few people; a SPA would add a toolchain for no user-visible benefit. Chart.js from CDN for the sparklines if desired.

---

## 7. Part C — Rebate Application Workflow

The end-to-end path, with the manual step clearly bounded (per your decision: manual now, API later).

```
Season closes (UTC month boundary)
   │
   ├─ System freezes standings, computes top 3 (tie-breaks per SCORING PRD §5.C)
   ├─ Writes hall_of_fame + prizes(state=pending)
   ├─ Bot DMs winners: "You finished #1 — confirm your RebateGain email"
   └─ Panel shows the Prize Workflow screen
        │
        ├─ Winner HAS email ────────────────────────────────┐
        │                                                    │
        └─ Winner has NO email → bot reminder → 7-day timer  │
                 └─ still none → Roll down (logged)          │
                                                             ▼
                                          Operator opens RebateGain back office
                                          Searches the email → finds account
                                                             │
                              ┌──────────────────────────────┤
                              │                              │
                        Account found                  Not found
                              │                              │
              Raise rebate share to 100/90/80%     Mark "unmatched" + note
              Set effective dates                  → DM player to correct email
                              │                    → 7-day timer → roll down
                              ▼
                    Panel: "Mark as applied"
                    (share, dates, ref, note → audit log)
                              │
                              ▼
                    Bot DM: "Your rebate share is now 100% until <date>"
                              │
                              ▼
                 Panel flags expiry at period end → roll back
```

**API-readiness:** all back-office interaction is confined to one module (`rebategain-adapter`) with two functions — `findAccountByEmail(email)` and `setRebateShare(accountRef, pct, from, until)`. In v1 both are *manual implementations*: the first returns "operator searches manually," the second records what the operator did. When RebateGain exposes an API, only this module changes; the panel, schema, states, and audit log stay identical.

---

## 8. Requirements (user stories & acceptance criteria)

### Story 1 — Player submits their email

*As a player, I enter the email I registered with on rebategain.com so I can receive my prize if I win.*

- [ ] Email screen reachable from the title chip and the Prizes sheet at any time.
- [ ] Native keyboard appears on mobile (HTML input overlay, `type="email"`, autofill enabled).
- [ ] Invalid format shows an inline error and does not submit; common TLD typos show a "Did you mean …?" suggestion.
- [ ] On success: masked email displayed, confirmation copy shown, title chip switches to "✓ Account linked".
- [ ] Email is never required to play; dismissing the prompt never blocks a match.
- [ ] Prompt appears at most once per 24 hours, and not at all after an email is saved.

### Story 2 — Player updates their email

- [ ] "Update" action pre-fills nothing (typed fresh) and warns: *"This replaces the email we'll use to find your account."*
- [ ] Max 3 changes per season; on exceeding, copy explains to contact support.
- [ ] Every change appends to `email_history` with source and timestamp.
- [ ] Changes are blocked between season close and prize application (`frozen`, HTTP 409).

### Story 3 — Admin logs in securely

- [ ] `/admin` unauthenticated redirects to `/admin/login`.
- [ ] Correct credentials set an HttpOnly + Secure + SameSite=Strict cookie, 12h TTL.
- [ ] 5 failed attempts per IP per 15 min triggers a 15-minute lockout; all attempts logged.
- [ ] Logout invalidates the session server-side (not just cookie deletion).
- [ ] No admin route is reachable cross-origin.

### Story 4 — Admin reviews players

- [ ] Players table loads ≤ 2s for 10,000 rows (server-side pagination, indexed).
- [ ] Search by name / Telegram ID / email returns results in ≤ 500ms.
- [ ] Every filter in §6.2 works and is URL-encoded (shareable links between team members).
- [ ] Email column has a one-click copy button, with a visible "copied" confirmation.
- [ ] Row click opens a detail drawer with match history, RP breakdowns, email history, and flags.

### Story 5 — Admin closes a season and applies prizes

- [ ] Prize Workflow lists ranks 1–3 with name, avatar, Telegram ID, full email, RP, eligibility checks, and flags.
- [ ] "Mark as applied" requires share %, effective from, and effective until; ref and note optional.
- [ ] Applying moves the state to `applied`, records actor + timestamp, and triggers the winner DM.
- [ ] "Roll down" requires a reason, moves the prize to the next eligible rank, and logs both sides of the move.
- [ ] Winners missing an email are visually distinct and cannot be marked applied.
- [ ] CSV export contains exactly the columns in §6.2.4 and opens cleanly in Excel (UTF-8 BOM, so Persian names aren't mangled).

### Story 6 — Admin reviews anomalies

- [ ] All §6.3 rules evaluate nightly and on season close.
- [ ] Review queue shows reason and evidence (e.g. the matches behind a speed flag).
- [ ] Clear / exclude-from-prizes / ban each require a note and write to the audit log.
- [ ] Excluded players are skipped by the prize workflow with a visible reason.

### Story 7 — Audit trail

- [ ] Every mutating admin action writes `{actor, action, target, before, after, note, ts}`.
- [ ] The audit log is append-only; no admin UI can edit or delete entries.
- [ ] Filterable by date, actor, and action; exportable as CSV.

### Edge cases

- Player provides an email that doesn't exist in RebateGain → "unmatched" state, DM to correct it, 7-day timer, then roll down.
- Player signs up on the site *after* winning → operator re-checks; the `late_email` flag is advisory only, not disqualifying by itself.
- Two players share one email (family) → both flagged; operator decides; prize goes to one account.
- Player changes email between winning and application → blocked by the freeze rule (§5.3).
- Admin marks a prize applied by mistake → cannot delete, but can apply a correcting action; both remain in the audit log.
- Bot is offline at season close → close job is idempotent and runs on the next request; DMs queue and retry.

---

## 9. Success Metrics

| Type | Metric | Target |
|------|--------|--------|
| **Primary** | Season winners successfully matched to a RebateGain account | ≥ 90% (before roll-down) |
| Primary | Email capture rate among active players | ≥ 40% by end of season 1 |
| Primary | Operator time to apply all 3 prizes | < 30 min total |
| Secondary | Email capture rate among the top 20 | ≥ 80% |
| Secondary | Prizes applied within 48h of season close | 100% |
| Secondary | Email→account match rate on first attempt | ≥ 85% |
| Guardrail | Match-start rate after adding email prompts | No measurable drop |
| Guardrail | Duplicate-email flag rate | < 3% of submissions |
| Guardrail | Admin actions without an audit entry | 0 |

---

## 10. Rollout Plan

| Phase | Scope | Est. |
|-------|-------|------|
| **A1 — Email capture** | Email screen + HTML input overlay, `/account/email` + `/account`, schema additions, validation, prompt logic, copy | 4–5 days |
| **A2 — Admin core** | Login + sessions + hardening, Overview, Players table + detail drawer, audit log | 5–7 days |
| **A3 — Prize workflow** | Standings + eligibility, Prize Workflow screen, apply / roll-down, CSV export, winner DMs, `rebategain-adapter` module | 4–5 days |
| **B — Review & polish** | Anomaly rules + review queue, sparklines, expiry reminders, email reminder DMs, admin Telegram 2FA | 4–6 days |
| **C — Automation** | RebateGain API integration inside the adapter (find + set), auto-apply with operator confirmation, scheduled roll-back at period end | Blocked on API availability |

**Ships before Season 1 closes:** A1, A2, A3. B and C can follow.

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Unverified email → wrong person's rebate raised | Money to the wrong account | Operator verifies the account exists and looks plausible before applying; freeze rule; audit log; `late_email` flag. Accepted risk of the "collect only" decision — revisit if it bites once (§12 Q1) |
| Admin panel breached | Full player data exposure | Hashed password, strict cookies, lockout, no CORS, no framing, optional IP allowlist + Telegram 2FA in Phase B |
| Player typo in email | Prize undeliverable | Client-side TLD suggestions, masked confirmation after save, reminder DM before close, 7-day window |
| Storing emails (privacy/GDPR-shaped duty) | Legal exposure | Purpose-limited copy that is binding, no marketing use without new consent, deletion on request, no third-party sharing, encrypted at rest via disk-level encryption |
| Multi-accounting via multiple emails | Prize integrity | `duplicate_email` flag, accuracy/speed outliers, 20-match floor, manual top-10 review |
| Operator forgets to roll back an elevated share | Ongoing revenue leak | Expiry flag in the panel + scheduled reminder; automate in Phase C |
| Panel becomes an unofficial CRM | Scope creep, compliance drift | Non-goal stated in §3; any marketing use requires a new consent flow first |

---

## 12. Open Questions

| # | Question | Decision / Default |
|---|----------|-------------------|
| Q1 | Email verification codes? | **Decided: no verification in v1** (collect only). Revisit if the first season produces a mismatched or disputed prize |
| Q2 | Should the panel show emails in full, or masked with a reveal action? | Default: full for admins (the whole point is back-office search), but every reveal is audit-logged if we later mask |
| Q3 | Multiple admin accounts with roles (viewer vs operator)? | Default: single admin role in v1; add roles when more than 2 people use it |
| Q4 | Should players be able to delete their email from within the game? | Default: yes, via the same screen — simplest privacy posture, and cheap to build |
| Q5 | Does the RebateGain back office expose a stable account URL we can deep-link to from the panel? | Ask the web team; if yes, the "Open back office ↗" button becomes a direct link per winner |

---

## Appendix A — Environment variables

```
ADMIN_USER=admin
ADMIN_PASSWORD_HASH=<bcrypt/scrypt hash>     # never a plaintext password
ADMIN_SESSION_SECRET=<random 32+ bytes>      # separate from SCORE_SECRET
ADMIN_IP_ALLOWLIST=                          # optional, comma-separated
ADMIN_TELEGRAM_IDS=                          # optional, for Phase B 2FA DMs
REBATEGAIN_BACKOFFICE_URL=                   # optional, for the deep-link button
```

## Appendix B — Season-close operator checklist

1. Open `/admin` → Season & Standings; confirm the season shows `closed`.
2. Review the Anomalies queue; resolve anything touching the top 10.
3. Open Prize Workflow; confirm all three winners have an email and pass eligibility.
4. For each winner: copy email → find the account in the back office → raise the share to 100/90/80% → set effective dates → return to the panel → **Mark as applied** with the back-office reference.
5. Confirm all three winner DMs were delivered.
6. Export the winners CSV and file it with the season report.
7. Set a calendar reminder for the period end (roll the shares back) — or confirm the panel's expiry flag is armed.
