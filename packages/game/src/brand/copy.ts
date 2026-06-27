/**
 * Every user-facing string in one place, so the whole game can be compliance-checked
 * at a glance against RebateGain's rules (SPEC §8):
 *
 *  - No "get rich" / guaranteed / passive-income framing.
 *  - In-game coins are clearly a SCORE, not real money or a payout promise.
 *  - No specific rebate rates promised.
 *  - The broker network is kept open-ended — never a count (see [[broker-count-copy-rule]]).
 *  - The only claim made: rebate is paid on top of P&L, win or lose — which is true.
 */

export const COPY = {
  title: 'Rebate Rush',
  tagline: 'Win or lose, the rebate pays.',
  tapToStart: 'Tap to start',
  startHint: 'Tap to trade. Every trade banks rebate.',

  pnlLabel: 'P&L',
  rebateLabel: 'REBATE',

  gameOverTitle: 'Round complete',
  pnlThisRun: 'P&L this run',
  rebateBanked: 'Rebate banked',
  brandLine: 'Win or lose, the rebate pays.',
  explainer: "Rebate doesn't change your P&L — it's paid back to you on top, every trade.",
  scoreDisclaimer: 'In-game coins are a score, not a payout. Real rebates need a RebateGain account + a connected broker.',

  playAgain: 'Play Again',
  leaderboard: 'Leaderboard',
  share: 'Share',
  cta: 'Get real rebates → RebateGain',

  highSpreadHit: 'HIGH SPREAD · −1 life',
  brokerUnlock: (name: string, mul: number): string => `New broker · ${name} ×${mul.toFixed(1)}`,

  leaderboardTitle: 'Top rebate earners',
  leaderboardSubtitle: 'Ranked by rebate banked',
  back: 'Back',
  loading: 'Loading…',
  emptyBoard: 'Be the first to bank rebate.',
} as const;

/** Sign-up funnel target (SPEC §7) — tagged so RebateGain can attribute installs. */
export const SIGNUP_URL =
  'https://rebategain.com/signup?utm_source=telegram&utm_medium=game&utm_campaign=rebate_rush';
