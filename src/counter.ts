export interface Counts {
  readonly match: number;
  readonly session: number;
  readonly total: number;
}

/**
 * Counts opened chests three ways: in this match, since the app was started (session) and all time (total).
 * The total is the only number that is kept between runs.
 */
export class ChestCounter {
  private matchCount = 0;
  private sessionCount = 0;

  constructor(private totalCount = 0) {}

  get total(): number {
    return this.totalCount;
  }

  counts(): Counts {
    return { match: this.matchCount, session: this.sessionCount, total: this.totalCount };
  }

  /** Counts `amount` chests. A negative amount takes back chests counted in this session, never older ones. */
  add(amount: number): void {
    const change = Math.max(amount, -this.sessionCount);
    this.matchCount = Math.max(0, this.matchCount + change);
    this.sessionCount += change;
    this.totalCount += change;
  }

  newMatch(): void {
    this.matchCount = 0;
  }

  /** Chests added or taken back by hand (opened before the counter existed): only the total changes. */
  addToTotal(change: number): void {
    this.totalCount = Math.max(0, this.totalCount + change);
  }

  /**
   * Fixes the session and the total by `change` chests for a match that is already over
   * (the replay counted a different number than the sound did). Match is not touched: it is the next match by now.
   */
  correctFinishedMatch(change: number): void {
    const allowed = Math.max(change, -this.sessionCount);
    this.sessionCount += allowed;
    this.totalCount += allowed;
  }
}
