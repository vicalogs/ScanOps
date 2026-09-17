import type { Point } from './types.js';

/** Extend ZXing's confirmed scan strip only where the same bar pattern is visible.
 * Runs inside the decoding worker. Keeps upstream geometry if contrast is weak.
 * This estimates the bar area, excluding printed text and surrounding quiet zones.
 */
export function barcodeBounds(frame: { data: Uint8ClampedArray; width: number; height: number }, corners: Point[]): Point[] {
  const left = { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 };
  const right = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };
  const dx = right.x - left.x, dy = right.y - left.y, length = Math.hypot(dx, dy);
  if (length < 10) return corners;
  const nx = -dy / length, ny = dx / length, count = Math.min(192, Math.floor(length));
  const sample = (t: number, distance: number): number => {
    const x = Math.round(left.x + dx * t + nx * distance), y = Math.round(left.y + dy * t + ny * distance);
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return -1;
    const i = (y * frame.width + x) * 4;
    return (frame.data[i] + frame.data[i + 1] + frame.data[i + 2]) / 3;
  };
  const reference = Array.from({ length: count }, (_, i) => sample((i + .5) / count, 0));
  const low = Math.min(...reference), high = Math.max(...reference), threshold = (low + high) / 2;
  if (low < 0 || high - low < 40) return corners;
  const black = reference.filter(v => v < threshold).length;
  if (black < count * .15 || black > count * .85) return corners;
  const limit = Math.min(512, Math.max(frame.width, frame.height));
  const extend = (direction: number) => {
    let last = 0, misses = 0;
    for (let distance = 1; distance <= limit; distance++) {
      let matchingBlack = 0, matchingWhite = 0;
      for (let i = 0; i < count; i++) {
        const value = sample((i + .5) / count, distance * direction);
        if (value < 0) continue;
        if (reference[i] < threshold) matchingBlack += value < threshold ? 1 : 0;
        else matchingWhite += value >= threshold ? 1 : 0;
      }
      if (matchingBlack / black >= .82 && matchingWhite / (count - black) >= .82) { last = distance; misses = 0; }
      else if (++misses >= 2) break;
    }
    return last * direction;
  };
  const a = extend(-1), b = extend(1);
  const existingHeight = Math.max(Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y), Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y));
  if (b - a <= existingHeight) return corners;
  const shift = (p: Point, distance: number) => ({ x: Math.max(0, Math.min(frame.width - 1, p.x + nx * distance)), y: Math.max(0, Math.min(frame.height - 1, p.y + ny * distance)) });
  return [shift(left, a), shift(right, a), shift(right, b), shift(left, b)];
}
