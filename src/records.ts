import type { ChestGroup, Content } from './content';
import { findPrize, treasureHourAt } from './content';

/** A treasure hunt reward found in a match. */
export interface Treasure {
  readonly prizeId?: string;
  /** What it is, when the replay did not carry a prize id. */
  readonly item?: string;
  readonly golden: boolean;
}

/** Everything kept about one finished match. */
export interface MatchRecord {
  readonly endedMs: number;
  /** From the replay; else about when the match started (log). */
  readonly startMs: number;
  /** What counted: the replay's number, or the sound's when there was no replay. */
  readonly chests: number;
  /** What the sound counted during the match. */
  readonly heard: number;
  /** The number comes from the replay (exact). */
  readonly fromReplay: boolean;
  readonly mode?: string;
  /** A treasure hunt Battle Royale match. Others are kept in the list but not in the totals. */
  readonly counted: boolean;
  readonly kinds?: Readonly<Record<string, number>>;
  readonly treasures?: readonly Treasure[];
  readonly teamChests?: number;
  /** Chests opened during a Treasure Hour, and that hour's boosts. */
  readonly hourChests?: number;
  readonly hourBoosts?: Readonly<Record<string, number>>;
}

/** Chests added by hand: earlier chests, or an estimate from the matches in Fortnite's Career tab. */
export interface ManualEntry {
  readonly id: string;
  readonly chests: number;
  readonly addedMs: number;
  readonly kind: 'hand' | 'estimate';
  readonly careerMatches?: number;
}

/** From a replay: which of its chests were opened during a Treasure Hour. */
export function hourSplit(content: Content, startMs: number, chestSeconds: readonly number[]): { hourChests: number; hourBoosts?: Record<string, number> } {
  let hourChests = 0;
  let hourBoosts: Record<string, number> | undefined;
  for (const seconds of chestSeconds) {
    const hour = treasureHourAt(content, startMs + seconds * 1000);
    if (hour !== undefined) {
      hourChests++;
      hourBoosts = { ...hour.boosts };
    }
  }
  return hourBoosts === undefined ? { hourChests } : { hourChests, hourBoosts };
}

export interface Report {
  readonly totalChests: number;
  readonly matches: number;
  readonly average: number | null;
  readonly best: number;
  readonly manualChests: number;
  /** "2026-11-16" → chests, last 7 days with matches, newest first. */
  readonly perDay: readonly (readonly [string, number])[];
  readonly kinds: Readonly<Record<string, number>>;
  readonly treasures: number;
  /** One treasure every N chests (from matches read from replays). */
  readonly chestsPerTreasure: number | null;
  readonly teamChests: number;
  readonly skipped: number;
}

/** All finished matches and the hand-made additions, with the report and the chances' input made from them. */
export class Records {
  private readonly matches: MatchRecord[];
  private readonly manual: ManualEntry[];

  constructor(saved: unknown = {}) {
    const data = (saved ?? {}) as { matches?: unknown; manual?: unknown };
    this.matches = Array.isArray(data.matches) ? data.matches.filter((m): m is MatchRecord => typeof m?.chests === 'number' && typeof m?.endedMs === 'number') : [];
    this.manual = Array.isArray(data.manual) ? data.manual.filter((m): m is ManualEntry => typeof m?.chests === 'number' && typeof m?.id === 'string') : [];
  }

  add(record: MatchRecord): void {
    this.matches.push(record);
  }

  /** Replaces the newest match (once its replay has been read). */
  replaceLast(record: MatchRecord): void {
    if (this.matches.length > 0) this.matches[this.matches.length - 1] = record;
  }

  last(): MatchRecord | undefined {
    return this.matches[this.matches.length - 1];
  }

  /** Adds chests by hand (negative removes some). An estimate replaces the previous estimate. Returns the change to the total. */
  addManual(entry: ManualEntry): number {
    let change = entry.chests;
    if (entry.kind === 'estimate') {
      const old = this.manual.findIndex((m) => m.kind === 'estimate');
      if (old >= 0) change -= this.manual.splice(old, 1)[0]!.chests;
    }
    this.manual.push(entry);
    return change;
  }

