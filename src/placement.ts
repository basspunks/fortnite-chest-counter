export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Right under Fortnite's minimap, lined up with the right edge of the screen.
 * Given as parts of the screen size, so it fits any resolution: on 1920 × 1080 it is 12 px from the right, 178 px from the top.
 */
export function defaultPlace(screen: Box, width: number): Point {
  return {
    x: Math.round(screen.x + screen.width - width - screen.width * 0.00625),
    y: Math.round(screen.y + screen.height * 0.165),
  };
}

/** A saved position, if the window would still be fully on one of the screens (a monitor may have been unplugged). */
export function savedPlace(saved: unknown, screens: readonly Box[], width: number, height: number): Point | undefined {
  const point = saved as Partial<Point> | undefined;
  if (typeof point?.x !== 'number' || typeof point.y !== 'number') {
    return undefined;
  }
  const { x, y } = point;
  const fits = screens.some((s) => x >= s.x && y >= s.y && x + width <= s.x + s.width && y + height <= s.y + s.height);
  return fits ? { x, y } : undefined;
}

/**
 * Where a window of the new size goes so its top-right corner stays put (the counter sits on the right edge,
 * so settings grow to the left and down), pushed back inside the screen if it would stick out.
 */
export function grow(from: Box, width: number, height: number, screen: Box): Point {
  const x = Math.min(Math.max(screen.x, from.x + from.width - width), screen.x + screen.width - width);
  const y = Math.min(Math.max(screen.y, from.y), screen.y + screen.height - height);
  return { x, y };
}
