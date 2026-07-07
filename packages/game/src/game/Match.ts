import type { Puzzle } from './Puzzle';
import { Round } from './Round';

export type RoundStatus = 'pending' | 'current' | 'correct' | 'wrong';

/**
 * A match is an ordered set of rounds over the SAME puzzles for every player
 * (SPEC §4.1). v1 here drives solo play; the PvP seed + winner resolution layer in
 * Phase 5 builds on this exact shape (both players get an identical Puzzle[]).
 */
export class Match {
  readonly rounds: Round[];
  current = 0;

  constructor(puzzles: Puzzle[]) {
    this.rounds = puzzles.map((p, i) => new Round(p, i, puzzles.length));
  }

  get round(): Round {
    return this.rounds[this.current]!;
  }

  get total(): number {
    return this.rounds.length;
  }

  get isLast(): boolean {
    return this.current >= this.rounds.length - 1;
  }

  /** Correct calls over rounds that have finished revealing. */
  get correctCount(): number {
    return this.rounds.filter((r) => r.phase === 'done' && r.correct).length;
  }

  advance(): void {
    if (!this.isLast) this.current++;
  }

  /** Append a sudden-death round (live 1-v-1 tie) and make it current. Both clients
   *  hold the same reserve puzzles from the match seed, so the extra round is
   *  identical on both sides. */
  append(puzzle: Puzzle): void {
    this.rounds.push(new Round(puzzle, this.rounds.length, this.rounds.length + 1));
    this.current = this.rounds.length - 1;
  }

  /** Per-round status for the tally pips. */
  statuses(): RoundStatus[] {
    return this.rounds.map((r, i) => {
      if (r.phase === 'done') return r.correct ? 'correct' : 'wrong';
      if (i === this.current) return 'current';
      return 'pending';
    });
  }
}
