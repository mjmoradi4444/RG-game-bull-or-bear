/**
 * Scoring helpers (SPEC §5). PvP is decided purely by correct count (transparent,
 * no speed/combo weighting). Solo adds an accuracy %; the cosmetic combo flair is
 * layered on in the juice phase and never affects a duel result.
 */
export function accuracyPct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}
