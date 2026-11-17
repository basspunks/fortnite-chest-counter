/**
 * Finds the "+600 XP / CHEST" text Fortnite shows right of the crosshair when the player opens a chest.
 * The text is white with a purple edge; the word CHEST is looked for by its shape (a template matched against a mask
 * of the white and purple pixels). Only the player's own chests show it: not a teammate's, not a broken chest.
 * Chests opened one after another are listed together under one "+XP": "RARE CHEST X2", "SPRITE CHEST", ... so every
 * line is read, and an "X2" after the word counts twice.
 * Checked on 5 recorded matches (4 against their replays: 68 of 70 opened chests found, 1 false alarm; the fifth has
 * five chests opened in six seconds, all found).
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

/** A place counts as showing CHEST from this match score (0–1) on. */
export const MATCH = 0.75;
/** A list not seen for longer than this is gone: the next CHEST is a new list (one stays about 2 s). */
const SAME_TEXT_MS = 650;
/** Fewer text pixels than this where the word would be: not the word (skips most places without matching). */
const MIN_TEXT = 60;
/** Two lines of the list are at least this many rows apart (they are about 17 apart). */
const LINE_GAP = 9;
/** "X2" right of the word: this many text pixels there (about 80–120), with little further right (a bright sky fills both). */
const TIMES_TWO = { min: 40, max: 170, beyondMax: 20 } as const;

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

/** A line showing the word CHEST: where the word is (its template's top left) and how well it matches. */
export interface ChestLine {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/** Sums over rectangles in four lookups: of the mask, of its squares and of its text pixels. */
function integrals(mask: Float32Array, width: number, height: number): [Float64Array, Float64Array, Int32Array] {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sq = new Float64Array(stride * (height + 1));
  const count = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rs = 0, rq = 0, rc = 0;
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x]!;
      rs += v;
      rq += v * v;
      if (v > 0) rc++;
      const at = (y + 1) * stride + x + 1;
      sum[at] = sum[at - stride]! + rs;
      sq[at] = sq[at - stride]! + rq;
      count[at] = count[at - stride]! + rc;
    }
  }
  return [sum, sq, count];
}

/** The best match score of each place's row, and where on that row (the area, drawn at 1080p size). */
function scoreRows(mask: Float32Array, width: number, height: number): { score: Float32Array; x: Int32Array } {
  const rows = { score: new Float32Array(height), x: new Int32Array(height).fill(-1) };
  // most frames have no purple text at all: nothing to look for
  let purple = 0;
  for (const v of mask) if (v === 0.5) purple++;
  if (purple < 15) return rows;
  const [sum, sq, count] = integrals(mask, width, height);
  const stride = width + 1;
  const box = (table: Float64Array | Int32Array, x: number, y: number): number =>
    table[(y + TH) * stride + x + TW]! - table[y * stride + x + TW]! - table[(y + TH) * stride + x]! + table[y * stride + x]!;
  const n = TH * TW;
  for (let y = 0; y + TH <= height; y++) {
    for (let x = 0; x + TW <= width; x++) {
      if (box(count, x, y) < MIN_TEXT) continue;
      const s = box(sum, x, y);
      const variance = box(sq, x, y) - (s * s) / n;
      if (variance <= 0) continue;
      let cross = 0;
      for (let j = 0, k = 0; j < TH; j++) {
        const row = (y + j) * width + x;
        for (let i = 0; i < TW; i++, k++) cross += mask[row + i]! * TZ[k]!;
      }
      const score = cross / (Math.sqrt(variance) * T_NORM);
      if (score > rows.score[y]!) {
        rows.score[y] = score;
        rows.x[y] = x;
      }
    }
  }
  return rows;
}

/** How well (0–1) the word CHEST matches anywhere in the mask (the area, drawn at 1080p size). */
export function chestScore(mask: Float32Array, width: number, height: number): number {
  return Math.max(0, ...scoreRows(mask, width, height).score);
}

/** Every line showing the word CHEST, top to bottom. */
export function chestLines(mask: Float32Array, width: number, height: number): ChestLine[] {
  const rows = scoreRows(mask, width, height);
  const found: ChestLine[] = [];
  for (let y = 0; y < height; y++) if (rows.score[y]! >= MATCH) found.push({ x: rows.x[y]!, y, score: rows.score[y]! });
  // the word matches on a few rows around its own: keep the best of each line
  found.sort((a, b) => b.score - a.score);
  const lines: ChestLine[] = [];
  for (const line of found) if (!lines.some((l) => Math.abs(l.y - line.y) < LINE_GAP)) lines.push(line);
  return lines.sort((a, b) => a.y - b.y);
}

/** Text pixels in the columns [from, to) right of a line's word, on the word's rows. */
function textRightOf(mask: Float32Array, width: number, line: ChestLine, from: number, to: number): number {
  let n = 0;
  for (let y = line.y + 1; y < line.y + TH - 1; y++) {
    for (let x = line.x + from; x < Math.min(width, line.x + to); x++) if (mask[y * width + x]! > 0) n++;
  }
  return n;
}

/** The chests each CHEST line of the mask stands for, top to bottom: 2 for "... CHEST X2", 1 otherwise. */
export function chestsShown(mask: Float32Array, width: number, height: number): number[] {
  return chestLines(mask, width, height).map((line) => {
    const after = textRightOf(mask, width, line, TW - 2, TW + 23);
    const beyond = textRightOf(mask, width, line, TW + 25, TW + 50);
    return after >= TIMES_TWO.min && after <= TIMES_TWO.max && beyond < TIMES_TWO.beyondMax ? 2 : 1;
  });
}

/** Turns what each frame shows into opened chests: one list of CHEST lines counts each of its chests once. */
export class ChestTextWatcher {
  private lastSeenMs = -Infinity;
  private counted = 0;
  private previous = '';

  /** What a frame taken at `nowMs` shows (from chestsShown); returns how many chests were opened since the last one. */
  push(shown: readonly number[], nowMs: number): number {
    if (shown.length === 0) return 0;
    if (nowMs - this.lastSeenMs > SAME_TEXT_MS) {
      // a new list
      this.counted = 0;
      this.previous = '';
    }
    this.lastSeenMs = nowMs;
    // the same reading twice in a row: a frame read wrongly once (a flash behind the text) counts nothing
    const reading = shown.join(',');
    const steady = reading === this.previous;
    this.previous = reading;
    const total = shown.reduce((s, v) => s + v, 0);
    if (!steady || total <= this.counted) return 0;
    const opened = total - this.counted;
    this.counted = total;
    return opened;
  }
}
