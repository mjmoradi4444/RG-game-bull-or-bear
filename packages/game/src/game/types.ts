/** Top-level screens of the duel. */
export type Screen = 'title' | 'levelSelect' | 'round' | 'result' | 'leaderboard';

/** Which mode the player chose from the title. */
export type Mode = 'practice' | 'challenge';

/** A player's call on a round. `null` = timed out (counts as a miss). */
export type Call = 'up' | 'down' | null;
