import type { QrCode, Region } from './types.js';
/** Expanded last decoded box for fast local re-detection; this is not optical flow. */
export function trackingRegion(code: QrCode, width: number, height: number): Region {
  const xs = code.cornerPoints.map(p => p.x), ys = code.cornerPoints.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const margin = Math.max(32, Math.max(right - left, bottom - top) * .6);
  const x = Math.max(0, Math.floor(left - margin)), y = Math.max(0, Math.floor(top - margin));
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(right + margin)) - x), height: Math.max(1, Math.min(height, Math.ceil(bottom + margin)) - y) };
}
