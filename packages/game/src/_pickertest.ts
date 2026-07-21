import { strict as assert } from 'node:assert';
import { PuzzleBank } from './game/PuzzleBank';
import { Rng } from './engine/Rng';
import { assetClass, BRAND_ASSETS, DROPPED_ASSETS } from './game/config';

/**
 * Forex-first picker checks (PRD-ONBOARDING-TASKS §6, Story 2) — run with
 * `tsx packages/game/src/_pickertest.ts`. Covers: raw class distribution within
 * ±5pp of config, duel determinism (same seed ⇒ identical sequence), the ≥1
 * XAU/EUR brand guarantee per match, SOL dropped, and no in-match asset repeats
 * while alternatives exist.
 */
async function main(): Promise<void> {
  const bank = new PuzzleBank();
  await bank.ready;

  // 1) Raw weighted-draw distribution within ±5pp of {forex .70, commodity .15, crypto .15}.
  const N = 20000;
  const hist = bank.classHistogram(new Rng(12345), N);
  const share = (c: keyof typeof hist): number => hist[c] / N;
  assert.ok(Math.abs(share('forex') - 0.7) <= 0.05, `forex ${share('forex').toFixed(3)}`);
  assert.ok(Math.abs(share('commodity') - 0.15) <= 0.05, `commodity ${share('commodity').toFixed(3)}`);
  assert.ok(Math.abs(share('crypto') - 0.15) <= 0.05, `crypto ${share('crypto').toFixed(3)}`);
  console.log(`raw draw: forex ${(share('forex') * 100).toFixed(1)}% · commodity ${(share('commodity') * 100).toFixed(1)}% · crypto ${(share('crypto') * 100).toFixed(1)}%`);

  // 2) Actual per-match round shares: forex-majority (brand goal ≥ 55% on Lever 1).
  const shares = bank.roundClassShares(new Rng(999), 2000, 5);
  const totalRounds = shares.forex + shares.commodity + shares.crypto;
  const forexShare = shares.forex / totalRounds;
  assert.ok(forexShare >= 0.6, `actual forex round share ${(forexShare * 100).toFixed(1)}% < 60%`);
  console.log(`shown rounds: forex ${(forexShare * 100).toFixed(1)}% over ${totalRounds} rounds`);

  // 3) Determinism: identical seed+level ⇒ identical id sequence (duel invariant).
  for (const seed of [1, 42, 7777, 2 ** 31 - 1]) {
    for (const diff of [undefined, 'easy', 'med', 'hard'] as const) {
      const a = bank.pick(8, new Rng(seed), diff).map((p) => p.id);
      const b = bank.pick(8, new Rng(seed), diff).map((p) => p.id);
      assert.deepEqual(a, b, `nondeterministic for seed ${seed} diff ${diff}`);
    }
  }
  console.log('determinism: identical sequences for equal seed+level ✓');

  // 4) Brand guarantee: every 5-round match has ≥ 1 XAU/USD or EUR/USD.
  let brandMisses = 0;
  for (let s = 0; s < 3000; s++) {
    const match = bank.pick(5, new Rng(s * 31 + 5), s % 2 ? 'med' : 'hard');
    if (!match.some((p) => (BRAND_ASSETS as readonly string[]).includes(p.asset))) brandMisses++;
  }
  assert.equal(brandMisses, 0, `${brandMisses} matches lacked a brand clip`);
  console.log('brand guarantee: every match has XAU/USD or EUR/USD ✓');

  // 5) SOL never appears; asset repeats within a match are only ever FORCED (the
  //    class had no unused asset left — e.g. 4 forex rounds but only 4 forex assets).
  //    Usable distinct assets per class in the full pool: forex 4, commodity 1, crypto 2.
  const DISTINCT: Record<string, number> = { forex: 4, commodity: 1, crypto: 2 };
  let solSeen = 0;
  let unforcedRepeats = 0;
  for (let s = 0; s < 2000; s++) {
    const match = bank.pick(5, new Rng(s + 100));
    const assets = match.map((p) => p.asset);
    if (assets.some((a) => DROPPED_ASSETS.has(a))) solSeen++;
    const byClass: Record<string, string[]> = { forex: [], commodity: [], crypto: [] };
    for (const p of match) byClass[assetClass(p.asset)]!.push(p.asset);
    for (const [cls, list] of Object.entries(byClass)) {
      const distinctUsed = new Set(list).size;
      // A repeat is "unforced" only if we used fewer distinct assets than both the
      // rounds in that class AND the distinct assets available to it.
      if (distinctUsed < Math.min(list.length, DISTINCT[cls]!)) unforcedRepeats++;
    }
  }
  assert.equal(solSeen, 0, 'SOL leaked into a match');
  assert.equal(unforcedRepeats, 0, `${unforcedRepeats} matches repeated an asset unnecessarily`);
  console.log('SOL dropped + asset repeats only when forced by the class weighting ✓');

  console.log('\nPICKER TESTS PASSED ✅');
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
