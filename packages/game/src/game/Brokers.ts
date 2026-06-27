/**
 * In-game broker progression — real RebateGain partner brokers.
 *
 * Ordered by each broker's real "Rebate & cashback terms" score (from
 * Brokers Scores.json), ascending, so every unlock genuinely steps up to a broker
 * with stronger rebate terms — an on-brand way to showcase the network. The
 * `multiplier` and `unlockAt` thresholds are game-tuned. The total count is kept
 * open-ended on purpose (see MORE_BROKERS_LABEL): RebateGain never states a partner
 * count, so the game says "and many more" rather than a number.
 */
export interface BrokerTier {
  name: string;
  /** Rebate-per-trade multiplier once this tier is reached. */
  multiplier: number;
  /** Total rebate banked required to unlock this tier. */
  unlockAt: number;
}

export const BROKER_TIERS: readonly BrokerTier[] = [
  { name: 'Exness', multiplier: 1.0, unlockAt: 0 },
  { name: 'EC Markets', multiplier: 1.2, unlockAt: 150 },
  { name: 'Vantage', multiplier: 1.4, unlockAt: 400 },
  { name: 'FXPro', multiplier: 1.7, unlockAt: 800 },
  { name: 'Alpari', multiplier: 2.0, unlockAt: 1400 },
  { name: 'VT Markets', multiplier: 2.4, unlockAt: 2300 },
  { name: 'LiteFinance', multiplier: 2.9, unlockAt: 3600 },
  { name: 'FiboGroup', multiplier: 3.5, unlockAt: 5500 },
] as const;

/** Shown after the final named tier — keeps the network size open-ended. */
export const MORE_BROKERS_LABEL = 'and many more';
