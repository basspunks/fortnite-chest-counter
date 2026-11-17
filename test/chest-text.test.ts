import { describe, expect, it } from 'vitest';

import { ChestTextWatcher, chestScore, MATCH, textMask } from '../src/chest-text';
import fixture from './fixtures/chest-text.json';

/** A mask from the test data: run-length coded rows, 0 nothing, 1 purple edge, 2 white letter. */
function mask(frame: { width: number; height: number; rows: string[] }): Float32Array {
  const out = new Float32Array(frame.width * frame.height);
  frame.rows.forEach((row, y) => {
    let x = 0;
    for (const piece of row.split(',')) {
      const count = Number(piece.slice(0, -1));
      const value = Number(piece.slice(-1)) / 2;
      out.fill(value, y * frame.width + x, y * frame.width + x + count);
      x += count;
    }
  });
  return out;
}

describe('the CHEST text on real frames', () => {
  for (const frame of fixture.frames) {
    it(`${frame.chest ? 'finds' : 'finds nothing in'} "${frame.what}"`, () => {
      const score = chestScore(mask(frame), frame.width, frame.height);
      if (frame.chest) expect(score).toBeGreaterThanOrEqual(MATCH);
      else expect(score).toBeLessThan(MATCH);
    });
  }
});

describe('textMask', () => {
  it('marks white letters, their purple edge and nothing else', () => {
    const pixels = new Uint8ClampedArray([255, 250, 255, 255, 220, 120, 235, 255, 40, 200, 90, 255]);
    expect([...textMask(pixels, 3, 1)]).toEqual([1, 0.5, 0]);
  });
});

describe('ChestTextWatcher', () => {
  it('counts one chest per appearance of the text, however many frames show it', () => {
    const watcher = new ChestTextWatcher();
    const seen = [0, 200, 400, 600, 800].map((ms) => watcher.push(0.9, ms));
    expect(seen).toEqual([true, false, false, false, false]);
    expect(watcher.push(0.1, 1000)).toBe(false); // gone
    expect(watcher.push(0.9, 2500)).toBe(true); // the next chest
  });
});
