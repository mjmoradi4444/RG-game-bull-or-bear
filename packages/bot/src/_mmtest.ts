/**
 * Fake-clients E2E for the HTTP-polling matchmaking (run against a local server
 * started with shrunken bot pacing, e.g.:
 *   BOT_TOKEN= PORT=8082 SCORE_SECRET=devsecret MM_BOT_FILL_MS=600 MM_BOT_JITTER_MS=1 \
 *   MM_BOT_ROUND_MS=150 MM_BOT_ROUND_JITTER_MS=100 npm start
 */
const BASE = process.env.MM_BASE ?? 'http://localhost:8082';

const BOT_NAMES = ['Alex', 'Nova', 'Marcus', 'Leila', 'Yuki', 'Omar', 'Petra', 'Dario', 'Mina', 'Tomas'];

interface State {
  ok: boolean;
  state?: string;
  seed?: number;
  expect?: number;
  you?: { name: string; avatar: string | null };
  opp?: { name: string; avatar: string | null };
  final?: {
    winner: string;
    onTime?: boolean;
    forfeit?: boolean;
    sudden?: number;
    you: { score: number; ms: number };
  } | null;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as Record<string, unknown>;
}

async function queue(level: string, name: string): Promise<string> {
  const d = await post('/mm/queue', { level, name });
  if (!d.ok || typeof d.pid !== 'string') throw new Error(`queue failed: ${JSON.stringify(d)}`);
  return d.pid;
}

async function state(pid: string): Promise<State> {
  const r = await fetch(`${BASE}/mm/state?pid=${pid}`);
  return (await r.json()) as State;
}

async function waitFor(pid: string, pred: (s: State) => boolean, what: string, ms = 8000): Promise<State> {
  const t0 = Date.now();
  for (;;) {
    const s = await state(pid);
    if (pred(s)) return s;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const round = (pid: string, n: number, correct: boolean, ms: number) =>
  post('/mm/round', { pid, n, correct, ms });

async function main(): Promise<void> {
  // 1) two humans, same level → matched, same seed, crossed profiles
  const a = await queue('pro', 'Alice');
  let sa = await state(a);
  if (sa.state !== 'queued') throw new Error('A should be queued');
  const b = await queue('pro', 'Bob');
  sa = await waitFor(a, (s) => s.state === 'matched', 'A matched');
  const sb = await waitFor(b, (s) => s.state === 'matched', 'B matched');
  if (sa.seed !== sb.seed) throw new Error('seeds differ');
  if (sa.opp!.name !== 'Bob' || sb.opp!.name !== 'Alice') throw new Error('profiles wrong');
  console.log(`1) humans matched · seed=${sa.seed} · A↔${sa.opp!.name}, B↔${sb.opp!.name}`);

  // 2) 2-2 tie → sudden round 6 → A takes it 3-2
  for (let n = 1; n <= 5; n++) {
    await round(a, n, n <= 2, 3000);
    await round(b, n, n >= 4, 5000);
  }
  await waitFor(a, (s) => (s.expect ?? 0) === 6, 'sudden death');
  console.log('2) 2-2 tie → SUDDEN DEATH round 6');
  await round(a, 6, true, 4000);
  await round(b, 6, false, 4000);
  const fa = (await waitFor(a, (s) => !!s.final, 'A final')).final!;
  const fb = (await waitFor(b, (s) => !!s.final, 'B final')).final!;
  if (fa.winner !== 'you' || fb.winner !== 'opp' || fa.you.score !== 3) throw new Error('sudden verdict wrong');
  console.log(`3) sudden death → A wins 3-2 (sudden=${fa.sudden})`);

  // 3) tied through all sudden rounds → time decides
  const c = await queue('whale', 'Cleo');
  const d = await queue('whale', 'Dan');
  await waitFor(c, (s) => s.state === 'matched', 'C matched');
  for (let n = 1; n <= 5; n++) {
    await round(c, n, n === 1, 2000);
    await round(d, n, n === 1, 9000);
  }
  for (let n = 6; n <= 8; n++) {
    await waitFor(c, (s) => (s.expect ?? 0) === n, `sudden ${n}`);
    await round(c, n, true, 2000);
    await round(d, n, true, 9000);
  }
  const fc = (await waitFor(c, (s) => !!s.final, 'C final')).final!;
  if (fc.winner !== 'you' || fc.onTime !== true) throw new Error(`time tiebreak wrong: ${JSON.stringify(fc)}`);
  console.log('4) tied through 3 sudden rounds → decided on TIME (faster wins)');

  // 4) leave mid-match → other side wins by forfeit
  const e = await queue('retail', 'Eve');
  const f = await queue('retail', 'Fred');
  await waitFor(e, (s) => s.state === 'matched', 'E matched');
  await round(e, 1, true, 1000);
  await post('/mm/leave', { pid: f });
  const fe = (await waitFor(e, (s) => !!s.final, 'E final')).final!;
  if (fe.winner !== 'you' || fe.forfeit !== true) throw new Error(`forfeit wrong: ${JSON.stringify(fe)}`);
  console.log('5) opponent leave → win by forfeit');

  // 5) alone in the queue → AI opponent fills in, plays, and a final arrives
  const g = await queue('pro', 'Gil');
  const sg = await waitFor(g, (s) => s.state === 'matched', 'bot fill', 6000);
  if (!BOT_NAMES.includes(sg.opp!.name)) throw new Error(`unexpected bot name: ${sg.opp!.name}`);
  if (sg.opp!.avatar !== null) throw new Error('bot avatar should be null');
  console.log(`6) bot fill OK → matched with AI "${sg.opp!.name}" · seed=${sg.seed}`);
  for (let n = 1; n <= 5; n++) await round(g, n, n % 2 === 0, 3000);
  const fg = (await waitFor(g, (s) => !!s.final, 'G final vs bot', 20000)).final!;
  console.log(`7) bot match resolved → winner=${fg.winner} (you ${fg.you.score})${fg.sudden ? ` after ${fg.sudden} sudden` : ''}`);

  // 6) unknown pid → ok:false (client treats as drop)
  const su = await state('deadbeef');
  if (su.ok !== false) throw new Error('unknown pid should be ok:false');
  console.log('8) unknown pid → ok:false');

  console.log('\nALL MATCHMAKING (HTTP) TESTS PASSED ✅');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
