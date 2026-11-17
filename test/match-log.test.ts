import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MatchHistory } from '../src/history';
import { MatchLog, matchEvents, type MatchEvent } from '../src/match-log';

// Real lines from a Fortnite log (addresses shortened).
const LINES = {
  boot: '[2026.11.14-19.25.08:600][555]LogLoad: LoadMap: /Game/Maps/Frontend?Name=Player',
  joining: '[2026.11.14-19.27.21:562][308]LogLoad: LoadMap: 1.2.3.4:9031/Delilah/Maps/Delilah_Terrain?EncryptionToken=x',
  warmup: '[2026.11.14-19.27.26:169][346]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Setup. NewPhase = EAthenaGamePhase::Warmup',
  step: '[2026.11.14-19.27.27:812][385]LogBattleRoyaleGamePhaseLogic: UpdateGamePhaseStep. Phase = EAthenaGamePhase::Warmup. PhaseStep = EAthenaGamePhaseStep::None',
  bus: '[2026.11.14-19.27.47:593][340]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Warmup. NewPhase = EAthenaGamePhase::Aircraft',
  back: '[2026.11.14-19.30.42:428][145]LogLoad: LoadMap: /Game/Maps/Frontend?closed',
  setting: '[2026.11.16-16.49.48:954][  0]LogConfig: Set CVar [[Athena.Frontend.UseRecentTabInsteadOfNewTab:1]]',
};

describe('matchEvents', () => {
  it('finds the start of a match and the return to the lobby', () => {
    const log = [LINES.boot, LINES.joining, LINES.warmup, LINES.step, LINES.bus, LINES.back].join('\n');
    expect(matchEvents(log)).toEqual(['lobby', 'start', 'lobby']);
  });

  it('ignores lines that only mention the words', () => {
    expect(matchEvents([LINES.setting, LINES.step, LINES.bus].join('\n'))).toEqual([]);
  });
});

describe('MatchLog', () => {
  it('reports only what is written after it starts, also when lines arrive in pieces', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.boot}\n${LINES.warmup}\n`); // before the app started: ignored
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    appendFileSync(file, LINES.warmup.slice(0, 40));
    log.poll();
    expect(events).toEqual([]);
    appendFileSync(file, `${LINES.warmup.slice(40)}\n${LINES.back}\n`);
    log.poll();
    expect(events).toEqual(['start', 'lobby']);
    log.stop();
  });

  it('reads a new log from the start when the game is launched again', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.setting}\n`.repeat(20));
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    writeFileSync(file, `${LINES.warmup}\n`); // shorter: a fresh file
    log.poll();
    expect(events).toEqual(['start']);
    log.stop();
  });

  it('reads a new log from the start even when it is already longer than the old one', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `Log file open, 11/17/26 01:02:03\n${`${LINES.setting}\n`.repeat(30)}`);
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    // the game was started again and wrote a lot at once: the new file is past the old length at the next look
    // (the match lines are near its start, before where the old file ended)
    writeFileSync(file, `Log file open, 11/17/26 12:50:36\n${LINES.warmup}\n${LINES.back}\n${`${LINES.setting}\n`.repeat(60)}`);
    log.poll();
    expect(events).toEqual(['start', 'lobby']);
    log.stop();
  });

  it('says at once that the game is in the lobby when the app is opened after Fortnite', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.boot}\n${LINES.warmup}\n${LINES.back}\n${LINES.setting}\n`);
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    await new Promise((done) => setImmediate(done));
    expect(events).toEqual(['lobby']);
    log.stop();
  });

  it('finds the lobby even when the game wrote more than 4 MB since', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.boot}\n${LINES.warmup}\n${LINES.back}\n${`${LINES.setting}\n`.repeat(60_000)}`); // about 6 MB
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    await new Promise((done) => setImmediate(done));
    expect(events).toEqual(['lobby']);
    log.stop();
  });

  it('says a match is on when the app is opened during one', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.boot}\n${LINES.warmup}\n${LINES.step}\n`);
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    await new Promise((done) => setImmediate(done));
    expect(events).toEqual(['start']);
    log.stop();
  });

  it('says nothing about a match in the log of a game that is closed', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chest-log-')), 'FortniteGame.log');
    writeFileSync(file, `${LINES.boot}\n${LINES.warmup}\n${LINES.step}\n`);
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    utimesSync(file, hourAgo, hourAgo);
    const events: MatchEvent[] = [];
    const log = new MatchLog((event) => events.push(event), file);
    log.start(60_000);
    await new Promise((done) => setImmediate(done));
    expect(events).toEqual([]);
    log.stop();
  });

  it('waits quietly while there is no log', () => {
    const log = new MatchLog(() => undefined, join(tmpdir(), 'no-such-dir', 'FortniteGame.log'));
    expect(log.found()).toBe(false);
    expect(() => log.poll()).not.toThrow();
  });
});

describe('MatchHistory', () => {
  it('keeps chests per match and their average', () => {
    const history = new MatchHistory();
    expect(history.average()).toBeUndefined();
    [8, 12, 3, 9, 15, 4].forEach((count) => history.add(count));
    expect(history.last(5)).toEqual([4, 15, 9, 3, 12]);
    expect(history.average()).toBe(8.5);
    expect(history.matches).toBe(6);
  });

  it('reads saved matches and drops anything that is not a count', () => {
    const history = new MatchHistory([5, -1, 'x', 2.5, 7]);
    expect(history.toJSON()).toEqual([5, 7]);
    expect(new MatchHistory('broken').matches).toBe(0);
  });

  it('keeps the last 100 matches', () => {
    const history = new MatchHistory(Array.from({ length: 120 }, (_, i) => i));
    expect(history.matches).toBe(100);
    expect(history.last(1)).toEqual([119]);
  });
});
