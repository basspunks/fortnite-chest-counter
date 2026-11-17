import { describe, expect, it } from 'vitest';

import { ChestCounter } from '../src/counter';
import { MatchHistory } from '../src/history';
import { oldReplays, pickReplays, replayStartMs } from '../src/replays';

describe('pickReplays', () => {
  const start = Date.parse('2026-11-16T19:47:40Z');
  const end = start + 712_000;
  const files = [
    { name: 'UnsavedReplay-2026.11.16-21.10.00.replay', modifiedMs: start - 3_600_000 }, // an older match
    { name: 'UnsavedReplay-2026.11.16-22.47.43.replay', modifiedMs: end + 4_000 }, // this match, finished just after it ended
    { name: 'notes.txt', modifiedMs: start + 800_000 },
  ];

  it('takes the replay written between the match start and shortly after its end', () => {
    expect(pickReplays(files, start, end, new Set())).toEqual(['UnsavedReplay-2026.11.16-22.47.43.replay']);
  });

  it('never takes a replay twice, nor one from an older match', () => {
    expect(pickReplays(files, start, end, new Set(['UnsavedReplay-2026.11.16-22.47.43.replay']))).toEqual([]);
  });

  it('when the next match started without the lobby, offers both, newest first, and drops the next one once it has grown on', () => {
    const next = { name: 'UnsavedReplay-2026.11.16-23.00.10.replay', modifiedMs: end + 30_000 };
    expect(pickReplays([...files, next], start, end, new Set())).toEqual([next.name, 'UnsavedReplay-2026.11.16-22.47.43.replay']);
    const later = { ...next, modifiedMs: end + 600_000 };
    expect(pickReplays([...files, later], start, end, new Set())).toEqual(['UnsavedReplay-2026.11.16-22.47.43.replay']);
  });

  it('has nothing when replays are turned off', () => {
    expect(pickReplays([], start, end, new Set())).toEqual([]);
  });

  it('reads the replay start time the helper gives (UTC without a zone)', () => {
    expect(replayStartMs({ ok: true, startUtc: '2026-11-16T19:49:02.47' })).toBe(Date.parse('2026-11-16T19:49:02.470Z'));
    expect(replayStartMs({ ok: true })).toBeUndefined();
  });
});

describe('correcting a finished match with its replay', () => {
  it('replaces the sound count in the history and fixes session and total, not the new match', () => {
    const counter = new ChestCounter(100);
    const history = new MatchHistory([10]);
    counter.add(39); // heard during the match
    history.add(39); // recorded when the match ended
    counter.newMatch();
    counter.add(2); // the next match already started

    const change = history.correctLast(33); // the replay says 33
    counter.correctFinishedMatch(change);

    expect(change).toBe(-6);
    expect(history.toJSON()).toEqual([10, 33]);
    expect(counter.counts()).toEqual({ match: 2, session: 35, total: 135 });
  });

  it('adds chests the sound missed', () => {
    const counter = new ChestCounter(0);
    const history = new MatchHistory();
    counter.add(10);
    history.add(10);
    counter.newMatch();
    counter.correctFinishedMatch(history.correctLast(14));
    expect(counter.counts()).toEqual({ match: 0, session: 14, total: 14 });
  });

  it('does nothing without a recorded match', () => {
    expect(new MatchHistory().correctLast(5)).toBe(0);
  });
});

describe('oldReplays', () => {
  const file = (name: string, minutesAgo: number) => ({ name, modifiedMs: Date.parse('2026-11-17T12:00:00Z') - minutesAgo * 60_000 });

  it('offers only Fortnite\'s unsaved replays, never the newest one, nor one the player saved', () => {
    const files = [
      file('UnsavedReplay-2026.11.16-22.47.43.replay', 600),
      file('UnsavedReplay-2026.11.17-11.30.00.replay', 20), // newest: kept
      file('UnsavedReplay-2026.11.15-20.00.00.replay', 2000),
      file('My best win.replay', 3000), // saved and named by the player: kept
      file('notes.txt', 5000),
    ];
    expect(oldReplays(files).map((f) => f.name)).toEqual(['UnsavedReplay-2026.11.16-22.47.43.replay', 'UnsavedReplay-2026.11.15-20.00.00.replay']);
  });

  it('keeps a single replay', () => {
    expect(oldReplays([file('UnsavedReplay-2026.11.17-11.30.00.replay', 20)])).toEqual([]);
  });
});
