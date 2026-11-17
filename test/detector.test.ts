import { describe, expect, it } from 'vitest';

import { ChestDetector, chestLikelihood, judgeCut, type ChestSound } from '../src/detector';
import fixture from './fixtures/chest-sounds.json';

const RATE = 24000;
const GOLD = [392, 784, 1568, 1760, 2349, 3136];
const RARE = [328, 656, 1307, 3533, 4480];
/** A chest's hum. In the recordings the other notes (RARE) are heard all the time, chest or not. */
const CHEST = GOLD;

/** A fixed pseudo-random source, so every test run hears the same noise. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 1073741824 - 1;
  };
}

/** Builds a test sound: background noise, plus hum and burst where the scene asks for them. */
function scene(seconds: number, parts: { hum?: readonly number[]; humFrom?: number; humUntil?: number; burstAt?: number }): Float32Array {
  const random = noise(7);
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    let value = 0.01 * random();
    for (const hz of RARE) value += 0.02 * Math.sin(2 * Math.PI * hz * t); // the game's steady background
    if (parts.hum !== undefined && t >= (parts.humFrom ?? 0) && t < (parts.humUntil ?? seconds)) {
      for (const hz of parts.hum) value += 0.02 * Math.sin(2 * Math.PI * hz * t);
    }
    if (parts.burstAt !== undefined && t >= parts.burstAt && t < parts.burstAt + 0.25) {
      value += 0.05 * random(); // bright, noisy
    }
    samples[i] = value;
  }
  return samples;
}

/** Feeds the sound in chunks the size live audio arrives in. */
function listen(samples: Float32Array): ChestSound[] {
  const detector = new ChestDetector(RATE);
  const found: ChestSound[] = [];
  for (let i = 0; i < samples.length; i += 4096) found.push(...detector.push(samples.subarray(i, i + 4096)));
  return found;
}

describe('ChestDetector', () => {
  it('hears a chest: hum, burst, then no hum', () => {
    const found = listen(scene(8, { hum: CHEST, humUntil: 3, burstAt: 3 }));
    expect(found).toHaveLength(1);
    expect(found[0]!.at).toBeGreaterThan(2.8);
    expect(found[0]!.at).toBeLessThan(3.3);
  });

  it('ignores a hum that only started a moment before (walking past something)', () => {
    expect(listen(scene(8, { hum: CHEST, humFrom: 2.5, humUntil: 3, burstAt: 3 }))).toEqual([]);
  });

  it('ignores a burst with no hum before it (a shot, a door)', () => {
    expect(listen(scene(8, { burstAt: 3 }))).toEqual([]);
  });

  it('ignores a hum that stops with no burst (walking away from a chest)', () => {
    expect(listen(scene(8, { hum: CHEST, humUntil: 3 }))).toEqual([]);
  });

  it('ignores a burst while the hum goes on (something loud next to a closed chest)', () => {
    expect(listen(scene(8, { hum: CHEST, burstAt: 3 }))).toEqual([]);
  });

  it('hears a faint chest only when set to more sensitive', () => {
    // a quiet hum under loud background noise, so it barely stands out
    const random = noise(7);
    const faint = new Float32Array(8 * RATE).map((_, i) => {
      const t = i / RATE;
      let value = 0.1 * random();
      if (t < 3) for (const hz of GOLD) value += 0.006 * Math.sin(2 * Math.PI * hz * t);
      if (t >= 3 && t < 3.25) value += 0.6 * random();
      return value;
    });
    const hear = (sensitivity: number): number => {
      const detector = new ChestDetector(RATE, sensitivity);
      let count = 0;
      for (let i = 0; i < faint.length; i += 4096) count += detector.push(faint.subarray(i, i + 4096)).length;
      return count;
    };
    expect(hear(0)).toBe(0);
    expect(hear(1)).toBe(1);
  });

  it('gives the same answer whatever the chunk size', () => {
    const sound = scene(8, { hum: CHEST, humUntil: 3, burstAt: 3 });
    const detector = new ChestDetector(RATE);
    const found: ChestSound[] = [];
    for (let i = 0; i < sound.length; i += 777) found.push(...detector.push(sound.subarray(i, i + 777)));
    expect(found).toEqual(listen(sound));
  });
});

// ---- Harder scenes: shots, music, several chests, loudness ----

/** One chest in a scene: it hums from `humFrom` and opens (burst, hum stops) at `opensAt`. */
interface Chest {
  readonly notes?: readonly number[];
  readonly humFrom?: number;
  readonly opensAt?: number; // never opens when left out
  readonly loudness?: number;
}

