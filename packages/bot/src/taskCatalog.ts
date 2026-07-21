/**
 * Task catalog (PRD-ONBOARDING-TASKS §7). Static launch definitions + types.
 * The store seeds its editable catalog from DEFAULT_TASKS on first boot; the admin
 * panel can then edit rewards/URLs/active without a redeploy (clamped to §7.4).
 *
 * Reward integrity (§7.4): task RP must stay a small fraction of a season total,
 * so every reward is clamped server-side — an admin typo can't mint 10,000 RP.
 */

export type TaskKind = 'social' | 'gameplay' | 'account' | 'referral' | 'milestone';
export type TaskCadence = 'once' | 'daily';
export type RewardType = 'rp' | 'token';
/** How completion is proven. server = auto from a server flag / match log;
 *  tg_member = getChatMember; click_claim = open link then 30s unlock; referral. */
export type VerifyMethod = 'server' | 'tg_member' | 'click_claim' | 'referral';

export interface TaskDef {
  id: string;
  kind: TaskKind;
  cadence: TaskCadence;
  title: string;
  rewardType: RewardType;
  rewardAmount: number;
  verifyMethod: VerifyMethod;
  /** Progress target (matches/correct/etc.); 1 for boolean tasks. */
  target: number;
  /** External link (socials) — the click-claim opens this. */
  url?: string;
  /** For tg_member tasks: the @channel to check membership of. */
  channel?: string;
  active: boolean;
  sort: number;
}

/** Hard clamps (§7.4) — reward amounts can never exceed these, whoever edits them. */
export const MAX_TASK_RP = 200;
export const MAX_TASK_TOKENS = 2;
/** Click-claim unlock delay after visiting a social link (§7.5). */
export const CLICK_CLAIM_DELAY_MS = 30_000;
/** Referral token cap (§7.2). */
export const REFERRAL_TOKEN_CAP = 5;

export function clampReward(type: RewardType, amount: number): number {
  const n = Math.max(0, Math.floor(amount || 0));
  return type === 'token' ? Math.min(MAX_TASK_TOKENS, n) : Math.min(MAX_TASK_RP, n);
}

// ---- launch catalog ---------------------------------------------------------

export const DEFAULT_TASKS: TaskDef[] = [
  // One-time (General) — §7.2. Socials ship INACTIVE until a URL/channel is set in
  // the admin panel (§12 Q3), so we never show a dead "Follow" button.
  { id: 'tutorial', kind: 'milestone', cadence: 'once', title: 'Complete the tutorial', rewardType: 'token', rewardAmount: 2, verifyMethod: 'server', target: 1, active: true, sort: 10 },
  { id: 'tg_join', kind: 'social', cadence: 'once', title: 'Join our Telegram channel', rewardType: 'rp', rewardAmount: 100, verifyMethod: 'tg_member', target: 1, channel: '', active: false, sort: 20 },
  { id: 'ig_follow', kind: 'social', cadence: 'once', title: 'Follow RebateGain on Instagram', rewardType: 'rp', rewardAmount: 50, verifyMethod: 'click_claim', target: 1, url: '', active: false, sort: 30 },
  { id: 'x_follow', kind: 'social', cadence: 'once', title: 'Follow RebateGain on X', rewardType: 'rp', rewardAmount: 50, verifyMethod: 'click_claim', target: 1, url: '', active: false, sort: 40 },
  { id: 'yt_sub', kind: 'social', cadence: 'once', title: 'Subscribe on YouTube', rewardType: 'rp', rewardAmount: 50, verifyMethod: 'click_claim', target: 1, url: '', active: false, sort: 50 },
  { id: 'email_link', kind: 'account', cadence: 'once', title: 'Link your RebateGain email', rewardType: 'rp', rewardAmount: 150, verifyMethod: 'server', target: 1, active: true, sort: 60 },
  { id: 'first_duel', kind: 'gameplay', cadence: 'once', title: 'Play your first live duel', rewardType: 'rp', rewardAmount: 50, verifyMethod: 'server', target: 1, active: true, sort: 70 },
  { id: 'first_human_win', kind: 'gameplay', cadence: 'once', title: 'Win your first duel vs a human', rewardType: 'rp', rewardAmount: 75, verifyMethod: 'server', target: 1, active: true, sort: 80 },
  { id: 'referral', kind: 'referral', cadence: 'once', title: 'Invite a friend who plays a match', rewardType: 'token', rewardAmount: 1, verifyMethod: 'referral', target: 5, active: true, sort: 90 },

  // Daily pool — §7.3 (3 are rotated in per day, same for everyone).
  { id: 'd_play3', kind: 'gameplay', cadence: 'daily', title: 'Play 3 ranked matches', rewardType: 'rp', rewardAmount: 20, verifyMethod: 'server', target: 3, active: true, sort: 100 },
  { id: 'd_win', kind: 'gameplay', cadence: 'daily', title: 'Win a duel', rewardType: 'rp', rewardAmount: 25, verifyMethod: 'server', target: 1, active: true, sort: 110 },
  { id: 'd_pro_whale', kind: 'gameplay', cadence: 'daily', title: 'Make 3 correct calls on Pro or Whale', rewardType: 'rp', rewardAmount: 25, verifyMethod: 'server', target: 3, active: true, sort: 120 },
  { id: 'd_score4', kind: 'gameplay', cadence: 'daily', title: 'Score 4/5 or better in a match', rewardType: 'rp', rewardAmount: 30, verifyMethod: 'server', target: 1, active: true, sort: 130 },
  { id: 'd_forex', kind: 'gameplay', cadence: 'daily', title: 'Get 3+ correct on a forex chart match', rewardType: 'rp', rewardAmount: 20, verifyMethod: 'server', target: 1, active: true, sort: 140 },
  { id: 'd_spend', kind: 'gameplay', cadence: 'daily', title: 'Spend all 10 tokens', rewardType: 'rp', rewardAmount: 20, verifyMethod: 'server', target: 10, active: true, sort: 150 },
  { id: 'd_share', kind: 'gameplay', cadence: 'daily', title: 'Share a result card', rewardType: 'rp', rewardAmount: 15, verifyMethod: 'server', target: 1, active: true, sort: 160 },
];

export const DAILY_POOL_IDS = DEFAULT_TASKS.filter((t) => t.cadence === 'daily').map((t) => t.id);
