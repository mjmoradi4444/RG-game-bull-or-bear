/** Top-level screens of the duel. The round/result screens fill in over Phases 3–5. */
export type Screen = 'title' | 'soon' | 'leaderboard';

/** Which mode the player chose from the title. */
export type Mode = 'practice' | 'challenge';

/** A player's call on a round. `null` = timed out (counts as a miss). */
export type Call = 'up' | 'down' | null;
