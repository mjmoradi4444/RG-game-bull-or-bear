import { signContext } from './security';

const B = process.env.LB_BASE ?? 'http://localhost:8083';

async function tryBoth(label: string, ageMs: number): Promise<void> {
  const gctx = signContext({
    u: 6100 + Math.floor(ageMs / 3_600_000),
    n: 'AgeTest',
    c: 9,
    m: 2,
    t: Date.now() - ageMs,
  });
  const s = await fetch(`${B}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gctx, score: 4 }),
  });
  const h = await fetch(`${B}/highscores?gctx=${encodeURIComponent(gctx)}`);
  console.log(label, '→ /score', s.status, '· /highscores', h.status);
}

async function main(): Promise<void> {
  await tryBoth('fresh token   ', 0);
  await tryBoth('2h-old token  ', 2 * 3600e3);
  await tryBoth('5h-old token  ', 5 * 3600e3);
  await tryBoth('13h-old token ', 13 * 3600e3);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
