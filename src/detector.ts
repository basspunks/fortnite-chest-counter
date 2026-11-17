export type ChestKind = 'gold' | 'rare';

export interface ChestSound {
  /** Seconds since the first sample was pushed. */
  readonly at: number;
  readonly kind: ChestKind;
  /** How sure the judge is that it was a chest (0–1). */
  readonly sure: number;
}

/**
 * A closed chest hums: a few steady notes you hear while standing next to it.
 * Opening it gives a short bright burst and the hum stops. The detector listens in two steps:
 *
 * 1. Candidates: hum before, burst now, less hum after (loose, so that almost no chest is missed).
 * 2. A learned judge decides which candidates are chests. It was trained on 13 recorded clips where every
 *    candidate was checked against the video (91 chests, 60 look-alikes: breaking boxes and walls, doors, shots...).
 *    What tells them apart best is how long the hum was heard before: a chest hums the whole time you walk up to it.
 *    Checked since against 4 more clips labelled from their matches' replays: it heard 48 of their 63 opened chests,
 *    with 2 false alarms; a judge retrained with them did not do better overall, so this one stays.
 *
 * Normal (gold) and rare (purple) chests hum on different notes. Spirit chests (behind the vault doors) are mostly
 * missed, and chests broken rather than opened make no opening sound: the replay counts both after the match.
 */
const TONES: Readonly<Record<ChestKind, readonly number[]>> = {
  gold: [392, 784, 1568, 1760, 2349, 3136],
  rare: [328, 656, 1307, 3533, 4480],
};
/** How many of a chest's notes must stand out at once: the 4th strongest of 6, the 3rd of 5. */
const RANK: Readonly<Record<ChestKind, number>> = { gold: 3, rare: 2 };
/** Candidates: some hum before (dB), a burst (dB) and a drop of the hum (dB). */
const CANDIDATE = { hum: 3, burst: 1.5, drop: 1.5 } as const;
/** A frame "hums" when its hum stands out this much (dB); used for how long the hum lasted before. */
const HUMMING = 6;
/**
 * The learned judge: logistic regression on [gold drop, rare drop, burst, gold hum share, rare hum share, low band
 * change]. Learned from the 13 recordings; see the comment above.
 */
const JUDGE = { weights: [0.1588, -0.2243, -0.1006, 2.9593, 2.8015, -0.057], bias: -4.2958 } as const;
/** Burst: the bright 4–10 kHz band. Low band: the thump of wood and walls breaking. */
const BURST_BAND = [4000, 10000] as const;
const LOW_BAND = [80, 1000] as const;

const N = 4096; // samples per analysis frame
const FPS = 50; // analysis frames per second
// Windows, in frames relative to the moment being judged.
const HUM_BEFORE = [-52, -8] as const;
const HUM_AFTER = [30, 75] as const;
const BURST_NOW = [0, 10] as const;
const BURST_BEFORE = [-25, -5] as const;
/** A candidate must be the strongest within this many frames on each side (1.2 s). */
const PEAK = 60;
/** Two candidates closer than this are one sound. */
const MIN_GAP_SECONDS = 1;

const KINDS: readonly ChestKind[] = ['gold', 'rare'];

/** What the judge looks at for one candidate. */
interface Candidate {
  readonly score: number;
  readonly kind: ChestKind;
  readonly features: readonly number[];
}

/** Takes audio in chunks of any size and returns the chest openings it heard, about 2.7 s late. */
export class ChestDetector {
  private readonly hop: number;
  private readonly window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  private readonly re = new Float64Array(N);
  private readonly im = new Float64Array(N);
  private readonly db = new Float64Array(N / 2);
  private readonly buffer = new Float32Array(N * 4);
  private filled = 0;

  // Per-frame values, stored from frame `first` on.
  private first = 0;
  private readonly hum: Record<ChestKind, number[]> = { gold: [], rare: [] };
  private readonly burst: number[] = [];
  private readonly low: number[] = [];
  private readonly candidates: Candidate[] = [];
  private frames = 0;
  private scored = 0;
  private checked = 0;
  private lastCandidate = -Infinity;

  /** The judge's answer (0–1) a candidate needs to count as a chest. */
  private readonly cut: number;

  /**
   * @param sensitivity 0 = fewest false alarms … 1 = catch the most chests; 0.5 is the learned setting.
   */
  constructor(
    private readonly rate: number,
    sensitivity = 0.5,
  ) {
    this.hop = Math.round(rate / FPS);
    this.cut = judgeCut(sensitivity);
  }