/** A richer test sound: the game's background, chests, shots (short loud cracks) and music (other notes, beats). */
function mix(seconds: number, parts: { chests?: readonly Chest[]; shots?: readonly number[]; music?: boolean; volume?: number }): Float32Array {
  const random = noise(11);
  const samples = new Float32Array(seconds * RATE);
  const MUSIC = [440, 554, 659, 880, 1109];
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    let value = 0.01 * random();
    for (const hz of RARE) value += 0.02 * Math.sin(2 * Math.PI * hz * t);
    for (const chest of parts.chests ?? []) {
      const loud = chest.loudness ?? 1;
      const until = chest.opensAt ?? seconds;
      if (t >= (chest.humFrom ?? 0) && t < until) for (const hz of chest.notes ?? GOLD) value += 0.02 * loud * Math.sin(2 * Math.PI * hz * t);
      if (chest.opensAt !== undefined && t >= chest.opensAt && t < chest.opensAt + 0.25) value += 0.05 * loud * random();
    }
    for (const shot of parts.shots ?? []) if (t >= shot && t < shot + 0.06) value += 0.4 * random();
    if (parts.music) {
      for (const hz of MUSIC) value += 0.03 * Math.sin(2 * Math.PI * hz * t);
      if (t % 0.5 < 0.05) value += 0.08 * random(); // a beat every half second
    }
    samples[i] = value * (parts.volume ?? 1);
  }
  return samples;
}

describe('ChestDetector in harder scenes', () => {
  it('counts a chest opened during gunfire, and only once', () => {
    const found = listen(mix(8, { chests: [{ opensAt: 3 }], shots: [1.2, 1.9, 2.6, 3.5, 4.1, 4.8] }));
    expect(found).toHaveLength(1); // a shot right after the opening can move the moment it is heard a little
    expect(Math.abs(found[0]!.at - 3)).toBeLessThan(1);
  });

  it('ignores gunfire next to a chest that stays closed', () => {
    expect(listen(mix(8, { chests: [{}], shots: [1.2, 1.9, 2.6, 3.5, 4.1, 4.8] }))).toEqual([]);
  });

  it('counts a chest under loud music', () => {
    expect(listen(mix(8, { chests: [{ opensAt: 3 }], music: true }))).toHaveLength(1);
  });

  it('ignores loud music with beats when no chest opens', () => {
    expect(listen(mix(10, { music: true }))).toEqual([]);
  });

  it('counts two chests opened one after the other', () => {
    // the next chest is heard a second and a half after the first one opened (walking over to it)
    expect(listen(mix(10, { chests: [{ opensAt: 3 }, { humFrom: 4.5, opensAt: 7 }] }))).toHaveLength(2);
  });

  // Known weakness: when the next chest already hums right after the first one opens, the first one's hum does not
  // seem to stop, and it is missed. The replay counts it after the match.
  it.fails('counts two chests opened right next to each other', () => {
    expect(listen(mix(10, { chests: [{ opensAt: 3 }, { humFrom: 3.5, opensAt: 6.5 }] }))).toHaveLength(2);
  });

  // Known weakness: the recordings had one rare chest only, so the judge learned that rare notes falling is more often
  // something else; a rare chest is often not heard. The replay counts it after the match.
  it.fails('counts a gold and a rare chest opened at the same moment (as one sound)', () => {
    expect(listen(mix(8, { chests: [{ opensAt: 3 }, { notes: RARE, opensAt: 3 }] }))).toHaveLength(1);
  });

  it('gives the same answer however loud the game is', () => {
    const at = (volume: number): number[] => listen(mix(8, { chests: [{ opensAt: 3 }], volume })).map((sound) => Math.round(sound.at * 10));
    expect(at(0.1)).toEqual(at(1));
    expect(at(2)).toEqual(at(1));
  });
});

// ---- Real Fortnite recordings ----

describe('the learned judge on real recordings', () => {
  // 226 chest-like sounds from 17 recorded clips, checked against the video or the match replay (see the file)
  const { sounds } = fixture as { sounds: { chest: boolean; features: number[] }[] };
  const result = (sensitivity: number): { found: number; chests: number; falseAlarms: number; lookAlikes: number } => {
    const yes = sounds.filter((sound) => chestLikelihood(sound.features) >= judgeCut(sensitivity));
    return {
      found: yes.filter((sound) => sound.chest).length,
      chests: sounds.filter((sound) => sound.chest).length,
      falseAlarms: yes.filter((sound) => !sound.chest).length,
      lookAlikes: sounds.filter((sound) => !sound.chest).length,
    };
  };

  // the look-alikes are the hard ones: sounds that already got past the first, loose step
  it('finds most chests and turns down most look-alikes at the normal setting', () => {
    const { found, chests, falseAlarms, lookAlikes } = result(0.5);
    // 0.8: the 4 clips labelled from replays are harder than the first 13 (the judge did not learn from them)
    expect(found / chests).toBeGreaterThan(0.8);
    expect(falseAlarms / lookAlikes).toBeLessThan(0.35);
  });

  it('finds more chests when more sensitive, and makes fewer false alarms when stricter', () => {
    expect(result(1).found).toBeGreaterThan(result(0.5).found);
    expect(result(0).falseAlarms).toBeLessThan(result(0.5).falseAlarms);
  });
});
