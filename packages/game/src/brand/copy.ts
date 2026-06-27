/**
 * Every user-facing string in one place, compliance-checked against SPEC §9:
 *
 *  - This is a GAME for entertainment — not trading advice or signals. The
 *    disclaimer is shown on the title (and first reveal).
 *  - No "get rich" / guaranteed / "we'll teach you to beat the market" framing.
 *  - In-game points are clearly NOT money and not a rebate payout.
 *  - No broker counts, no specific rebate rates — network framing stays open-ended.
 *  - The only product claim: rebates are paid on every trade, win or lose — true.
 */

export const COPY = {
  title: 'Bull or Bear',
  tagline: 'Read the chart. Call the next move.',

  // Title modes (SPEC §4.4)
  challenge: 'Challenge a Friend',
  practice: 'Quick Play',
  leaderboard: 'Leaderboard',

  // Round flow
  roundOf: (n: number, total: number): string => `Round ${n} / ${total}`,
  callIt: 'CALL IT',
  buy: 'BUY',
  sell: 'SELL',
  locked: 'Locked',
  correct: 'Correct',
  wrong: 'Wrong',
  noCall: 'No call',

  // Reveal — the rebate hook, kept light (SPEC §6)
  rebateReminder: 'On RebateGain, every trade pays you a rebate — win or lose.',
  verifyLabel: 'Real data',

  // Result / funnel
  matchResult: 'Match result',
  youScored: (correct: number, total: number): string => `You called ${correct} of ${total}`,
  cta: 'Trade for real & earn rebates → RebateGain',
  rematch: 'Rematch',
  share: 'Share',
  back: 'Back',

  // Compliance (SPEC §9)
  disclaimer:
    'A game for entertainment — not trading advice or signals. Past performance does not predict future results.',
  pointsDisclaimer: 'Points are a game score, not money or a rebate payout.',

  // Scaffold placeholder (removed once the round engine lands)
  soonTitle: 'Coming next',
  soonBody: (mode: string): string => `${mode} — the round engine lands in Phase 3.`,
} as const;

/** Sign-up funnel target (SPEC §6) — tagged for this game's campaign. */
export const SIGNUP_URL =
  'https://rebategain.com/signup?utm_source=telegram&utm_medium=game&utm_campaign=bull_or_bear';
