import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The GitHub repository whose releases carry ChestCounter.exe. */
export const REPOSITORY = 'basspunks/fortnite-chest-counter';
const ASSET = 'ChestCounter.exe';

export interface Release {
  readonly version: string;
  readonly url: string;
  readonly notes: string;
}

/** "1.10.0" > "1.9.2"; a leading "v" is ignored. Missing parts count as 0. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string): number[] => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The latest release, if it is newer than `current` and has the exe; undefined otherwise (or offline). */
export async function newerRelease(current: string): Promise<Release | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return undefined;
    const release = (await response.json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
    const asset = release.assets?.find((a) => a.name === ASSET);
    if (!release.tag_name || !asset || !isNewer(release.tag_name, current)) return undefined;
    return { version: release.tag_name.replace(/^v/i, ''), url: asset.browser_download_url, notes: release.body ?? '' };
  } catch {
    return undefined;
  }
}

/** Downloads the new exe next to nothing important (the temp folder) and returns its path. */
export async function download(release: Release): Promise<string> {
  const response = await fetch(release.url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const file = join(tmpdir(), `ChestCounter-${release.version}.exe`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/**
 * Swaps the running exe for the downloaded one and starts it again. The exe cannot be replaced while it runs, so a
 * small script waits until the app has closed, copies the new file over the old one and starts it; the caller quits.
 */
export function replaceAndRestart(downloaded: string, runningExe: string): void {
  const script = join(tmpdir(), 'chest-counter-update.cmd');
  writeFileSync(
    script,
    [
      '@echo off',
      ':retry',
      'timeout /t 1 /nobreak >nul',
      `copy /y "${downloaded}" "${runningExe}" >nul 2>&1 || goto retry`,
      `del "${downloaded}" >nul 2>&1`,
      `start "" "${runningExe}"`,
      'del "%~f0"',
    ].join('\r\n'),
  );
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
