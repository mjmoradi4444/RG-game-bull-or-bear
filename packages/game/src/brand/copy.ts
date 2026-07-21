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

  // Title modes (SPEC §4.4; 'free' practice per PRD-SCORING-TOKENS §5.A)
  challenge: 'Multiplayer',
  practice: 'Quick Play',
  practiceFree: 'Practice',
  leaderboard: 'Leaderboard',

  // Live matchmaking (lobby + VS screen)
  findingOpponent: 'Finding an opponent',
  lobbyHint: 'You’ll be matched with the next player who picks this level.',
  reconnecting: 'Reconnecting',
  mpUnreachable: 'Multiplayer is unreachable right now — please try again.',
  lbError: 'Couldn’t load the leaderboard — reopen the game from the Play button and try again.',
  cancel: 'Cancel',
  vsTitle: 'VS',
  startsIn: (s: number): string => `Starting in ${s}…`,
  suddenDeath: 'SUDDEN DEATH',
  waitingOpponent: 'Waiting for your opponent to finish…',
  wonOnTime: 'Decided on speed — faster total calls win',
  oppLeftWin: 'Opponent left — you win!',
  connectionLost: 'Connection lost — try again',
  suddenCount: (n: number): string => `after ${n} sudden-death round${n > 1 ? 's' : ''}`,

  // Level select (SPEC §5 — difficulty tiers; RP per PRD-SCORING-TOKENS §5.B)
  chooseLevel: 'Choose your level',
  chooseLevelHint: 'Harder levels score more RP per correct call.',
  chooseLevelFreeHint: 'Free practice — no tokens, no RP.',
  ptsPerCorrect: (w: number): string => `+${w * 10} RP`,
  freeNoRp: 'Free · no RP',
  tokenCost: '1 ⚡ per ranked match',

  // Rush Tokens + season chips (PRD §5.A / §5.C)
  tokens: (n: number, max: number): string => `⚡ ${n}/${max}`,
  streakChip: (mult: number): string => `🔥 ×${mult.toFixed(2)}`,
  seasonEndsShort: (t: string): string => `⏳ ${t}`,
  outOfTokens: (t: string): string => `Out of tokens — refills in ${t}. Practice is free.`,
  refillIn: (t: string): string => `Refills in ${t}`,
  startFailed: 'Couldn’t start a ranked match — check your connection and try again.',

  // RP result breakdown (PRD Story 2)
  rpEarned: (rp: number): string => `+${rp} RP`,
  rpBase: 'Base',
  rpFlawless: 'Flawless',
  rpWin: 'Duel win',
  rpWinStreak: 'Win streak',
  rpMultiplier: (m: number): string => `×${m.toFixed(2)} daily streak`,
  seasonTotal: (rp: number, rank: number): string =>
    `Season: ${rp.toLocaleString('en-US')} RP · #${rank}`,
  rankDelta: (from: number, to: number): string => `#${from} → #${to}`,
  rpPending: 'Scoring…',
  rpFailed: 'Couldn’t submit RP — this match may not count.',

  // Season leaderboard + Hall of Fame (PRD §5.C)
  seasonLabel: (name: string): string => `Season · ${name}`,
  seasonEndsIn: (t: string): string => `Season ends in ${t}`,
  hallOfFame: 'Last season’s champions',
  yourRankName: 'You',
  yourRank: (rank: number, rp: number): string =>
    `You · #${rank} · ${rp.toLocaleString('en-US')} RP`,

  // Prizes sheet (PRD §5.D — compliance: share %, never a promised rate/amount)
  prizes: 'Prizes',
  prizesTitle: 'Season Prizes',
  prizeLines: [
    '🥇 1st — 100% rebate share, all next month',
    '🥈 2nd — 90% rebate share, all next month',
    '🥉 3rd — 80% rebate share, all next month',
  ],
  prizeDefinition:
    'Your rebate share is the percentage of the broker commission RebateGain receives that is passed back to you. Winners get an upgraded share on their linked account — a rate upgrade on real trading, not a cash payout.',
  prizeFloor: 'Play at least 20 ranked matches in the season to be eligible.',
  prizeClaim: 'Winners claim via /link in the bot — an active RebateGain account is required.',
  prizeTokensNote: 'Rush Tokens are a daily play allowance, not a currency, and can’t be bought.',
  prizeLinkCta: 'Link your RebateGain account →',

  // Email capture (PRD-ADMIN-EMAIL §5.4 — compliance-checked)
  linkAccount: 'Link your account',
  accountLinked: '✓ Account linked',
  emailTitle: 'Link your RebateGain account',
  emailIntro:
    'Enter the email you registered with on rebategain.com. We use it only to find your account and apply your prize if you win.',
  emailSave: 'Save email',
  emailUpdate: 'Update',
  emailRemove: 'Remove email',
  emailNoAccount: 'Don’t have an account yet? Create one →',
  emailPrivacy: 'Your email is stored only for prize delivery. Not shared, not used for marketing.',
  emailSaved: 'Saved. Finish top 3 this season and we’ll raise your rebate share on this account.',
  emailInvalid: 'That doesn’t look like a valid email.',
  emailDidYouMean: (s: string): string => `Did you mean ${s}?`,
  emailChangeLimit: 'You’ve changed your email too many times this season — contact support.',
  emailFrozen: 'Email changes are locked while prizes are being applied.',
  emailRateLimited: 'Please wait a moment and try again.',
  emailNetwork: 'Couldn’t save — check your connection and try again.',
  emailChangesLeft: (n: number): string => `${n} change${n === 1 ? '' : 's'} left this season`,
  emailPrompt: 'You’re in the running — add your RebateGain email to be eligible for the prize.',

  // Tasks (PRD-ONBOARDING-TASKS §7.6)
  tasks: 'Tasks',
  tasksDaily: 'Daily',
  tasksGeneral: 'General',
  tasksClaim: 'Claim',
  tasksClaimed: 'Claimed ✓',
  tasksGo: 'Go',
  tasksLocked: 'Locked',
  tasksReward: (type: string, amt: number): string => (type === 'token' ? `+${amt} ⚡` : `+${amt} RP`),
  tasksProgress: (a: number, b: number): string => `${a}/${b}`,
  tasksResetIn: (t: string): string => `Resets in ${t}`,
  tasksDailyDone: 'All done — tomorrow’s tasks land with your tokens.',
  tasksClaimedToast: (amt: number, type: string): string =>
    type === 'token' ? `+${amt} Rush Tokens!` : `+${amt} RP claimed!`,
  tasksNotYet: 'Not done yet — keep playing.',
  tasksJoinFirst: 'Join the channel first, then claim.',

  // Tutorial / FTUE (PRD-ONBOARDING-TASKS §5). Short, translation-ready, no idioms.
  howToPlay: 'How to play',
  tutStart: 'Start',
  tutSkip: 'Skip tutorial',
  tutNext: 'Next',
  tutBack: 'Back',
  tutGotIt: 'Got it — let’s play',
  tutSkipConfirm: 'Skip the tutorial? You can replay it anytime from the menu.',
  tutConfirmSkip: 'Skip',
  tutConfirmStay: 'Keep going',
  tut: [
    'Read the chart. Call the next move. Let’s play one practice round — under a minute.',
    'A real market chart is playing — this is genuine forex history.',
    'The chart froze. Take your time — read the trend.',
    'Will the next candles go up or down? Tap BUY or SELL to lock your call.',
    'The real future — this is what actually happened next. ✓ means you called it.',
    'That’s one round. A match is 5 rounds — most correct calls wins.',
    'Three levels. Harder charts pay more RP per correct call: +10 / +20 / +30.',
    '10 Rush Tokens daily. Each ranked match costs 1. Practice is always free.',
    'Play daily to grow your streak multiplier. Seasons last one month.',
    'Finish top 3 and your RebateGain rebate share goes up for a whole month.',
  ] as string[],

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
 * Sign-up funnel target (SPEC §6). RebateGain site target.
 */
export const WEBSITE_URL = 'https://rebategain.com/';
export const CREATE_ACCOUNT_URL = 'https://auth.rebategain.com/login';
export const SIGNUP_URL = WEBSITE_URL;

