import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** What chest-replay.exe says about one replay (see replay-reader/src/Program.cs). */
export interface ReplayResult {
  readonly ok: boolean;
  readonly chests?: number;
  /** Of the chests, how many were broken rather than opened. */
  readonly destroyed?: number;
  readonly mode?: string;
  readonly player?: string;
  readonly error?: string;
  readonly counts?: boolean;
  readonly startUtc?: string;
  readonly kinds?: Readonly<Record<string, number>>;
  readonly chestSeconds?: readonly number[];
  readonly treasures?: readonly { prizeId?: string | null; item?: string; golden: boolean }[];
  readonly teamChests?: number;
}

export interface ReplayFile {
  readonly name: string;
  readonly modifiedMs: number;
}

export function defaultReplayFolder(): string {
  return join(process.env['LOCALAPPDATA'] ?? '', 'FortniteGame', 'Saved', 'Demos');
}

/** A replay is finished a little after its match ends; the next match's replay keeps growing long after. */
const FINISH_MS = 120_000;

/** When Fortnite began recording a replay, from its own name ("UnsavedReplay-2026.11.17-19.23.07.replay", local time). */
export function nameStartMs(name: string): number | undefined {
  const parts = /^UnsavedReplay-(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d)/i.exec(name);
  if (!parts) return undefined;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * The replays that may be the match's, best first: written between its start and shortly after its end,
 * not used already. When a new match starts without passing the lobby, the new match's replay (still being written)
 * is in that window too: its name says it began after this match ended, so it is left out (reading it again and
 * again while the next match is played cost CPU right then).
 */
export function pickReplays(files: readonly ReplayFile[], matchStartMs: number, matchEndMs: number, used: ReadonlySet<string>): string[] {
  return files
    .filter(
      (file) =>
        file.name.toLowerCase().endsWith('.replay') &&
        file.modifiedMs >= matchStartMs &&
        file.modifiedMs <= matchEndMs + FINISH_MS &&
        !((nameStartMs(file.name) ?? -Infinity) >= matchEndMs) &&
        !used.has(file.name),
    )
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .map((file) => file.name);
}

/** The replay's own start time ("2026-11-16T19:49:02.47", UTC without a zone) in ms, if it has one. */
export function replayStartMs(result: ReplayResult): number | undefined {
  if (!result.startUtc) return undefined;
  const ms = Date.parse(result.startUtc.endsWith('Z') ? result.startUtc : `${result.startUtc}Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Replays in the folder, or none if the folder does not exist. */
export function listReplays(folder: string): (ReplayFile & { bytes: number })[] {
  try {
    return readdirSync(folder).map((name) => {
      const info = statSync(join(folder, name));
      return { name, modifiedMs: info.mtimeMs, bytes: info.size };
    });
  } catch {
    return [];
  }
}

/** Fortnite names the replays it records by itself UnsavedReplay-<date>.replay; one the player saved has its own name. */
const UNSAVED = /^UnsavedReplay-.*\.replay$/i;

/**
 * The replays that can be cleaned up: only Fortnite's own unsaved ones (never one the player saved and named),
 * and never the newest one, which may be the match just played or the one being played.
 */
export function oldReplays<T extends ReplayFile>(files: readonly T[]): T[] {
  return files
    .filter((file) => UNSAVED.test(file.name))
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(1);
}

/**
 * Reads the exact chest count of a finished match from its replay, with chest-replay.exe.
 * Fortnite only finishes the replay (writes its key) a few seconds after the match ends, so it tries again
 * every few seconds for a while.
 */
export class ReplayReader {
  private readonly used = new Set<string>();

  constructor(
    private readonly helper: string,
    private readonly folder = defaultReplayFolder(),
  ) {}

  /** The replays in the folder, with their sizes. */
  files(): (ReplayFile & { bytes: number })[] {
    return listReplays(this.folder);
  }

  pathOf(name: string): string {
    return join(this.folder, name);
  }

  /** Is there a replay folder at all (replays turned on, or on once)? */
  folderExists(): boolean {
    try {
      return statSync(this.folder).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * The exact count of the match that ran from `matchStartMs` to `matchEndMs`, or undefined if no replay was found
   * (a result with ok: false if one was found but could not be read).
   */
  async readMatch(matchStartMs: number, matchEndMs: number, tries = 12, waitMs = 5000): Promise<(ReplayResult & { file: string }) | undefined> {
    let last: (ReplayResult & { file: string }) | undefined;
    for (let attempt = 0; attempt < tries; attempt++) {
      await new Promise((done) => setTimeout(done, waitMs));
      for (const file of pickReplays(listReplays(this.folder), matchStartMs, matchEndMs, this.used)) {
        const result = { ...(await this.run(join(this.folder, file))), file };
        // a replay that began after this match ended is the next match's, even if it could already be read
        const began = replayStartMs(result);
        if (result.ok && (began === undefined || began < matchEndMs)) {
          this.used.add(file);
          return result;
        }
        if (!result.ok) last = result;
      }
    }
    return last;
  }

  private run(path: string): Promise<ReplayResult> {
    return new Promise((done) => {
      execFile(this.helper, [path], { windowsHide: true, timeout: 120_000 }, (error, stdout) => {
        try {
          done(JSON.parse(stdout.trim().split('\n').pop() ?? '') as ReplayResult);
        } catch {
          done({ ok: false, error: error?.message ?? 'no answer from chest-replay' });
        }
      });
    });
  }
}
