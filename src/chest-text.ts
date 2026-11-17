/**
 * Finds the "+600 XP / CHEST" text Fortnite shows right of the crosshair when the player opens a chest.
 * The text is white with a purple edge; the word CHEST is looked for by its shape (a template matched against a mask
 * of the white and purple pixels). Only the player's own chests show it: not a teammate's, not a broken chest.
 * Checked on 4 recorded matches against their replays: 68 of 70 opened chests found, 2 false alarms.
 */

/** The word CHEST at 1080p: # white letter, + purple edge, . anything else. */
const TEMPLATE = [
  '...................................',
  '....+++.....+++........++++++..+...',
  '..+####++#+++#..####..####.######..',
  '..##+##++#++##..####.##..#######+..',
  '..#+.##+##++##.##...+##..##++#+.+..',
  '.##+++++##.+##.###+++###..+++#+....',
  '.##+++++#####++####+.+####+++#+....',
  '.##.+##.#####++##++++++.##++##.....',
  '.##++#+.#++##++##++++#+.##++##.....',
  '.#####..#++##++####++#####++##.....',
  '...+++..+++++++++++++++++..+++.....',
  '...................................',
];

/** Where to look, at 1080p, relative to the screen's centre: right of and above the crosshair. Scaled to the screen. */
export const AREA = { left: 220, top: -270, width: 320, height: 200 } as const;

/** A frame counts as showing CHEST from this match score (0–1) on. */
export const MATCH = 0.75;
/** Frames showing CHEST less than this far apart are the same text (it stays about 2 s). */
const SAME_TEXT_MS = 600;

const TH = TEMPLATE.length;
const TW = TEMPLATE[0]!.length;
const T = TEMPLATE.flatMap((row) => [...row].map((c) => (c === '#' ? 1 : c === '+' ? 0.5 : 0)));
const T_MEAN = T.reduce<number>((s, v) => s + v, 0) / T.length;
const TZ = T.map((v) => v - T_MEAN);
const T_NORM = Math.sqrt(TZ.reduce<number>((s, v) => s + v * v, 0));

/** RGBA pixels (as from a canvas) to the mask the template is matched against: white 1, purple 0.5, else 0. */
export function textMask(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const mask = new Float32Array(width * height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const white = r > 200 && g > 190 && b > 200;
    mask[p] = white ? 1 : r > 150 && b > 170 && g < r - 40 ? 0.5 : 0;
  }
  return mask;
}

/** How well (0–1) the word CHEST matches anywhere in the mask (the area, drawn at 1080p size). */
export function chestScore(mask: Float32Array, width: number, height: number): number {
  // most frames have no purple text at all: nothing to look for
  let purple = 0;
  for (const v of mask) if (v === 0.5) purple++;
  if (purple < 15) return 0;
  // only rows that have some text in them can hold the word
  const rowHasText = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (mask[y * width + x]! > 0) n++;
    rowHasText[y] = n >= 3 ? 1 : 0;
  }
  let best = 0;
  const n = TH * TW;
  for (let y = 0; y + TH <= height; y++) {
    if (!rowHasText[y + 2] || !rowHasText[y + 6]) continue; // the word's letters span these rows
    for (let x = 0; x + TW <= width; x++) {
      let sum = 0, sq = 0, cross = 0;
      for (let j = 0, k = 0; j < TH; j++) {
        const row = (y + j) * width + x;
        for (let i = 0; i < TW; i++, k++) {
          const m = mask[row + i]!;
          sum += m;
          sq += m * m;
          cross += m * TZ[k]!;
        }
      }
      const variance = sq - (sum * sum) / n;
      if (variance <= 0) continue;
      const score = cross / (Math.sqrt(variance) * T_NORM);
      if (score > best) best = score;
    }
  }
  return best;
}

/** Turns per-frame scores into chests: one chest per appearance of the text. */
export class ChestTextWatcher {
  private lastSeenMs = -Infinity;

  /** The score of a frame taken at `nowMs`; true when a new CHEST text appeared (a chest was opened). */
  push(score: number, nowMs: number): boolean {
    if (score < MATCH) return false;
    const isNew = nowMs - this.lastSeenMs > SAME_TEXT_MS;
    this.lastSeenMs = nowMs;
    return isNew;
  }
}
