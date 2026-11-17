import { execFile, spawn, type ChildProcess } from 'node:child_process';

import { appFile } from './paths';

/** The game's own process (the launcher and anti-cheat are other processes). Tests point it at a stand-in program. */
export const GAME_PROCESS = process.env['CHEST_GAME_PROCESS'] ?? 'FortniteClient-Win64-Shipping.exe';
const LOOK_EVERY_MS = 5000;

/**
 * - waiting: Fortnite is not running (checked every few seconds)
 * - on: hearing only Fortnite's sound
 * - unsupported: this Windows cannot capture one program's sound; counting by sound stays off
 */
export type GameAudioStatus = 'waiting' | 'on' | 'unsupported';

/**
 * Hears only Fortnite: finds the game's process and runs native/app-audio.ps1 on it,
 * which hands back 16-bit mono sound at 24 kHz.
 */
export class GameAudio {
  status: GameAudioStatus = 'waiting';
  /** Why it is unsupported, as Windows put it. */
  problem = '';
  private helper: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private leftover = Buffer.alloc(0);

  constructor(
    private readonly onSound: (samples: Float32Array) => void,
    private readonly onStatus: () => void,
  ) {}

  start(): void {
    if (this.timer !== undefined || this.status === 'unsupported') return;
    this.look();
    this.timer = setInterval(() => this.look(), LOOK_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.helper?.kill();
    this.helper = undefined;
    if (this.status === 'on') this.setStatus('waiting');
  }

  private look(): void {
    if (this.helper !== undefined) return;
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, output) => {
      if (error !== null || this.helper !== undefined || this.timer === undefined) return;
      const pid = /^"[^"]+","(\d+)"/m.exec(output)?.[1];
      if (pid !== undefined) this.listenTo(Number(pid));
    });
  }

  private listenTo(pid: number): void {
    const script = appFile('native', 'app-audio.ps1');
    const helper = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProcessId', String(pid)],
      { windowsHide: true },
    );
    this.helper = helper;
    let errors = '';
    helper.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    helper.stdout.on('data', (chunk: Buffer) => {
      if (this.status !== 'on') this.setStatus('on');
      this.onSound(this.toSamples(chunk));
    });
    helper.on('exit', (code) => {
      if (this.helper !== helper) return; // stopped on purpose
      this.helper = undefined;
      this.leftover = Buffer.alloc(0);
      if (code === 2) {
        // Windows refused to capture one program: only this means "not supported on this PC"
        this.problem = errors.trim();
        this.stop();
        this.setStatus('unsupported');
      } else {
        this.setStatus('waiting'); // the game closed or was restarted: look for it again
      }
    });
  }

  /** 16-bit samples to floats; a chunk may end in the middle of a sample. */
  private toSamples(chunk: Buffer): Float32Array {
    const bytes = this.leftover.length > 0 ? Buffer.concat([this.leftover, chunk]) : chunk;
    const count = bytes.length >> 1;
    this.leftover = Buffer.from(bytes.subarray(count * 2));
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
    return samples;
  }

  private setStatus(status: GameAudioStatus): void {
    this.status = status;
    this.onStatus();
  }
}