  push(samples: Float32Array): ChestSound[] {
    const found: ChestSound[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, this.buffer.length - this.filled);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      while (this.filled >= N) {
        this.analyse(this.buffer.subarray(0, N));
        this.buffer.copyWithin(0, this.hop, this.filled);
        this.filled -= this.hop;
        found.push(...this.judge());
      }
    }
    return found;
  }

  /** Hum strength of both chest kinds, and the loudness of the burst and low bands, for one frame. */
  private analyse(frame: Float32Array): void {
    for (let i = 0; i < N; i++) {
      this.re[i] = frame[i]! * this.window[i]!;
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    let band = 0;
    let lowBand = 0;
    const [high0, high1] = BURST_BAND.map((hz) => Math.round((hz * N) / this.rate));
    const [low0, low1] = LOW_BAND.map((hz) => Math.round((hz * N) / this.rate));
    for (let k = 0; k < N / 2; k++) {
      const power = this.re[k]! ** 2 + this.im[k]! ** 2;
      this.db[k] = 10 * Math.log10(power + 1e-9);
      if (k > high0! && k < high1!) band += power;
      if (k > low0! && k < low1!) lowBand += power;
    }
    this.burst.push(10 * Math.log10(band + 1e-9));
    this.low.push(10 * Math.log10(lowBand + 1e-9));
    for (const kind of KINDS) {
      const strengths = TONES[kind].map((hz) => this.toneStrength(hz)).sort((a, b) => b - a);
      this.hum[kind].push(strengths[RANK[kind]]!);
    }
    this.frames++;
  }

  /** How far (dB, 0–25) a note stands out above the sound around it. */
  private toneStrength(hz: number): number {
    const k0 = (hz * N) / this.rate;
    const width = Math.max(2, k0 * 0.02);
    let peak = -Infinity;
    for (let k = Math.round(k0 - width); k <= Math.round(k0 + width); k++) peak = Math.max(peak, this.db[k] ?? -Infinity);
    const around: number[] = [];
    for (let k = Math.round(k0 - 4 * width); k <= Math.round(k0 + 4 * width); k++) {
      if (Math.abs(k - k0) > 2 * width && this.db[k] !== undefined) around.push(this.db[k]!);
    }
    around.sort((a, b) => a - b);
    return Math.max(0, Math.min(25, peak - around[around.length >> 1]!));
  }

  private judge(): ChestSound[] {
    // Each frame's candidate score, once the frames after it have been heard.
    while (this.scored + HUM_AFTER[1] < this.frames) this.candidates.push(this.candidateAt(this.scored++));
    // A candidate at frame f if its score is the biggest around; the learned judge then decides.
    const found: ChestSound[] = [];
    while (this.checked + PEAK < this.scored) {
      const f = this.checked++;
      const candidate = this.candidates[f - this.first]!;
      if (candidate.score < CANDIDATE.drop) continue;
      if (this.slice(this.candidates, Math.max(this.first, f - PEAK), f + PEAK + 1).some((other) => other.score > candidate.score)) continue;
      const at = (f * this.hop + N / 2) / this.rate;
      if (at - this.lastCandidate <= MIN_GAP_SECONDS) continue;
      this.lastCandidate = at;
      const sure = chestLikelihood(candidate.features);
      if (sure >= this.cut) found.push({ at, kind: candidate.kind, sure });
    }
    this.forgetOld();
    return found;
  }

  /** How much the hum fell at frame f with a burst, and what the judge needs to know about it. */
  private candidateAt(f: number): Candidate {
    const none: Candidate = { score: 0, kind: 'gold', features: [] };
    if (f + HUM_BEFORE[0] < this.first) return none;
    const burst = average(this.slice(this.burst, f + BURST_NOW[0], f + BURST_NOW[1])) -
      average(this.slice(this.burst, f + BURST_BEFORE[0], f + BURST_BEFORE[1]));
    if (burst <= CANDIDATE.burst) return none;
    const low = average(this.slice(this.low, f + BURST_NOW[0], f + BURST_NOW[1])) -
      average(this.slice(this.low, f + BURST_BEFORE[0], f + BURST_BEFORE[1]));
    const drops: Record<ChestKind, number> = { gold: 0, rare: 0 };
    const shares: Record<ChestKind, number> = { gold: 0, rare: 0 };
    let kind: ChestKind = 'gold';
    let score = 0;
    for (const k of KINDS) {
      const before = this.slice(this.hum[k], f + HUM_BEFORE[0], f + HUM_BEFORE[1] + 1);
      const level = [...before].sort((a, b) => a - b)[9]!;
      drops[k] = level - average(this.slice(this.hum[k], f + HUM_AFTER[0], f + HUM_AFTER[1]));
      shares[k] = before.filter((value) => value > HUMMING).length / before.length;
      const kindScore = level > CANDIDATE.hum ? drops[k] : 0;
      if (kindScore > score) {
        score = kindScore;
        kind = k;
      }
    }
    return { score, kind, features: [drops.gold, drops.rare, burst, shares.gold, shares.rare, low] };
  }

  /** Values of frames [from, to). */
  private slice<T>(values: T[], from: number, to: number): T[] {
    return values.slice(from - this.first, to - this.first);
  }

  /** Keeps memory flat during a long session: only the last few seconds are ever looked at. */
  private forgetOld(): void {
    const keepFrom = this.checked - 2 * PEAK - HUM_AFTER[1];
    if (keepFrom - this.first < 3000) return;
    const cut = keepFrom - this.first;
    for (const values of [this.hum.gold, this.hum.rare, this.burst, this.low, this.candidates] as unknown[][]) values.splice(0, cut);
    this.first = keepFrom;
  }
}

/** What the judge's answer must reach for a candidate to count, at a sensitivity from 0 to 1. */
export function judgeCut(sensitivity: number): number {
  return 0.75 - 0.3 * Math.min(1, Math.max(0, sensitivity));
}

/**
 * The learned judge: how likely (0–1) a candidate is a chest, from [gold drop, rare drop, burst, gold hum share,
 * rare hum share, low band change].
 */
export function chestLikelihood(features: readonly number[]): number {
  const z = features.reduce((sum, value, i) => sum + JUDGE.weights[i]! * value, JUDGE.bias);
  return 1 / (1 + Math.exp(-z));
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}
