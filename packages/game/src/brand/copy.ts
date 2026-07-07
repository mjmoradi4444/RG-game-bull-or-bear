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
  challenge: 'Multiplayer',
  practice: 'Quick Play',
  leaderboard: 'Leaderboard',

  // Live matchmaking (lobby + VS screen)
  findingOpponent: 'Finding an opponent',
  lobbyHint: 'You’ll be matched with the next player who picks this level.',
  cancel: 'Cancel',
  vsTitle: 'VS',
  startsIn: (s: number): string => `Starting in ${s}…`,
  suddenDeath: 'SUDDEN DEATH',
  waitingOpponent: 'Waiting for your opponent to finish…',
  wonOnTime: 'Decided on speed — faster total calls win',
  oppLeftWin: 'Opponent left — you win!',
  connectionLost: 'Connection lost — try again',
  suddenCount: (n: number): string => `after ${n} sudden-death round${n > 1 ? 's' : ''}`,

  // Level select (SPEC §5 — difficulty tiers)
  chooseLevel: 'Choose your level',
  chooseLevelHint: 'Harder levels score more per correct call.',
  ptsPerCorrect: (w: number): string => `+${w} per correct`,

  // Round flow
  roundOf: (n: number, total: number): string => `Round ${n} / ${total}`,
  callIt: 'CALL IT',
  callHint: 'Up or down next?',
  buy: 'BUY',
  sell: 'SELL',
  locked: 'Locked',
  correct: 'Correct',
  wrong: 'Wrong',
  noCall: 'No call',
  nextRound: 'Next round',
  seeResult: 'See result',

  // Reveal — the rebate hook, kept light (SPEC §6)
  rebateReminder: 'On RebateGain, every trade pays you a rebate — win or lose.',
  verifyLabel: 'Real data',

  // Result / funnel
  matchResult: 'Round complete',
  youScored: (correct: number, total: number): string => `You called ${correct} of ${total}`,
  accuracyLabel: 'accuracy',
  playAgain: 'Play Again',
  cta: 'Start earning rebates →',
  /** Small brand chip on the title — the campaign hook, kept light. */
  titleCta: 'Win or lose, the rebate pays →',
  tapToSkip: 'tap to skip ›',
  rematch: 'Rematch',
  share: 'Share',
  back: 'Back',
  menu: 'Menu',
  streak: 'STREAK',
  bestStreak: 'Best streak',

  // Async duel (SPEC §4)
  you: 'You',
  vs: 'vs',
  youWin: 'You win!',
  youLose: 'You lose',
  tie: 'Tie',
  shareToChallenge: 'Share this link to challenge a friend',
  incomingChallenge: (name: string, score: number, total: number): string =>
    `⚔ ${name} challenged you — beat ${score}/${total}!`,
  challengeMsg: (correct: number, total: number): string =>
    `I scored ${correct}/${total} on the RebateGain Trading Duel. Can you beat me?`,

  // Compliance (SPEC §9)
  disclaimer:
    'A game for entertainment — not trading advice or signals. Past performance does not predict future results.',
  pointsDisclaimer: 'Points are a game score, not money or a rebate payout.',
} as const;

/** Friendly, brand-relevant display name for an asset (SPEC §2 pre-roll examples). */
const ASSET_LABELS: Record<string, string> = {
  'XAU/USD': 'GOLD · XAU/USD',
  WTI: 'OIL · WTI',
  BTC: 'BITCOIN',
  ETH: 'ETHEREUM',
  SOL: 'SOLANA',
};

export function assetLabel(asset: string): string {
  return ASSET_LABELS[asset] ?? asset;
}

/** Human label for a data source, shown in the verify chip (SPEC §3.4). */
export function sourceLabel(source: string): string {
  if (source === 'dukascopy') return 'Dukascopy';
  if (source === 'binance') return 'Binance';
  if (source === 'alphavantage') return 'Alpha Vantage';
  if (source === 'forexite') return 'Forexite';
  return source;
}

/**
 * Sign-up funnel target (SPEC §6). RebateGain's auth entry — it starts its own
 * OAuth/PKCE flow, so we link the clean login URL rather than a one-time authorize
 * link (those carry single-use code_challenge/state that only work for one session).
 */
export const SIGNUP_URL = 'https://auth.rebategain.com/login';
