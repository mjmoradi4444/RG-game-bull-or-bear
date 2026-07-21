import { strict as assert } from 'node:assert';
import { computeRp, dayStreakMultiplier, RP_MATCH_CAP, seasonEndsAt, nextRefillAt } from './rp';

/** Unit tests for the RP engine — run with `tsx src/_rptest.ts`. */

// PRD §5.B worked example: Pro, 4/5 correct, won vs human, day-3 streak:
// (4×20 + 30) × 1.10 = 121 RP.  (First consecutive win → no win-streak bonus.)
{
  const r = computeRp('pro', 4, true, 'human', 1, 3);
  assert.equal(r.base, 80);
  assert.equal(r.win, 30);
  assert.equal(r.winStreak, 0);
  assert.equal(r.multiplier, 1.1);
  assert.equal(r.total, 121);
}

// Flawless bonuses are 20/40/60 by level (PRD §5.B).
assert.equal(computeRp('retail', 5, false, 'none', 0, 1).flawless, 20);
assert.equal(computeRp('pro', 5, false, 'none', 0, 1).flawless, 40);
assert.equal(computeRp('whale', 5, false, 'none', 0, 1).flawless, 60);

// AI-fill win pays half the human bonus (PRD §5.B — anti-farm).
assert.equal(computeRp('pro', 3, true, 'ai', 1, 1).win, 15);

// Solo Quick Play never gets a win bonus.
assert.equal(computeRp('pro', 5, true, 'none', 9, 1).win, 0);
assert.equal(computeRp('pro', 5, true, 'none', 9, 1).winStreak, 0);

// Win-streak: +5 per consecutive duel win beyond the first, cap +25.
assert.equal(computeRp('retail', 3, true, 'human', 2, 1).winStreak, 5);
assert.equal(computeRp('retail', 3, true, 'human', 6, 1).winStreak, 25);
assert.equal(computeRp('retail', 3, true, 'human', 99, 1).winStreak, 25);
assert.equal(computeRp('retail', 3, false, 'human', 0, 1).winStreak, 0);

// Daily streak multiplier: day 1 ×1.00 … day 6+ ×1.25 (cap).
assert.equal(dayStreakMultiplier(1), 1);
assert.equal(dayStreakMultiplier(2), 1.05);
assert.equal(dayStreakMultiplier(6), 1.25);
assert.equal(dayStreakMultiplier(60), 1.25);

// Absolute max per match (Whale flawless + human win + max streaks × 1.25) hits the cap.
{
  const r = computeRp('whale', 5, true, 'human', 6, 6);
  assert.equal(r.base + r.flawless + r.win + r.winStreak, 265);
  assert.equal(r.total, Math.min(RP_MATCH_CAP, Math.round(265 * 1.25)));
  assert.ok(r.total <= RP_MATCH_CAP);
}

// A tampered "31 correct" submission clamps to the 5-round base.
assert.equal(computeRp('whale', 31, false, 'none', 0, 1).base, 150);

// UTC calendar helpers.
assert.equal(seasonEndsAt('2026-07'), Date.UTC(2026, 7, 1));
assert.equal(seasonEndsAt('2026-12'), Date.UTC(2027, 0, 1));
assert.ok(nextRefillAt() > Date.now());
assert.equal(new Date(nextRefillAt()).toISOString().slice(11), '00:00:00.000Z');

console.log('rp: all tests passed');
