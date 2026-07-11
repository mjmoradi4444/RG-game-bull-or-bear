/**
 * Leaderboard-path E2E against a local server (SCORE_SECRET=devsecret):
 * sign a launch context exactly like the bot does → POST /score → GET /highscores.
 */
import { signContext } from './security';

const BASE = process.env.LB_BASE ?? 'http://localhost:8082';

async function main(): Promise<void> {
  const gctx = signContext({ u: 4242, n: 'Tester', c: 777, m: 1, t: Date.now() });

  // 1) submit a score like the game does after Quick Play
  const post = await fetch(`${BASE}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gctx, score: 7 }),
  });
  const postBody = (await post.json()) as Record<string, unknown>;
  console.log('POST /score →', post.status, JSON.stringify(postBody));

  // 2) read the board back
  const get = await fetch(`${BASE}/highscores?gctx=${encodeURIComponent(gctx)}`);
  const getBody = (await get.json()) as {
    ok: boolean;
    scores?: Array<{ rank: number; name: string; score: number; isSelf: boolean }>;
  };
  console.log('GET /highscores →', get.status, JSON.stringify(getBody).slice(0, 300));

  const mine = getBody.scores?.find((s) => s.isSelf);
  if (!postBody.ok) throw new Error('score POST failed');
  if (!getBody.ok || !mine || mine.score < 7) throw new Error('board missing my score');

  // 3) lower score must NOT overwrite the best
  await fetch(`${BASE}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gctx, score: 3 }),
  });
  const again = (await (await fetch(`${BASE}/highscores?gctx=${encodeURIComponent(gctx)}`)).json()) as typeof getBody;
  const mine2 = again.scores?.find((s) => s.isSelf);
  if (!mine2 || mine2.score !== mine.score) throw new Error('best-score keep failed');
  console.log('best-score kept after a lower run ✓');

  console.log('\nSERVER LEADERBOARD PATH OK ✅');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
