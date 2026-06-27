import type { Rng } from '../engine/Rng';
import type { Outcome } from './types';
import { BROKER_TIERS } from './Brokers';

export interface TradeResult {
  /** Rebate added by this trade — always positive, every single time. */
  rebateGain: number;
  /** Change to the volatile P&L — positive on win, negative on loss. */
  pnlDelta: number;
  /** Index of a broker tier newly unlocked by this trade, else null. */
  unlockedTierIndex: number | null;
}

/**
 * The economic core and the whole brand lesson in code.
 *
 *  - `rebate` is MONOTONIC: it only ever increases. It is the score.
 *  - `pnl` is VOLATILE: it swings up on wins and down on losses, and is allowed to
 *    go negative. It is cosmetic — never the score, never ends the game.
 *
 * The two are computed independently: a trade's rebate does not depend on whether
 * the trade won or lost. That is the only claim the game makes, and it is true.
 */
export class Scoring {
  rebate = 0;
  pnl = 0;
  combo = 0;
  bestCombo = 0;
  tierIndex = 0;
  trades = 0;
  wins = 0;
  losses = 0;

  private readonly baseRate = 10;

  constructor(private readonly rng: Rng) {}

  get brokerMultiplier(): number {
    return BROKER_TIERS[this.tierIndex]!.multiplier;
  }

  /** Combo grows the rebate up to ~3× at a 25-trade streak. */
  get comboMultiplier(): number {
    return 1 + Math.min(this.combo, 25) * 0.08;
  }

  get rebatePerTrade(): number {
    return this.baseRate * this.brokerMultiplier * this.comboMultiplier;
  }

  /** Rebate banked needed for the next tier, or null at the top tier. */
  get nextTierUnlockAt(): number | null {
    const next = BROKER_TIERS[this.tierIndex + 1];
    return next ? next.unlockAt : null;
  }

  /** 0..1 progress from the current tier's threshold to the next. */
  get tierProgress(): number {
    const next = this.nextTierUnlockAt;
    if (next === null) return 1;
    const from = BROKER_TIERS[this.tierIndex]!.unlockAt;
    return Math.min(1, (this.rebate - from) / (next - from));
  }

  applyTrade(outcome: Outcome): TradeResult {
    this.trades++;
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;

    // Rebate — always positive, independent of the outcome.
    const rebateGain = Math.round(this.rebatePerTrade);
    this.rebate += rebateGain;

    // P&L — volatile. Losses bite a little harder than wins reward, so P&L stays
    // genuinely swingy and often dips red while the rebate marches up.
    let pnlDelta: number;
    if (outcome === 'win') {
      this.wins++;
      pnlDelta = this.rng.range(18, 42);
    } else {
      this.losses++;
      pnlDelta = -this.rng.range(22, 50);
    }
    this.pnl += pnlDelta;

    // Unlock any broker tiers the new rebate total crosses.
    let unlockedTierIndex: number | null = null;
    while (
      this.tierIndex < BROKER_TIERS.length - 1 &&
      this.rebate >= BROKER_TIERS[this.tierIndex + 1]!.unlockAt
    ) {
      this.tierIndex++;
      unlockedTierIndex = this.tierIndex;
    }

    return { rebateGain, pnlDelta, unlockedTierIndex };
  }

  /** Reset the streak — called when a HIGH-SPREAD trade costs a life. */
  breakCombo(): void {
    this.combo = 0;
  }
}
