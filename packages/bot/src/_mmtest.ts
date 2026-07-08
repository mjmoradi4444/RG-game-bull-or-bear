import WebSocket from 'ws';

/** Fake-clients E2E for the matchmaking server (run against localhost). */
const URL = 'ws://localhost:8081/mm';

interface Msg {
  t: string;
  [k: string]: unknown;
}

function client(name: string): {
  ws: WebSocket;
  next: (type: string, timeoutMs?: number) => Promise<Msg>;
  send: (m: unknown) => void;
} {
  const ws = new WebSocket(URL);
  const inbox: Msg[] = [];
  const waiters: Array<{ type: string; res: (m: Msg) => void }> = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Msg;
    const wi = waiters.findIndex((w) => w.type === m.t);
    if (wi >= 0) waiters.splice(wi, 1)[0]!.res(m);
    else inbox.push(m);
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next: (type, timeoutMs = 5000) =>
      new Promise((res, rej) => {
        const qi = inbox.findIndex((m) => m.t === type);
        if (qi >= 0) return res(inbox.splice(qi, 1)[0]!);
        const timer = setTimeout(() => rej(new Error(`${name}: timeout waiting for '${type}'`)), timeoutMs);
        waiters.push({ type, res: (m) => { clearTimeout(timer); res(m); } });
      }),
  };
}

const open = (ws: WebSocket) => new Promise<void>((r) => ws.on('open', () => r()));

async function main(): Promise<void> {
  // ---- 1) queue → matched, same seed, profiles exchanged -------------------
  const a = client('A');
  const b = client('B');
  await Promise.all([open(a.ws), open(b.ws)]);
  a.send({ t: 'queue', level: 'pro', name: 'Alice' });
  await a.next('queued');
  b.send({ t: 'queue', level: 'pro', name: 'Bob' });
  const [ma, mb] = await Promise.all([a.next('matched'), b.next('matched')]);
  if (ma.seed !== mb.seed) throw new Error('seeds differ');
  const aOpp = (ma.opp as { name: string }).name;
  const bOpp = (mb.opp as { name: string }).name;
  if (aOpp !== 'Bob' || bOpp !== 'Alice') throw new Error(`profiles wrong: ${aOpp}/${bOpp}`);
  console.log(`1) matched OK · seed=${ma.seed} · A sees ${aOpp}, B sees ${bOpp}`);

  // ---- 2) app-level keepalive ----------------------------------------------
  a.send({ t: 'ping' });
  await a.next('pong');
  console.log('2) ping → pong OK');

  // ---- 3) both report 5 rounds TIED (3-3... use 2 correct each), times differ
  for (let n = 1; n <= 5; n++) {
    a.send({ t: 'round', n, correct: n <= 2, ms: 3000 }); // Alice: 2 correct, 15s total
    b.send({ t: 'round', n, correct: n >= 4, ms: 5000 }); // Bob:   2 correct, 25s total
  }
  const [sa, sb] = await Promise.all([a.next('sudden'), b.next('sudden')]);
  if (sa.round !== 6 || sb.round !== 6) throw new Error('sudden round != 6');
  console.log('3) 2-2 tie → SUDDEN DEATH round 6 on both clients OK');

  // ---- 4) sudden death decides it ------------------------------------------
  a.send({ t: 'round', n: 6, correct: true, ms: 4000 });
  b.send({ t: 'round', n: 6, correct: false, ms: 4000 });
  const [fa, fb] = await Promise.all([a.next('final'), b.next('final')]);
  if (fa.winner !== 'you' || fb.winner !== 'opp') throw new Error(`wrong winner: ${fa.winner}/${fb.winner}`);
  if ((fa.you as { score: number }).score !== 3) throw new Error('score wrong');
  console.log(`4) sudden death → A wins 3-2 OK (sudden=${fa.sudden})`);
  a.ws.close();
  b.ws.close();

  // ---- 5) still tied after sudden → time decides ----------------------------
  const c = client('C');
  const d = client('D');
  await Promise.all([open(c.ws), open(d.ws)]);
  c.send({ t: 'queue', level: 'whale', name: 'Cleo' });
  d.send({ t: 'queue', level: 'whale', name: 'Dan' });
  await Promise.all([c.next('matched'), d.next('matched')]);
  // 5 rounds tied; then 3 sudden rounds ALSO tied → time tiebreak (C faster)
  for (let n = 1; n <= 5; n++) {
    c.send({ t: 'round', n, correct: n === 1, ms: 2000 });
    d.send({ t: 'round', n, correct: n === 1, ms: 9000 });
  }
  for (let n = 6; n <= 8; n++) {
    await Promise.all([c.next('sudden'), d.next('sudden')]);
    c.send({ t: 'round', n, correct: true, ms: 2000 });
    d.send({ t: 'round', n, correct: true, ms: 9000 });
  }
  const [fc, fd] = await Promise.all([c.next('final'), d.next('final')]);
  if (fc.winner !== 'you' || fc.onTime !== true) throw new Error(`time tiebreak wrong: ${JSON.stringify(fc)}`);
  if (fd.winner !== 'opp') throw new Error('D should lose on time');
  console.log('5) tied through 3 sudden rounds → decided on TIME (faster wins) OK');
  c.ws.close();
  d.ws.close();

  // ---- 6) forfeit: opponent disconnects mid-match ---------------------------
  const e = client('E');
  const f = client('F');
  await Promise.all([open(e.ws), open(f.ws)]);
  e.send({ t: 'queue', level: 'retail', name: 'Eve' });
  f.send({ t: 'queue', level: 'retail', name: 'Fred' });
  await Promise.all([e.next('matched'), f.next('matched')]);
  e.send({ t: 'round', n: 1, correct: true, ms: 1000 });
  f.ws.close(); // Fred rage-quits
  const fe = await e.next('final');
  if (fe.winner !== 'you' || fe.forfeit !== true) throw new Error(`forfeit wrong: ${JSON.stringify(fe)}`);
  console.log('6) opponent disconnect → win by forfeit OK');
  e.ws.close();

  // ---- 7) cancel: leave the queue -------------------------------------------
  const g = client('G');
  await open(g.ws);
  g.send({ t: 'queue', level: 'pro', name: 'Gil' });
  await g.next('queued');
  g.send({ t: 'leave' });
  await g.next('left');
  console.log('7) queue → cancel (leave) OK');
  g.ws.close();

  console.log('\nALL MATCHMAKING TESTS PASSED ✅');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