  /** Takes a hand-made addition back. Returns the change to the total. */
  removeManual(id: string): number {
    const index = this.manual.findIndex((m) => m.id === id);
    return index < 0 ? 0 : -this.manual.splice(index, 1)[0]!.chests;
  }

  manualEntries(): readonly ManualEntry[] {
    return [...this.manual];
  }

  /** Average chests per counted match, for the estimate: unseen matches × average. */
  estimate(careerMatches: number): number {
    const counted = this.matches.filter((m) => m.counted);
    if (counted.length === 0) return 0;
    const average = counted.reduce((sum, m) => sum + m.chests, 0) / counted.length;
    return Math.max(0, Math.round((careerMatches - counted.length) * average));
  }

  /** Prize ids found in the counted matches. */
  foundPrizeIds(): Set<string> {
    return new Set(this.matches.flatMap((m) => (m.counted ? (m.treasures ?? []) : [])).flatMap((t) => (t.prizeId ? [t.prizeId] : [])));
  }

  /** Chests in groups by time and Treasure Hour, for the chances (hand-made additions count as normal chests now-ish). */
  chestGroups(): ChestGroup[] {
    const groups: ChestGroup[] = [];
    for (const m of this.matches) {
      if (!m.counted) continue;
      const hour = m.hourChests ?? 0;
      if (m.chests - hour > 0) groups.push({ count: m.chests - hour, atMs: m.startMs });
      if (hour > 0) groups.push({ count: hour, atMs: m.startMs, boosts: m.hourBoosts });
    }
    for (const entry of this.manual) {
      if (entry.chests > 0) groups.push({ count: entry.chests, atMs: 0 }); // before this week: only whole-hunt prizes
    }
    return groups;
  }

  /** Treasures found in counted matches: known prizes, and treasures the replay could not name ("Unknown:..."). */
  treasuresCount(content: Content): number {
    const isTreasure = (t: Treasure): boolean => t.prizeId === undefined || t.prizeId.startsWith('Unknown:') || findPrize(content, t.prizeId) !== undefined;
    return this.matches.filter((m) => m.counted).reduce((sum, m) => sum + (m.treasures?.filter(isTreasure).length ?? 0), 0);
  }

  report(content: Content, nowMs: number): Report {
    const counted = this.matches.filter((m) => m.counted);
    const manualChests = this.manual.reduce((sum, m) => sum + m.chests, 0);
    const matchChests = counted.reduce((sum, m) => sum + m.chests, 0);
    const perDay = new Map<string, number>();
    for (const m of counted) {
      const day = new Date(m.endedMs).toLocaleDateString('en-CA'); // 2026-11-16, local time
      perDay.set(day, (perDay.get(day) ?? 0) + m.chests);
    }
    const kinds: Record<string, number> = {};
    for (const m of counted) for (const [kind, n] of Object.entries(m.kinds ?? {})) kinds[kind] = (kinds[kind] ?? 0) + n;
    const fromReplays = counted.filter((m) => m.fromReplay);
    const replayChests = fromReplays.reduce((sum, m) => sum + m.chests, 0);
    const treasures = this.treasuresCount(content);
    const weekAgo = nowMs - 7 * 86_400_000;
    return {
      totalChests: matchChests + manualChests,
      matches: counted.length,
      average: counted.length === 0 ? null : matchChests / counted.length,
      best: Math.max(0, ...counted.map((m) => m.chests)),
      manualChests,
      perDay: [...perDay.entries()].filter(([day]) => Date.parse(day) >= weekAgo - 86_400_000).sort((a, b) => b[0].localeCompare(a[0])),
      kinds,
      treasures,
      chestsPerTreasure: treasures === 0 ? null : replayChests / treasures,
      teamChests: counted.reduce((sum, m) => sum + (m.teamChests ?? 0), 0),
      skipped: this.matches.length - counted.length,
    };
  }

  toJSON(): { matches: MatchRecord[]; manual: ManualEntry[] } {
    return { matches: [...this.matches], manual: [...this.manual] };
  }
}
