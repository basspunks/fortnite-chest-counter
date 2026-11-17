import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chances, chanceWord, findPrize, nextTreasureHour, readContent, treasureHourAt, weekAt, type Content } from '../src/content';
import { hourSplit, Records, type MatchRecord } from '../src/records';

const content = readContent(JSON.parse(readFileSync(join(__dirname, '..', 'content', 'content.json'), 'utf8')))!;
const at = (iso: string): number => Date.parse(iso);

describe('content', () => {
  it('reads the bundled file and knows the weeks and Treasure Hours', () => {
    expect(content).toBeDefined();
    expect(weekAt(content, at('2026-11-17T12:00:00Z'))?.number).toBe(3);
    expect(treasureHourAt(content, at('2026-11-07T20:00:00Z'))?.boosts['car']).toBe(10);
    expect(treasureHourAt(content, at('2026-11-07T22:00:00Z'))).toBeUndefined();
    expect(Date.parse(nextTreasureHour(content, at('2026-11-17T12:00:00Z'))!.start)).toBeGreaterThan(at('2026-11-17T12:00:00Z'));
  });

  it('names a prize from a replay prize id', () => {
    expect(findPrize(content, 'DelilahPrize:dpid_item19')).toMatchObject({ prize: { name: 'Solid Gold Miku', kind: 'outfit' }, week: 3 });
    expect(findPrize(content, content.pirateShop.prizeIds[0]!)?.prize.kind).toBe('pirate-shop');
    expect(findPrize(content, 'nothing')).toBeUndefined();
  });

  it('rejects a broken file', () => {
    expect(readContent({ revision: 1 })).toBeUndefined();
    expect(readContent(null)).toBeUndefined();
  });
});

describe('chances', () => {
  const now = at('2026-11-17T12:00:00Z'); // week 3
  const loading = (list: ReturnType<typeof chances>) => list.find((c) => c.kind === 'loading')!;

  it('uses only this week for weekly prizes and the whole hunt for the others', () => {
    const groups = [
      { count: 272, atMs: at('2026-11-16T20:00:00Z') }, // week 3
      { count: 1000, atMs: at('2026-11-05T20:00:00Z') }, // week 1
    ];
    const list = chances(content, groups, now);
    expect(loading(list).chests).toBe(272);
    expect(loading(list).chance).toBeCloseTo(1 - (271 / 272) ** 272, 6);
    expect(list.find((c) => c.kind === 'pirate-shop')!.chests).toBe(1272);
  });

  it('counts chests of a Treasure Hour at their boosted odds', () => {
    const plain = chances(content, [{ count: 100, atMs: at('2026-11-16T20:00:00Z') }], now).find((c) => c.kind === 'car')!;
    const boosted = chances(content, [{ count: 100, atMs: at('2026-11-16T20:00:00Z'), boosts: { car: 10 } }], now).find((c) => c.kind === 'car')!;
    expect(boosted.chance).toBeGreaterThan(plain.chance * 9);
  });

  it('says it in words', () => {
    expect(chanceWord(0.02)).toBe('Very unlikely');
    expect(chanceWord(0.5)).toBe('About even');
    expect(chanceWord(0.995)).toBe('Almost certain');
  });
});

describe('records', () => {
  const match = (over: Partial<MatchRecord>): MatchRecord => ({
    endedMs: at('2026-11-16T20:00:00Z'), startMs: at('2026-11-16T19:48:00Z'), chests: 10, heard: 10, fromReplay: true, counted: true, ...over,
  });

  it('builds the report from counted matches and additions by hand', () => {
    const records = new Records();
    records.add(match({ chests: 33, broken: 4, kinds: { normal: 31, buried: 1, spirit: 1 }, teamChests: 16, treasures: [{ prizeId: 'DelilahPrize:dpid_item19', golden: true }] }));
    records.add(match({ chests: 12, kinds: { normal: 11, rare: 1 } }));
    records.add(match({ chests: 40, counted: false, mode: 'Playlist_Ranked' }));
    records.addManual({ id: 'a', chests: 100, addedMs: 0, kind: 'hand' });
    const report = records.report(content, at('2026-11-17T12:00:00Z'));
    expect(report).toMatchObject({ totalChests: 145, matches: 2, best: 33, manualChests: 100, treasures: 1, teamChests: 16, skipped: 1, broken: 4 });
    expect(report.average).toBeCloseTo(22.5);
    expect(report.kinds).toEqual({ normal: 42, buried: 1, spirit: 1, rare: 1 });
    expect(report.chestsPerTreasure).toBe(45);
    expect([...records.foundPrizeIds()]).toEqual(['DelilahPrize:dpid_item19']);
  });

  it('counts a treasure the replay could not name, but not an unknown prize id', () => {
    const records = new Records();
    records.add(match({ treasures: [{ prizeId: 'Unknown:2026-11-17_00.54@7m58s', item: 'Treasure (unknown type)', golden: false }] }));
    records.add(match({ treasures: [{ prizeId: 'SomethingElse:not_a_prize', golden: true }] }));
    expect(records.treasuresCount(content)).toBe(1);
  });

  it('replaces the previous estimate, and takes additions back', () => {
    const records = new Records();
    records.add(match({ chests: 20 }));
    records.add(match({ chests: 30 }));
    expect(records.estimate(12)).toBe(250); // 10 unseen matches × 25
    expect(records.addManual({ id: 'e1', chests: 250, addedMs: 0, kind: 'estimate', careerMatches: 12 })).toBe(250);
    expect(records.addManual({ id: 'e2', chests: 300, addedMs: 0, kind: 'estimate', careerMatches: 14 })).toBe(50);
    expect(records.removeManual('e2')).toBe(-300);
    expect(records.manualEntries()).toEqual([]);
  });

  it('splits a replay\'s chests into normal and Treasure Hour ones', () => {
    const start = at('2026-11-07T20:50:00Z'); // the hour ends at 21:00
    expect(hourSplit(content as Content, start, [60, 300, 700])).toEqual({ hourChests: 2, hourBoosts: { outfit: 7.5, 'pirate-shop': 1.5, car: 10 } });
    expect(hourSplit(content, at('2026-11-16T19:48:00Z'), [60])).toEqual({ hourChests: 0 });
  });

  it('survives a broken file', () => {
    expect(new Records({ matches: 'x', manual: [{ nope: 1 }] }).toJSON()).toEqual({ matches: [], manual: [] });
  });
});
