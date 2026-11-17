import { describe, expect, it } from 'vitest';

import { ChestTextWatcher, chestScore, chestsShown, MATCH, textMask } from '../src/chest-text';
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
  for (const frame of fixture.frames.filter((f) => 'shown' in f)) {
    it(`reads each line of "${frame.what}"`, () => {
      expect(chestsShown(mask(frame), frame.width, frame.height)).toEqual((frame as { shown: number[] }).shown);
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
    const opened = [0, 200, 400, 600, 800].map((ms) => watcher.push([1], ms));
    expect(opened).toEqual([0, 1, 0, 0, 0]); // read the same twice first
    expect(watcher.push([], 1000)).toBe(0); // gone
    expect([2500, 2700].map((ms) => watcher.push([1], ms))).toEqual([0, 1]); // the next chest
  });

  it('counts every chest of a list opened one after another', () => {
    // RARE CHEST, then X2, then SPRITE CHEST under it, then RARE CHEST, then that one X2 too: 5 chests
    const frames: number[][] = [[1], [1], [2], [2], [2, 1], [2, 1], [2, 1, 1], [2, 1, 1], [2, 1, 2], [2, 1, 2]];
    const watcher = new ChestTextWatcher();
    const opened = frames.map((shown, i) => watcher.push(shown, i * 200));
    expect(opened.reduce((s, n) => s + n, 0)).toBe(5);
  });

  it('counts nothing for a frame read differently once, or a line lost for a moment', () => {
    const watcher = new ChestTextWatcher();
    const frames: number[][] = [[1], [1], [2], [1], [1], [2, 1], [2], [2, 1], [2, 1]];
    const opened = frames.map((shown, i) => watcher.push(shown, i * 200));
    expect(opened.reduce((s, n) => s + n, 0)).toBe(3);
  });
});
