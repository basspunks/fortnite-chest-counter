import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * - start: a Battle Royale match began (the pre-game island, before the bus)
 * - lobby: back in the menus
 */
export type MatchEvent = 'start' | 'lobby';

/** The two lines of Fortnite's own log that matter here. */
const START = /HandleGamePhaseChanged\. OldPhase = EAthenaGamePhase::\w+\. NewPhase = EAthenaGamePhase::Warmup/;
const LOBBY = /LogLoad: LoadMap: \/Game\/Maps\/Frontend/;

/** The match events in a piece of the log, in order. */
export function matchEvents(text: string): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (const line of text.split('\n')) {
    if (START.test(line)) events.push('start');
    else if (LOBBY.test(line)) events.push('lobby');
  }
  return events;
}

export function defaultLogFile(): string {
  return join(process.env['LOCALAPPDATA'] ?? '', 'FortniteGame', 'Saved', 'Logs', 'FortniteGame.log');
}

/**
 * Follows Fortnite's log file (FortniteGame.log) like `tail -f`: reads only what was added since the last look.
 * The game starts a new file every launch. It is recognised by its first line ("Log file open, <date and time>"):
 * the file getting shorter is not enough, as the game writes megabytes in its first seconds and can be past the old
 * length before the next look (a whole match was missed that way).
 * Reading the game's own log file is passive; nothing touches the game.
 */
export class MatchLog {
  private offset: number | undefined;
  private head: string | undefined;
  private partial = '';
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onEvent: (event: MatchEvent) => void,
    private readonly file = defaultLogFile(),
  ) {}

  /** Starts at the end of the file: what happened before the app started does not count. */
  start(everyMs = 1000): void {
    this.offset = this.size();
    this.head = this.firstBytes();
    this.timer = setInterval(() => this.poll(), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Is there a log to follow at all (Fortnite installed and launched at least once)? */
  found(): boolean {
    return this.size() !== undefined;
  }

  poll(): void {
    const size = this.size();
    if (size === undefined) return;
    const head = this.firstBytes();
    if (this.offset === undefined || size < this.offset || head !== this.head) {
      this.offset = 0; // a new log: the game was started again
      this.head = head;
      this.partial = '';
    }
    if (size === this.offset) return;
    const length = Math.min(size - this.offset, 4 * 1024 * 1024); // the rest is read on the next look
    const buffer = Buffer.alloc(length);
    const handle = openSync(this.file, 'r');
    try {
      readSync(handle, buffer, 0, length, this.offset);
    } finally {
      closeSync(handle);
    }
    this.offset += length;
    const text = this.partial + buffer.toString('utf8');
    const lastBreak = text.lastIndexOf('\n');
    this.partial = text.slice(lastBreak + 1); // a line still being written
    matchEvents(text.slice(0, lastBreak + 1)).forEach((event) => this.onEvent(event));
  }

  /** The start of the file, which names when the game opened it. */
  private firstBytes(): string | undefined {
    try {
      const buffer = Buffer.alloc(64);
      const handle = openSync(this.file, 'r');
      try {
        return buffer.toString('utf8', 0, readSync(handle, buffer, 0, 64, 0));
      } finally {
        closeSync(handle);
      }
    } catch {
      return undefined;
    }
  }

  private size(): number | undefined {
    try {
      return statSync(this.file).size;
    } catch {
      return undefined;
    }
  }
}
