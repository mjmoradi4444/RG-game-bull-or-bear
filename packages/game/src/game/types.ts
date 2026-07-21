/** Top-level screens of the duel. */
export type Screen =
  | 'title'
  | 'levelSelect'
  | 'lobby'
  | 'vs'
  | 'round'
  | 'result'
  | 'leaderboard'
  | 'prizes';

/** Which mode the player chose from the title.
 *  'practice' = ranked Quick Play (1 token, earns RP) — historical name;
 *  'challenge' = duels (live 1-v-1 or async link);
 *  'free'      = unlimited free practice, 0 RP (PRD §5.A). */
export type Mode = 'practice' | 'challenge' | 'free';

/** A player's call on a round. `null` = timed out (counts as a miss). */
export type Call = 'up' | 'down' | null;
