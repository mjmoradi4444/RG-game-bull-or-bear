import type { Puzzle } from './Puzzle';
import type { Call } from './types';
import { CONFIG } from './config';
import { clamp, easeOutCubic } from '../engine/math';

/**
 * One round = one puzzle, as a small phase machine (SPEC §2):
 *   preroll → playback → decide → reveal → done
 *
 * Pure logic + timing only — no rendering. The outcome is fixed by real history on
 * the puzzle; this just records the player's call and whether it matched. A timeout
 * counts as a miss (never silently helps the player or the house).
 */
export type RoundPhase = 'preroll' | 'playback' | 'decide' | 'reveal' | 'done';

const PREROLL_S = 1.1;
const PLAYBACK_S = CONFIG.PLAYBACK_MS / 1000;
const REVEAL_S = CONFIG.REVEAL_MS / 1000;

export class Round {
  phase: RoundPhase = 'preroll';
  /** Seconds elapsed in the current phase. */
  t = 0;
  call: Call = null;
  locked = false;
  correct = false;
  timedOut = false;
  decisionLeft: number = CONFIG.DECISION_SECONDS;

  constructor(
    readonly puzzle: Puzzle,
    /** 0-based index within the match. */
    readonly index: number,
    readonly total: number,
  ) {}

  update(dt: number): void {
    this.t += dt;
    switch (this.phase) {
      case 'preroll':
        if (this.t >= PREROLL_S) this.enter('playback');
        break;
      case 'playback':
        if (this.t >= PLAYBACK_S) this.enter('decide');
        break;
      case 'decide':
        this.decisionLeft = Math.max(0, this.decisionLeft - dt);
        if (this.decisionLeft <= 0) {
          this.timedOut = true;
          this.resolve(null);
        }
        break;
      case 'reveal':
        if (this.t >= REVEAL_S) this.enter('done');
        break;
      case 'done':
        break;
    }
  }

  /** Player calls BUY (up) or SELL (down). Ignored outside the decide window. */
  lockIn(call: 'up' | 'down'): void {
    if (this.phase !== 'decide' || this.locked) return;
    this.resolve(call);
  }

  /** Tap during the intro: jump straight to the decision (playback is deliberately
   *  slow, so impatient / repeat players aren't held hostage by it). */
  skipIntro(): void {
    if (this.phase === 'preroll' || this.phase === 'playback') this.enter('decide');
  }

  private resolve(call: Call): void {
    this.call = call;
    this.locked = true;
    this.correct = call !== null && call === this.puzzle.outcome;
    this.enter('reveal');
  }

  private enter(phase: RoundPhase): void {
    this.phase = phase;
    this.t = 0;
  }

  /** 0..1 fraction of context candles to show. LINEAR during playback so the feed
   *  streams at a steady, readable pace (easing front-loaded a rush of candles). */
  get playbackFrac(): number {
    if (this.phase === 'preroll') return 0;
    if (this.phase === 'playback') return clamp(this.t / PLAYBACK_S, 0, 1);
    return 1;
  }

  /** 0..1 eased fraction of future candles to show (animates in during reveal). */
  get revealFrac(): number {
    if (this.phase === 'reveal') return easeOutCubic(clamp(this.t / REVEAL_S, 0, 1));
    if (this.phase === 'done') return 1;
    return 0;
  }

  /** True once enough of the future is revealed to show the ✓/✗ verdict + verify chip. */
  get verdictShown(): boolean {
    return this.phase === 'done' || (this.phase === 'reveal' && this.revealFrac >= 0.6);
  }
}
