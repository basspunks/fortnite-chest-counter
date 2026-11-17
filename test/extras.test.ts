import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hourToAnnounce, readContent } from '../src/content';
import { obsPage } from '../src/obs';

const content = readContent(JSON.parse(readFileSync(join(__dirname, '..', 'content', 'content.json'), 'utf8')))!;

describe('Treasure Hour reminder', () => {
  const start = '2026-11-14T19:00:00Z'; // a Treasure Hour in the data

  it('fires in the five minutes before a Treasure Hour, once', () => {
    expect(hourToAnnounce(content, Date.parse(start) - 10 * 60_000, new Set())).toBeUndefined();
    expect(hourToAnnounce(content, Date.parse(start) - 4 * 60_000, new Set())?.start).toBe(start);
    expect(hourToAnnounce(content, Date.parse(start) - 4 * 60_000, new Set([start]))).toBeUndefined();
    expect(hourToAnnounce(content, Date.parse(start) + 60_000, new Set())).toBeUndefined(); // already running
  });
});

describe('OBS page', () => {
  it('shows the three numbers and the last matches, and reloads itself', () => {
    const html = obsPage({ counts: { match: 6, session: 14, total: 5009 }, last: [33, 26] });
    expect(html).toContain('<b>6</b>');
    expect(html).toContain('<b>5,009</b>');
    expect(html).toContain('33 · 26');
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('background: transparent');
  });

  it('leaves the second line out before the first match', () => {
    expect(obsPage({ counts: { match: 0, session: 0, total: 0 }, last: [] })).not.toContain('class="last"');
  });
});
