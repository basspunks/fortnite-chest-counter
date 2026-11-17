import { execFile } from 'node:child_process';

import { GAME_PROCESS } from './game-audio';

/** Is Fortnite running? Only looks at the list of programs, like Task Manager. */
export function fortniteRunning(): Promise<boolean> {
  return new Promise((done) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, output) => {
      done(error === null && output.includes(GAME_PROCESS));
    });
  });
}

/**
 * "Open with Fortnite": the counter shows while the game runs and hides a while after it closes
 * (time enough for the last match's replay to be read).
 */
export class FortniteWatch {
  private timer: NodeJS.Timeout | undefined;
  private closedAt: number | undefined;
  private wasRunning = false;

  constructor(
    /** true: show it, false: hide it. Not called while the game has not been seen yet (the window stays as it is). */
    private readonly onChange: (show: boolean) => void,
    private readonly lingerMs = 90_000,
  ) {}

  start(everyMs = 5000): void {
    if (this.timer !== undefined) return;
    void this.look();
    this.timer = setInterval(() => void this.look(), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * What the counter should do given whether the game runs now (separate from the timer, for tests):
   * show, hide, or undefined = leave it (the game has not run yet, e.g. the counter was opened by hand).
   */
  decide(running: boolean, nowMs: number): boolean | undefined {
    if (running) {
      this.closedAt = undefined;
      this.wasRunning = true;
      return true;
    }
    if (this.wasRunning) {
      this.closedAt ??= nowMs;
      return nowMs - this.closedAt < this.lingerMs;
    }
    return undefined;
  }

  private async look(): Promise<void> {
    const show = this.decide(await fortniteRunning(), Date.now());
    if (show !== undefined) this.onChange(show);
  }
}
