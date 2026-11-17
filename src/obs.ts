import type { Counts } from './counter';

/** What the page for OBS shows. */
export interface ObsNumbers {
  readonly counts: Counts;
  /** Chests in the last matches, newest first. */
  readonly last: readonly number[];
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const format = (n: number): string => n.toLocaleString('en-US');

/**
 * A stand-alone page with the counter's numbers on a transparent background, for an OBS "Browser" source
 * pointing at the local file. It reloads itself every 2 seconds, so it follows the counter.
 */
export function obsPage({ counts, last }: ObsNumbers): string {
  const stat = (label: string, value: number, main = false): string =>
    `<div class="stat${main ? ' main' : ''}"><span>${label}</span><b>${format(value)}</b></div>`;
  const lastLine = last.length === 0 ? '' : `<div class="last"><span>Last</span> ${escape(last.join(' · '))}</div>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Chest Counter</title>
<style>
  html, body { margin: 0; background: transparent; }
  body { padding: 8px 12px; font: 13px 'Segoe UI', system-ui, sans-serif; color: #fff;
         text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 5px rgb(0 0 0 / .85); }
  .row { display: flex; align-items: flex-end; }
  .stat { display: flex; flex-direction: column; padding: 0 14px; }
  .stat:first-child { padding-left: 0; }
  .stat + .stat { border-left: 1px solid rgb(255 255 255 / .3); }
  span { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #ddd; }
  b { font-size: 26px; font-weight: 900; font-style: italic; line-height: 1; }
  .main b { font-size: 40px; color: #ffc93c; }
  .last { margin-top: 4px; font-size: 13px; }
</style>
</head>
<body>
<div class="row">${stat('Match', counts.match, true)}${stat('Session', counts.session)}${stat('Total', counts.total)}</div>
${lastLine}
</body>
</html>
`;
}
