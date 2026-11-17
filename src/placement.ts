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
 * In the middle at the top, right under Fortnite's compass (it reaches about 55 px down at 1080p, the distances to the
 * map markers included). Given as parts of the screen size, so it fits any resolution: 63 px from the top at 1080p.
 */
export function defaultPlace(screen: Box, width: number): Point {
  return {
    x: Math.round(screen.x + (screen.width - width) / 2),
    y: Math.round(screen.y + screen.height * 0.058),
  };
}

/**
 * Where a window of a new width goes so it stays where the player put it: a centred one keeps its centre, one on the
 * right half its right edge (under the minimap), one on the left half its left edge. Kept inside the screen.
 */
export function keepSide(from: Box, width: number, screen: Box): number {
  const centre = from.x + from.width / 2;
  const middle = screen.x + screen.width / 2;
  const x =
    Math.abs(centre - middle) <= screen.width * 0.05 ? centre - width / 2 : centre > middle ? from.x + from.width - width : from.x;
  return Math.round(Math.min(Math.max(screen.x, x), screen.x + screen.width - width));
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
 * Where the settings go when the bar opens them: from the bar's top, on the bar's side (see keepSide), and down;
 * pushed back inside the screen if they would stick out.
 */
export function grow(from: Box, width: number, height: number, screen: Box): Point {
  const y = Math.min(Math.max(screen.y, from.y), screen.y + screen.height - height);
  return { x: keepSide(from, width, screen), y };
}
