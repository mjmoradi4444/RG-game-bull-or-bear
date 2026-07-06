# Deployment & Operations Guide — "Bull or Bear"

This is the English deploy guide, written after reviewing the actual source code
(not just the older docs). It covers three things:

1. **What this project is** — the parts and how they fit together.
2. **How to put it online** — from a clean server to a live Telegram game.
3. **Notes & gotchas** — things the code does that the marketing docs don't say.

> There is a Persian version of this guide at [`DEPLOY.fa.md`](DEPLOY.fa.md). Where
> the two disagree, **this file and the code win** — see "Doc drift" at the bottom.

---

## 1. What the project is

**Bull or Bear** is an HTML5 game that runs inside Telegram. A real historical
price chart plays, freezes, and the player calls the next move — **BUY ▲ / SELL ▼** —
on a countdown. Then the real future of that chart is revealed. Whoever reads charts
better wins. It's a marketing funnel for a brokerage/rebate brand ("RebateGain").

### It's a monorepo with three packages

| Package | What it is | Runs on the server? |
|---|---|---|
| `packages/game` | The game itself (TypeScript + Canvas + Vite). Compiles to static files in `dist/`. | **No** — build-time only |
| `packages/bot` | Telegram bot **+** score API **+** web server that serves the game's `dist/`. | **Yes — this is the only long-running process** |
| `packages/data-pipeline` | Offline tool that builds the chart dataset (`puzzles.json`). | **No** — already run; output is committed |

The important architectural fact: **only one service runs in production — the bot.**
It does three jobs at once from a single port:

1. Serves the built game (static HTML/JS/CSS) over HTTP.
2. Exposes the score API (`POST /score`, `GET /highscores`, `GET /health`).
3. Talks to Telegram (sends the game card, signs launch tokens, writes scores).

Because the game and the API are served from the **same origin**, the frontend calls
the API with relative paths (`/score`) and you only need **one domain and one port**.

### The dataset is already built

`packages/game/src/data/puzzles.json` (~1 MB, real OHLC candles from Binance /
Dukascopy) is committed to the repo. **You do not need to run `data-pipeline`** to
deploy. It's only there if you ever want to regenerate or expand the puzzle set.

### How a play actually flows (so you can debug it)

```
Telegram user taps Play
   → Telegram sends a callback_query to the bot
   → bot answers with:  <GAME_URL>#tgctx=<HMAC-signed token>
   → the game opens in a webview, reads #tgctx, plays a match
   → game POSTs { gctx: <token>, score } to /score
   → bot verifies the HMAC signature + expiry, clamps the score,
     records the user's best in .data/leaderboard.json,
     and best-effort calls Telegram setGameScore
   → in-game leaderboard reads GET /highscores
```

The signing key (`SCORE_SECRET`) and the `BOT_TOKEN` **never reach the browser** —
client scores are untrusted and clamped. That's the whole security model (§ below).

---

## 2. Prerequisites

