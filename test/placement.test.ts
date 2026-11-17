import { describe, expect, it } from 'vitest';

import { defaultPlace, grow, savedPlace } from '../src/placement';

const fullHd = { x: 0, y: 0, width: 1920, height: 1080 };

describe('placement', () => {
  it('starts right under the minimap, on the right edge', () => {
    expect(defaultPlace(fullHd, 330)).toEqual({ x: 1578, y: 178 });
    expect(defaultPlace({ x: 0, y: 0, width: 2560, height: 1440 }, 330)).toEqual({ x: 2214, y: 238 });
  });

  it('uses the right screen when it is not the first one', () => {
    expect(defaultPlace({ x: 1920, y: 0, width: 1920, height: 1080 }, 330)).toEqual({ x: 3498, y: 178 });
  });

  it('keeps a saved position only while it is fully on a screen', () => {
    expect(savedPlace({ x: 100, y: 200 }, [fullHd], 330, 52)).toEqual({ x: 100, y: 200 });
    expect(savedPlace({ x: 1800, y: 200 }, [fullHd], 330, 52)).toBeUndefined(); // sticks out on the right
    expect(savedPlace({ x: 2000, y: 200 }, [fullHd], 330, 52)).toBeUndefined(); // that monitor is gone
    expect(savedPlace(undefined, [fullHd], 330, 52)).toBeUndefined();
    expect(savedPlace({ x: 'left' }, [fullHd], 330, 52)).toBeUndefined();
  });

  it('grows settings from the top-right corner and keeps them on the screen', () => {
    const bar = { x: 1578, y: 178, width: 330, height: 52 };
    expect(grow(bar, 270, 650, fullHd)).toEqual({ x: 1638, y: 178 });
    expect(grow({ ...bar, y: 900 }, 270, 650, fullHd)).toEqual({ x: 1638, y: 430 });
    expect(grow({ ...bar, x: 0, width: 200 }, 270, 650, fullHd)).toEqual({ x: 0, y: 178 });
  });
});
