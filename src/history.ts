/** How many matches are kept. */
const KEEP = 100;

/** Chests per finished match, newest last. */
export class MatchHistory {
  private readonly counts: number[];

  constructor(saved: unknown = []) {
    this.counts = Array.isArray(saved) ? saved.filter((count): count is number => Number.isSafeInteger(count) && count >= 0) : [];
    this.counts.splice(0, Math.max(0, this.counts.length - KEEP));
  }

  add(chests: number): void {
    this.counts.push(chests);
    if (this.counts.length > KEEP) this.counts.shift();
  }

  /** Replaces the newest match's count (the replay's exact number) and returns the change, or 0 if there is none. */
  correctLast(chests: number): number {
    const last = this.counts.length - 1;
    if (last < 0) return 0;
    const change = chests - this.counts[last]!;
    this.counts[last] = chests;
    return change;
  }

  /** Takes the newest match out (it was not a treasure hunt match) and returns its count. */
  removeLast(): number {
    return this.counts.pop() ?? 0;
  }

  /** The last `n` matches, newest first. */
  last(n: number): number[] {
    return this.counts.slice(-n).reverse();
  }

  /** Chests per match over the kept matches, or undefined before the first one. */
  average(): number | undefined {
    if (this.counts.length === 0) return undefined;
    return this.counts.reduce((sum, count) => sum + count, 0) / this.counts.length;
  }

  get matches(): number {
    return this.counts.length;
  }

  toJSON(): number[] {
    return [...this.counts];
  }
}
