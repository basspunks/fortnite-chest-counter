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

/**
 * Downloads the new exe next to nothing important (the temp folder) and returns its path. `onProgress` hears how much
 * of it has come (0–1) as it comes, when GitHub says how big it is.
 */
export async function download(release: Release, onProgress?: (done: number) => void): Promise<string> {
  const response = await fetch(release.url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || response.body === null) throw new Error(`download failed (${response.status})`);
  const size = Number(response.headers.get('content-length')) || 0;
  const parts: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    if (size > 0) onProgress?.(Math.min(1, received / size));
  }
  if (size > 0 && received !== size) throw new Error('download cut short');
  const file = join(tmpdir(), `ChestCounter-${release.version}.exe`);
  writeFileSync(file, Buffer.concat(parts));
  return file;
}

/** A path as a PowerShell string (single quotes, any quote inside doubled). */
const quoted = (path: string): string => `'${path.replace(/'/g, "''")}'`;

/**
 * Swaps the running exe for the downloaded one and starts it again. The exe cannot be replaced while it runs, so a
 * PowerShell script waits until the app has closed (trying for up to a minute), copies the new file over the old one
 * and starts it; the caller quits. A cmd script did this before and flashed a console window several times.
 * wscript starts PowerShell with no window at all, and unlike PowerShell started straight from here it outlives the app.
 */
export function replaceAndRestart(downloaded: string, runningExe: string): void {
  const ps1 = join(tmpdir(), 'ChestCounter-update.ps1');
  const vbs = join(tmpdir(), 'ChestCounter-update.vbs');
  const script = [
    `$from = ${quoted(downloaded)}`,
    `$to = ${quoted(runningExe)}`,
    'for ($i = 0; $i -lt 60; $i++) { try { Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 1 } }',
    'Remove-Item -LiteralPath $from -ErrorAction SilentlyContinue',
    `Remove-Item -LiteralPath ${quoted(vbs)} -ErrorAction SilentlyContinue`,
    'Start-Process -FilePath $to',
    'Remove-Item -LiteralPath $PSCommandPath -ErrorAction SilentlyContinue',
  ].join('\r\n');
  // a BOM in each, so a path with letters like ş or ü reads right (PowerShell 5 and wscript assume ANSI otherwise)
  writeFileSync(ps1, `﻿${script}`, 'utf8');
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1}""`;
  writeFileSync(vbs, `﻿CreateObject("WScript.Shell").Run "${command}", 0, False\r\n`, 'utf16le');
  spawn('wscript.exe', ['//B', '//Nologo', vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
