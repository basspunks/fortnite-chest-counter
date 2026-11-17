import { describe, expect, it } from 'vitest';

import { FortniteWatch } from '../src/fortnite-watch';

describe('FortniteWatch', () => {
  it('shows the counter while the game runs and for a while after it closes', () => {
    const watch = new FortniteWatch(() => undefined, 90_000);
    expect(watch.decide(false, 0)).toBeUndefined(); // the game has not run yet: the window is left as it is
    expect(watch.decide(true, 1_000)).toBe(true);
    expect(watch.decide(false, 10_000)).toBe(true); // just closed: the last replay is being read
    expect(watch.decide(false, 99_000)).toBe(true);
    expect(watch.decide(false, 100_001)).toBe(false);
    expect(watch.decide(true, 200_000)).toBe(true); // started again
  });
});
