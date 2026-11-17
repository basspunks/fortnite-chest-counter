import { readFileSync, writeFileSync } from 'node:fs';

/** One reward of the treasure hunt (see content/README.md). */
export interface Prize {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly prizeIds: readonly string[];
  /** Picture of the prize (shown in the collection, loaded from the web). */
  readonly image?: string;
}

export interface Week {
  readonly number: number;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly prizes: readonly Prize[];
}

export interface TreasureHour {
  readonly start: string;
  readonly end: string;
  /** kind → how many times more likely */
  readonly boosts: Readonly<Record<string, number>>;
  readonly confirmed?: boolean;
}

export interface Odds {
  readonly kind: string;
  readonly oneIn: number;
  /** Weekly prizes can only come from chests of their week; the others from the whole hunt. */
  readonly weekly: boolean;
}

export interface Content {
  readonly revision: number;
  readonly odds: readonly Odds[];
  readonly pirateShop: Prize;
  readonly weeks: readonly Week[];
  readonly treasureHours: readonly TreasureHour[];
}

const KIND_NAMES: Readonly<Record<string, string>> = {
  outfit: 'Gold outfit',
  'pirate-shop': 'Pirate Shop Access',
  car: 'Vehicle & decal',
  pickaxe: 'Pickaxe / back bling',
  jam: 'Jam Track',
  loading: 'Loading screen',
  gizmo: 'Any gizmo',
};

export const kindName = (kind: string): string => KIND_NAMES[kind] ?? kind;

/** Checks the shape of a content file; returns it, or undefined if it cannot be used. */
export function readContent(data: unknown): Content | undefined {
  const c = data as Partial<Content> | undefined;
  const ok =
    typeof c?.revision === 'number' &&
    Array.isArray(c.odds) &&
    c.odds.every((o) => typeof o.kind === 'string' && o.oneIn > 0) &&
    Array.isArray(c.weeks) &&
    c.weeks.every((w) => typeof w.number === 'number' && !Number.isNaN(Date.parse(w.start)) && Array.isArray(w.prizes)) &&
    Array.isArray(c.treasureHours) &&
    typeof c.pirateShop?.id === 'string';
  return ok ? (c as Content) : undefined;
}

/** The newest usable content: the bundled copy, or the downloaded one if its revision is higher. */
export function loadContent(bundledFile: string, cacheFile: string): Content {
  const read = (file: string): Content | undefined => {
    try {
      return readContent(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return undefined;
    }
  };
  const bundled = read(bundledFile)!;
  const cached = read(cacheFile);
  return cached !== undefined && cached.revision > bundled.revision ? cached : bundled;
}

/** Downloads the newest content; keeps it only if it is valid and newer. Never throws. */
export async function refreshContent(url: string, current: Content, cacheFile: string): Promise<Content> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const fresh = readContent(await response.json());
    if (fresh === undefined || fresh.revision <= current.revision) return current;
    writeFileSync(cacheFile, JSON.stringify(fresh));
    return fresh;
  } catch {
    return current; // offline: the copy we have is fine
  }
}

const inside = (ms: number, from: string, to: string): boolean => ms >= Date.parse(from) && ms < Date.parse(to);

export function weekAt(content: Content, ms: number): Week | undefined {
  return content.weeks.find((week) => inside(ms, week.start, week.end));
}

export function treasureHourAt(content: Content, ms: number): TreasureHour | undefined {
  return content.treasureHours.find((hour) => inside(ms, hour.start, hour.end));
}

/** The Treasure Hour running now, or the next one; undefined when none is left. */
export function nextTreasureHour(content: Content, ms: number): TreasureHour | undefined {
  return [...content.treasureHours].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).find((hour) => Date.parse(hour.end) > ms);
}

/** What a prize id from a replay is: the prize and its week, or the Pirate Shop Access. */
export function findPrize(content: Content, prizeId: string): { prize: Prize; week?: number } | undefined {
  if (content.pirateShop.prizeIds.includes(prizeId)) return { prize: content.pirateShop };
  for (const week of content.weeks) {
    const prize = week.prizes.find((p) => p.prizeIds.includes(prizeId));
    if (prize !== undefined) return { prize, week: week.number };
  }
  return undefined;
}

/** Chests opened at one moment, for the chances: where they count and at which boost. */
export interface ChestGroup {
  readonly count: number;
  /** When they were opened (ms). */
  readonly atMs: number;
  /** The boosts of the Treasure Hour they were opened in, if any. */
  readonly boosts?: Readonly<Record<string, number>>;
}

export interface Chance {
  readonly kind: string;
  readonly name: string;
  readonly oneIn: number;
  readonly weekly: boolean;
  /** Chests that count for it: this week's for a weekly prize, the whole hunt's otherwise. */
  readonly chests: number;
  /** 0–1: the chance it has dropped at least once. */
  readonly chance: number;
  readonly word: string;
}

export function chanceWord(chance: number): string {
  if (chance < 0.1) return 'Very unlikely';
  if (chance < 0.35) return 'Unlikely';
  if (chance < 0.65) return 'About even';
  if (chance < 0.9) return 'Likely';
  if (chance < 0.99) return 'Very likely';
  return 'Almost certain';
}

/**
 * The chance that each prize has dropped at least once: 1 − Π (1 − p)ⁿ over the chests that count for it,
 * with p raised during a Treasure Hour for the boosted kinds.
 */
export function chances(content: Content, groups: readonly ChestGroup[], nowMs: number): Chance[] {
  const week = weekAt(content, nowMs);
  return content.odds.map((odds) => {
    const counting = groups.filter((group) =>
      odds.weekly ? week !== undefined && inside(group.atMs, week.start, week.end) : true,
    );
    let logMiss = 0;
    let chests = 0;
    for (const group of counting) {
      const p = Math.min(1, (group.boosts?.[odds.kind] ?? 1) / odds.oneIn);
      logMiss += group.count * Math.log1p(-Math.min(p, 0.999999));
      chests += group.count;
    }
    const chance = -Math.expm1(logMiss);
    return { kind: odds.kind, name: kindName(odds.kind), oneIn: odds.oneIn, weekly: odds.weekly, chests, chance, word: chanceWord(chance) };
  });
}

/**
 * The Treasure Hour to remind the player of now: one that starts within `leadMs` and has not been announced yet.
 * Its start time is its key in `announced`.
 */
export function hourToAnnounce(content: Content, nowMs: number, announced: ReadonlySet<string>, leadMs = 5 * 60_000): TreasureHour | undefined {
  return content.treasureHours.find((hour) => {
    const start = Date.parse(hour.start);
    return nowMs >= start - leadMs && nowMs < start && !announced.has(hour.start);
  });
}
