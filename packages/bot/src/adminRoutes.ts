import type { IncomingMessage, ServerResponse } from 'node:http';
import { config, adminEnabled } from './config';
import {
  adminSecurityHeaders,
  clearFailures,
  clientIp,
  ipAllowed,
  isLockedOut,
  login,
  logout,
  recordFailure,
  sessionAdmin,
  verifyPassword,
} from './admin';
import {
  activeSeasonId,
  adminOverview,
  adminPlayer,
  adminPlayers,
  adminStandings,
  applyPrize,
  auditEntries,
  audit,
  banUser,
  csvWinners,
  evaluateFlags,
  openFlags,
  prizeWorkflow,
  previousSeasonId,
  resolveFlag,
  rollDownPrize,
  setNote,
  setRgAccountRef,
  userName,
  winnersMissingEmail,
} from './store';
import { dashboardPage, loginPage } from './adminHtml';
import { bot } from './bot';

/**
 * Admin dashboard routing (PRD-ADMIN-EMAIL §6). Same-origin only — never sets the
 * game API's CORS wildcard. Returns true when it handled the request. Disabled
 * (404) until ADMIN_USER + ADMIN_PASSWORD_HASH are provisioned.
 */
function html(res: ServerResponse, status: number, body: string): void {
  adminSecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  adminSecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, to: string): void {
  adminSecurityHeaders(res);
  res.writeHead(302, { Location: to });
  res.end();
}
async function readBody(req: IncomingMessage, cap = 8192): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > cap) throw new Error('body too large');
  }
  return data;
}

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/admin')) return false;
  if (!adminEnabled()) {
    json(res, 404, { ok: false, error: 'admin_disabled' });
    return true;
  }
  const ip = clientIp(req);
  if (!ipAllowed(ip)) {
    json(res, 403, { ok: false, error: 'ip_not_allowed' });
    return true;
  }

  // ---- login / logout (no session required) ----
  if (url.pathname === '/admin/login') {
    if (req.method === 'GET') {
      html(res, 200, loginPage());
      return true;
    }
    if (req.method === 'POST') {
      if (isLockedOut(ip)) {
        html(res, 429, loginPage('Too many attempts. Try again in a few minutes.'));
        return true;
      }
      const form = new URLSearchParams(await readBody(req));
      const user = form.get('username') ?? '';
      const pass = form.get('password') ?? '';
      const ok = user === config.adminUser && verifyPassword(pass, config.adminPasswordHash);
      if (!ok) {
        recordFailure(ip);
        audit('anonymous', 'login_fail', 'admin', user || '(blank)', undefined, { ip });
        html(res, 401, loginPage('Invalid credentials.'));
        return true;
      }
      clearFailures(ip);
      login(req, res, user);
      audit(user, 'login', 'admin', user, undefined, { ip });
      redirect(res, '/admin');
      return true;
    }
  }
  if (url.pathname === '/admin/logout' && req.method === 'POST') {
    logout(req, res);
    redirect(res, '/admin/login');
    return true;
  }

  // ---- everything below requires a session ----
  const admin = sessionAdmin(req);

  // Dashboard shell.
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    if (!admin) {
      redirect(res, '/admin/login');
      return true;
    }
    const active = activeSeasonId();
    html(
      res,
      200,
      dashboardPage({
        admin,
        activeSeason: active,
        prevSeason: previousSeasonId(active),
        backofficeUrl: config.backofficeUrl,
      }),
    );
    return true;
  }

  if (url.pathname.startsWith('/admin/api/')) {
    if (!admin) {
      json(res, 401, { ok: false, error: 'unauth' });
      return true;
    }
    return handleApi(req, res, url, admin);
  }

  // Unknown /admin path.
  if (!admin) {
    redirect(res, '/admin/login');
    return true;
  }
  json(res, 404, { ok: false, error: 'not_found' });
  return true;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, admin: string): Promise<boolean> {
  const p = url.pathname.replace('/admin/api', '');
  const body = async (): Promise<Record<string, unknown>> =>
    JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;

  // GET /overview
  if (req.method === 'GET' && p === '/overview') {
    json(res, 200, { ok: true, ...adminOverview() });
    return true;
  }

  // GET /players
  if (req.method === 'GET' && p === '/players') {
    const q = url.searchParams;
    json(res, 200, {
      ok: true,
      ...adminPlayers({
        q: q.get('q') ?? '',
        filter: q.get('filter') ?? '',
        sort: q.get('sort') ?? 'rp',
        page: Number(q.get('page') ?? 1),
      }),
    });
    return true;
  }

  // /players/:u ...
  const pm = /^\/players\/(\d{1,15})(\/(note|ban|account-ref))?$/.exec(p);
  if (pm) {
    const u = Number(pm[1]);
    const sub = pm[3];
    if (req.method === 'GET' && !sub) {
      const detail = adminPlayer(u);
      if (!detail) {
        json(res, 404, { ok: false, error: 'not_found' });
        return true;
      }
      json(res, 200, { ok: true, ...detail });
      return true;
    }
    if (req.method === 'POST' && sub === 'note') {
      setNote(u, admin, String((await body()).note ?? '').slice(0, 2000));
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST' && sub === 'ban') {
      banUser(u, admin, String((await body()).reason ?? '').slice(0, 500));
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST' && sub === 'account-ref') {
      setRgAccountRef(u, admin, String((await body()).ref ?? '').slice(0, 200));
      json(res, 200, { ok: true });
      return true;
    }
  }

  // GET /season/:id/standings
  const sm = /^\/season\/([\d-]+)\/standings$/.exec(p);
  if (req.method === 'GET' && sm) {
    json(res, 200, { ok: true, ...adminStandings(sm[1]) });
    return true;
  }

  // GET /prizes/:season
  const prm = /^\/prizes\/([\d-]+)$/.exec(p);
  if (req.method === 'GET' && prm) {
    json(res, 200, { ok: true, season: prm[1], rows: prizeWorkflow(prm[1]!) });
    return true;
  }

  // POST /prizes/:season/remind
  const rem = /^\/prizes\/([\d-]+)\/remind$/.exec(p);
  if (req.method === 'POST' && rem) {
    const targets = winnersMissingEmail(rem[1]!);
    let notified = 0;
    if (bot) {
      for (const u of targets) {
        try {
          await bot.api.sendMessage(
            u,
            'You won a season prize but we have no email on file. Send /link and reply with your RebateGain email within 7 days to claim your rebate-share boost.',
          );
          notified++;
        } catch {
          /* user may have blocked the bot */
        }
      }
    }
    audit(admin, 'prize_remind', 'season', rem[1]!, undefined, { targets: targets.length, notified });
    json(res, 200, { ok: true, notified, targets: targets.length });
    return true;
  }

  // POST /prizes/:season/:rank/apply | rolldown
  const pam = /^\/prizes\/([\d-]+)\/(\d)\/(apply|rolldown)$/.exec(p);
  if (req.method === 'POST' && pam) {
    const season = pam[1]!;
    const rank = Number(pam[2]);
    const b = await body();
    if (pam[3] === 'apply') {
      const ok = applyPrize(season, rank, admin, {
        share: Number(b.share) || 0,
        effectiveFrom: Number(b.effectiveFrom) || Date.now(),
        effectiveUntil: Number(b.effectiveUntil) || Date.now(),
        backofficeRef: b.backofficeRef ? String(b.backofficeRef).slice(0, 200) : undefined,
        note: b.note ? String(b.note).slice(0, 500) : undefined,
      });
      // Notify the winner their share is live (best-effort).
      if (ok && bot) {
        const w = prizeWorkflow(season).find((x) => x.rank === rank);
        if (w) {
          const until = new Date(Number(b.effectiveUntil) || Date.now()).toISOString().slice(0, 10);
          void bot.api
            .sendMessage(w.u, `Your rebate share is now ${Number(b.share)}% until ${until}. Win or lose, the rebate pays.`)
            .catch(() => {});
        }
      }
      json(res, ok ? 200 : 409, { ok, ...(ok ? {} : { error: 'already_applied_or_missing' }) });
      return true;
    }
    const ok = rollDownPrize(season, rank, admin, String(b.reason ?? '').slice(0, 500) || 'unspecified');
    json(res, ok ? 200 : 409, { ok });
    return true;
  }

  // GET /flags · POST /flags/evaluate · POST /flags/:id/resolve
  if (req.method === 'GET' && p === '/flags') {
    json(res, 200, { ok: true, flags: openFlags().map((f) => ({ ...f, name: userName(f.u) })) });
    return true;
  }
  if (req.method === 'POST' && p === '/flags/evaluate') {
    const open = evaluateFlags();
    json(res, 200, { ok: true, open });
    return true;
  }
  const fm = /^\/flags\/([a-f0-9]{6,})\/resolve$/.exec(p);
  if (req.method === 'POST' && fm) {
    const b = await body();
    const action = b.action === 'exclude' || b.action === 'ban' ? b.action : 'clear';
    const ok = resolveFlag(fm[1]!, admin, action, String(b.note ?? '').slice(0, 500));
    json(res, ok ? 200 : 409, { ok });
    return true;
  }

  // GET /audit
  if (req.method === 'GET' && p === '/audit') {
    const q = url.searchParams;
    json(res, 200, {
      ok: true,
      entries: auditEntries({
        from: q.get('from') ? Number(q.get('from')) : undefined,
        to: q.get('to') ? Number(q.get('to')) : undefined,
        actor: q.get('actor') ?? undefined,
      }).slice(0, 500),
    });
    return true;
  }

  // GET /export/winners.csv?season=
  if (req.method === 'GET' && p === '/export/winners.csv') {
    const season = url.searchParams.get('season') ?? previousSeasonId(activeSeasonId());
    adminSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="winners-${season}.csv"`,
    });
    res.end(csvWinners(season));
    return true;
  }

  json(res, 404, { ok: false, error: 'not_found' });
  return true;
}
