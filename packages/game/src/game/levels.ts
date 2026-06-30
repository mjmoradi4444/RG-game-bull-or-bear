import { colors } from '../brand/tokens';

/** Puzzle trend-clarity grade (set offline by data-pipeline). */
export type Difficulty = 'easy' | 'med' | 'hard';

export type LevelId = 'retail' | 'pro' | 'whale';

/**
 * The three difficulty levels the player picks before a match. Each maps to a puzzle
 * difficulty tier (graded by trend clarity in the data pipeline) and a score weight:
 * a correct call on a harder level is worth more, so the global leaderboard rewards
 * skill and spreads out (SPEC §5). Green → gold → red reads as easy → hard.
 */
export interface Level {
  id: LevelId;
  name: string;
  difficulty: Difficulty;
  /** Points per correct call (leaderboard multiplier). */
  weight: number;
  color: string;
  tagline: string;
}

export const LEVELS: readonly Level[] = [
  {
    id: 'retail',
    name: 'Retail',
    difficulty: 'easy',
    weight: 1,
    color: colors.up,
    tagline: 'Clean, strong trends',
  },
  {
    id: 'pro',
    name: 'Pro',
    difficulty: 'med',
    weight: 2,
    color: colors.rebateGold,
    tagline: 'Real setups, mixed signals',
  },
  {
    id: 'whale',
    name: 'Whale',
    difficulty: 'hard',
    weight: 3,
    color: colors.down,
    tagline: 'Subtle, expert reads',
  },
] as const;

export const DEFAULT_LEVEL: Level = LEVELS[0]!;

export function levelById(id: LevelId | string | undefined): Level {
  return LEVELS.find((l) => l.id === id) ?? DEFAULT_LEVEL;
}