- **Node.js 20 or newer** + npm. (Verified working on Node 24.)
- A **Linux VPS** — any small box is fine (the bot is lightweight).
- A **domain with HTTPS**. Telegram refuses to open a game over plain HTTP. Non‑negotiable.
- A **bot token** from [@BotFather](https://t.me/BotFather).

> ⚠️ **Security warning:** the bot token used during development was pasted into chat
> at some point. **Before going live, get a fresh token** from BotFather with `/token`.
> The token lives only in the server's `.env` and must never be committed.

---

## 3. One-time BotFather setup

Message [@BotFather](https://t.me/BotFather):

1. `/newbot` → give a name and username → copy the **token** (this is `BOT_TOKEN`).
2. `/setinline` → select the bot → turn inline mode **on**. Mandatory for Telegram
   games; sharing won't work without it.
3. `/newgame` → select the bot → set a title (`Bull or Bear`), a short description, a
   640×360 image, and a **short name**: exactly `bullorbear`.
   This must match `GAME_SHORT_NAME` in your env, or the Play button won't work.

---

## 4. Configuration (`.env`)

Create `packages/bot/.env` from the template `packages/bot/.env.example`:

```env
BOT_TOKEN=<fresh-token-from-BotFather>
GAME_SHORT_NAME=bullorbear
GAME_URL=https://game.example.com        # public HTTPS URL of THIS service
SCORE_SECRET=<output of: openssl rand -hex 32>
PORT=8090
ALLOW_ORIGIN=*
```

> **Port choice:** this VPS already runs other apps on **5000** and **5050**, so this
> service uses **8090**. It only needs to listen on localhost — nginx is the only thing
> that talks to it, and nginx is the only thing exposed to the internet. If 8090 is
> also taken, pick any free high port and keep `PORT` and the nginx `proxy_pass` in sync.

- **`SCORE_SECRET`** — generate once with `openssl rand -hex 32` and **never change it**.
  Changing it invalidates every launch token currently in flight (30‑min window).
- **`GAME_URL`** — the public HTTPS URL of this same service. The bot puts it in the
  Play button and appends the signed `#tgctx=…` token to it.
- **`ALLOW_ORIGIN`** — `*` is fine because the game and API share an origin. You can
  tighten it to your domain if you prefer.

> **Do NOT create `packages/game/.env` with `VITE_SCORE_API` set.** Because the bot
> serves the game and the API from the same origin, the frontend uses a relative
> `/score` path automatically. The committed `packages/game/.env.example` shows a
> leftover dev tunnel URL — **ignore it / leave it blank.** Only set `VITE_SCORE_API`
> (and rebuild) if you ever host the API on a *different* domain than the game.

---

## 5. Install, build, run

From the repo root:

```bash
npm install
npm run build -w @rebate-rush/game     # produces packages/game/dist
npm run start -w @rebate-rush/bot      # bot + game server + score API on $PORT
```

**Order matters:** build the game *before* starting the bot — the bot serves
`packages/game/dist`, which doesn't exist until you build.

### Keep it running with pm2

```bash
npm install -g pm2
pm2 start "npm run start -w @rebate-rush/bot" --name bull-or-bear
pm2 save
pm2 startup     # so it comes back after a server reboot
```

### HTTPS with nginx + certbot (this VPS's setup)

The app listens on **localhost:8090**; nginx terminates HTTPS and reverse-proxies to it.
This sits alongside your existing sites — it's just one more `server` block.

Create `/etc/nginx/sites-available/bull-or-bear`:

```nginx
server {
    listen 80;
    server_name game.example.com;          # your subdomain for this game

    # Everything (the game files, /score, /highscores, /health) is one upstream.
    location / {
        proxy_pass         http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # The dataset chunk is ~1 MB and immutable per build — let clients cache it.
    location /assets/ {
        proxy_pass       http://127.0.0.1:8090;
        proxy_set_header Host $host;
        expires          7d;
        add_header       Cache-Control "public, immutable";
    }
}
```

Enable it and add HTTPS:

```bash
sudo ln -s /etc/nginx/sites-available/bull-or-bear /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d game.example.com     # gets the cert + rewrites the block to 443
```

certbot rewrites the `server` block to listen on 443 and auto-redirect 80→443. After
that, `GAME_URL=https://game.example.com`.

> **DNS first:** point an `A` record for `game.example.com` at the VPS before running
> certbot, or the challenge fails. Use a subdomain that isn't already served by your
> other nginx blocks.
>
> **The app never needs a public port.** Do not open 8090 in the firewall — only
> 80/443 (nginx) should be reachable from outside.

### Updating to a new version (manual)

If you ever deploy by hand instead of via CI/CD:

```bash
git pull && npm install
npm run build -w @rebate-rush/game
pm2 restart bull-or-bear
```

Normally you don't — pushing to `main` deploys automatically (next section).

---

## 5b. CI/CD with GitHub Actions

The workflow at [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) does two things:

- **CI** — on every push and pull request: `npm ci`, typecheck the bot, build the game.
  A red check means don't merge.
- **CD** — only after CI passes on `main` (or a manual "Run workflow"): SSH into the
  VPS, `git reset --hard origin/main`, `npm ci`, rebuild the game, `pm2 restart`.

`git reset --hard` is safe here because `.env` and `.data/` are git-ignored — the deploy
never touches your secrets or the leaderboard.

### One-time server bootstrap (do this once, by hand)

CD **updates** an existing checkout; it doesn't set the server up from scratch. So the
first time, on the VPS, do everything in §3–§5 manually:

```bash
git clone https://github.com/mjmoradi4444/RG-game-bull-or-bear.git /srv/bull-or-bear
cd /srv/bull-or-bear
# create packages/bot/.env (§4), npm install, build, and start under pm2 (§5)
pm2 start "npm run start -w @rebate-rush/bot" --name bull-or-bear
pm2 save && pm2 startup
```

The pm2 process name must match what the workflow restarts. It defaults to
`bull-or-bear`; to use a different name, set a repo **variable** `PM2_NAME` (see below)
and name the pm2 process the same thing.

### Required GitHub secrets

Set these in the repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | What it is |
|---|---|
| `VPS_HOST` | Server IP or hostname |
| `VPS_USER` | SSH user that owns the checkout (e.g. `deploy` or your user) |
| `VPS_SSH_KEY` | A **private** SSH key whose public half is in that user's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` | Absolute path of the checkout, e.g. `/srv/bull-or-bear` |
| `VPS_SSH_PORT` | *(optional)* SSH port if not 22 |

> Generate a dedicated deploy key — don't reuse a personal one:
> `ssh-keygen -t ed25519 -f deploy_key -N ""` → put `deploy_key.pub` in the server's
> `~/.ssh/authorized_keys`, paste the private `deploy_key` into `VPS_SSH_KEY`.

### Optional variable

Non-secret settings go under the **Variables** tab (same page as secrets), not Secrets.

| Variable | What it is | Default |
|---|---|---|
| `PM2_NAME` | Name of the pm2 process the deploy restarts | `bull-or-bear` |

Set `PM2_NAME` only if you named the pm2 process something other than `bull-or-bear`
during the one-time bootstrap. The two must match.

### Gotcha: node must be on the non-interactive PATH

`appleboy/ssh-action` runs a **non-login** shell, so if you installed Node via **nvm**,
`npm`/`pm2` won't be on `PATH` and the deploy fails with "npm: command not found." The
workflow sources nvm to handle this. If Node was installed system-wide (apt/`nodesource`)
it's already on `PATH` and nothing extra is needed.

---

## 6. Go-live checklist + smoke test

Before announcing:

- [ ] Bot token is **fresh** (`/token`) and only in the server `.env`.
- [ ] `/setinline` is on and `/newgame` registered with short name exactly `bullorbear`.
- [ ] `SCORE_SECRET` set from `openssl rand -hex 32`.
- [ ] `npm run build -w @rebate-rush/game` succeeded and `packages/game/dist` exists.
- [ ] Domain has HTTPS; `https://<domain>/health` returns `{"ok":true}`.
- [ ] Bot is running under pm2 and you ran `pm2 save`.
- [ ] `packages/bot/.data` is on a **persistent** disk (see leaderboard note below).

**5-minute smoke test inside Telegram:**

1. Send `/start` → the game card with a **Play** button appears.
2. Tap Play → the game opens in a webview. (If not: `GAME_URL` or HTTPS is wrong.)
3. Play one **Quick Play** round → open **Leaderboard** → your name + score should show.
4. Check server logs (`pm2 logs bull-or-bear`) → you should see a `[launch] u=…` line
   and the score being recorded.
5. Test the multiplayer challenge with two real accounts (see §7).

---

## 7. Multiplayer (Challenge a Friend) — what it really does

Two modes:

| | Quick Play | Challenge a Friend |
|---|---|---|
| Goal | Practice + global ranking | Private 1‑v‑1 duel |
| Where the score goes | **Global leaderboard** (weighted by difficulty) | **Nowhere global** — compared only between the two friends |
| Charts | Random each run | **Both players get the exact same 5 charts** |

The duel is **asynchronous and client-side**. The challenge link carries a **seed**
(which decides the 5 charts, the order, and the level) **and the challenger's score**.
The second player plays the same seed; the comparison (You vs Friend → win/lose/tie)
is done in the browser from the data in the link.

**This is fine for a friendly duel, but be honest about the limits:**

1. It's **not real-time** — the two players don't need to be online together.
2. The challenger's score lives **inside the link** and is compared client-side. There
   is **no server validation of the duel result.** Good enough for bragging rights;
   *not* good enough if you ever attach money/prizes to a duel — that would need the
   server-side match endpoints, which are **not built yet** (see §8).
3. A tie stays a tie — the sudden-death tiebreaker is configured but not implemented.
4. The challenge link opens in a browser/webview, not inside the Telegram game card.
   That's expected for this version.

---

## 8. Notes from the code review (read these)

These are things I found reading the source that the other docs gloss over:

- **Only the bot runs, and only one instance of it.** The bot uses Telegram **long
  polling** (`bot.start`), not a webhook. The README mentions "switch to a webhook for
  production," but **no webhook code exists** — long polling is what ships and it's
  perfectly fine for this scale. ⚠️ **Never run two copies of the bot against the same
  token** — long polling will conflict (`409`).

- **The leaderboard is a flat JSON file** at `packages/bot/.data/leaderboard.json`,
  written on every score. On a normal VPS this is fine. On a PaaS with an **ephemeral
  filesystem** (some Railway/Render/Fly setups), mount `.data` on a persistent volume
  or the leaderboard resets on every restart/redeploy.

- **Security model is HMAC + clamp + rate limit** ([security.ts](packages/bot/src/security.ts)):
  every score call must carry a bot-signed `gctx` token (30‑min expiry), scores are
  clamped to `[0, 1_000_000]`, and there's a 1.5s per‑user rate limit. Client input is
  treated as untrusted throughout. This is a reasonable model for a casual game.

- **The current gameplay is 5 rounds with a 15‑second timer.** The values live in
  [config.ts](packages/game/src/game/config.ts) (`ROUNDS: 5`, `DECISION_SECONDS: 15`,
  100 context candles). The README's "4 rounds / 8‑second timer" text is **stale** —
  `config.ts` is the source of truth. Tune gameplay there and rebuild.

- **Doc drift to be aware of:** the README's status section marks Phase 6 as
  incomplete ("Remaining: Mini App `startapp` adapter, server-side duel endpoints,
  webview hardening"), while `DEPLOY.fa.md` presents multiplayer as fully done. The
  reality is what §7 describes: the client-side async duel works; server-side duel
  validation does not exist yet. Deploy with that expectation.

- **No automated tests / CI.** Verification is manual (the smoke test in §6). Type
  checks pass (`npm run typecheck -w @rebate-rush/bot` and the game's `tsc` in build).

- **Build warning is harmless.** The build warns that `puzzles.json` is a >500 KB
  chunk. It's the dataset; it's already lazy-loaded as its own chunk. Nothing to fix.

---

## 9. Quick troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Play button does nothing | `GAME_URL` must be valid HTTPS; bot must be running; check the short name in BotFather matches `bullorbear` |
| Quick Play score not saved | The game must be opened from inside Telegram (the Play button, so `#tgctx` is present); don't change `SCORE_SECRET` between restarts |
| Share sends nothing | `/setinline` must be on; outside Telegram, Share copies the link to the clipboard instead |
| Challenge link shows a different game | The link must be sent intact — the `?startapp=duel_…` / seed param must not be stripped |
| Leaderboard empty after restart | `packages/bot/.data` isn't on a persistent disk |
| `409 Conflict` in bot logs | Two bot instances are polling the same token — run only one |
| Build fails | Node must be 20+; re-run `npm install` |
| `/health` doesn't respond | Bot process isn't running, or nginx `proxy_pass` port ≠ `PORT` in `.env` (both must be 8090) |
| nginx `502 Bad Gateway` | The app isn't listening — check `pm2 logs bull-or-bear`; confirm it says `score API on :8090` |
