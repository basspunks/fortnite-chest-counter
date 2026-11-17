import { describe, expect, it } from 'vitest';

import { defaultPlace, grow, keepSide, savedPlace } from '../src/placement';

const fullHd = { x: 0, y: 0, width: 1920, height: 1080 };

describe('placement', () => {
  it('starts in the middle at the top, under the compass', () => {
    expect(defaultPlace(fullHd, 340)).toEqual({ x: 790, y: 63 });
    expect(defaultPlace({ x: 0, y: 0, width: 2560, height: 1440 }, 340)).toEqual({ x: 1110, y: 84 });
  });

  it('uses the right screen when it is not the first one', () => {
    expect(defaultPlace({ x: 1920, y: 0, width: 1920, height: 1080 }, 340)).toEqual({ x: 2710, y: 63 });
  });

  it('keeps a centred bar centred, and one on a side on its edge, when its width changes', () => {
    expect(keepSide({ x: 790, y: 63, width: 340, height: 82 }, 380, fullHd)).toBe(770);
    expect(keepSide({ x: 1578, y: 178, width: 330, height: 82 }, 300, fullHd)).toBe(1608); // under the minimap: right edge
    expect(keepSide({ x: 20, y: 300, width: 330, height: 82 }, 400, fullHd)).toBe(20); // on the left: left edge
    expect(keepSide({ x: 1900, y: 300, width: 20, height: 82 }, 400, fullHd)).toBe(1520); // kept on the screen
  });

  it('keeps a saved position only while it is fully on a screen', () => {
    expect(savedPlace({ x: 100, y: 200 }, [fullHd], 330, 52)).toEqual({ x: 100, y: 200 });
    expect(savedPlace({ x: 1800, y: 200 }, [fullHd], 330, 52)).toBeUndefined(); // sticks out on the right
    expect(savedPlace({ x: 2000, y: 200 }, [fullHd], 330, 52)).toBeUndefined(); // that monitor is gone
    expect(savedPlace(undefined, [fullHd], 330, 52)).toBeUndefined();
    expect(savedPlace({ x: 'left' }, [fullHd], 330, 52)).toBeUndefined();
  });

  it("opens settings on the bar's side and keeps them on the screen", () => {
    const bar = { x: 1578, y: 178, width: 330, height: 52 };
    expect(grow(bar, 270, 650, fullHd)).toEqual({ x: 1638, y: 178 });
    expect(grow({ ...bar, y: 900 }, 270, 650, fullHd)).toEqual({ x: 1638, y: 430 });
    expect(grow({ ...bar, x: 0, width: 200 }, 270, 650, fullHd)).toEqual({ x: 0, y: 178 });
    expect(grow({ x: 790, y: 63, width: 340, height: 82 }, 310, 580, fullHd)).toEqual({ x: 805, y: 63 }); // under it, centred
  });
});
