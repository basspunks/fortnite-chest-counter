import type { ChestCounter } from './counter';
import type { MatchHistory } from './history';
import type { MatchEvent } from './match-log';

/**
 * Where the player is, from Fortnite's log: in a match, in the lobby,
 * or unknown (no log found yet). Sound is not counted in the lobby: its music can sound like a chest.
 */
export type MatchPhase = 'match' | 'lobby' | 'unknown';

/**
 * Decides when a match ends and goes into the history, so every match is recorded exactly once:
 * - back in the lobby: the match is recorded and Match goes back to 0 at once
 * - a new match starts without passing the lobby: the previous one is recorded first
 * - "New match" by hand: recorded only if it has chests (in the lobby Match is already 0, so nothing twice)
 */
export class MatchTracker {
  phase: MatchPhase = 'unknown';

  constructor(
    private readonly counter: () => ChestCounter,
    private readonly history: () => MatchHistory,
  ) {}

  /** Returns true when a new match started (the caller may want to reset things then). */
  onEvent(event: MatchEvent): boolean {
    if (event === 'start') {
      if (this.phase === 'match') this.record();
      this.counter().newMatch();
      this.phase = 'match';
      return true;
    }
    if (this.phase === 'match') {
      this.record();
      this.counter().newMatch();
    }
    this.phase = 'lobby';
    return false;
  }

  newMatchByHand(): void {
    if (this.counter().counts().match > 0) this.record();
    this.counter().newMatch();
  }

  private record(): void {
    this.history().add(this.counter().counts().match);
  }
}
