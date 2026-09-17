import type { Region, ScanResult } from './types.js';

export function cropScanFrame(source: HTMLCanvasElement, region: Region | null, target?: HTMLCanvasElement) {
  if (!region) return { frame: source, offset: { x: 0, y: 0 } };
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    throw new RangeError('scanRegion must be a non-empty region inside normalized source coordinates (0–1)');
  }
  const left = Math.min(source.width - 1, Math.floor(x * source.width));
  const top = Math.min(source.height - 1, Math.floor(y * source.height));
  const frame = target ?? document.createElement('canvas');
  const targetWidth = Math.max(1, Math.min(source.width, Math.ceil((x + width) * source.width)) - left);
  const targetHeight = Math.max(1, Math.min(source.height, Math.ceil((y + height) * source.height)) - top);
  if (frame.width !== targetWidth) frame.width = targetWidth;
  if (frame.height !== targetHeight) frame.height = targetHeight;
  const context = frame.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.drawImage(source, left, top, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return { frame, offset: { x: left, y: top } };
}

export function restoreScanCoordinates(result: ScanResult, offset: { x: number; y: number }, width: number, height: number): ScanResult {
  const codes = result.codes.map(code => ({ ...code, cornerPoints: code.cornerPoints.map(point => ({ x: point.x + offset.x, y: point.y + offset.y })) }));
  return {
    ...result, width, height,
    code: codes[0] ?? null, codes,
    candidates: result.candidates.map(candidate => ({ ...candidate, scanRegion: { ...candidate.scanRegion, x: candidate.scanRegion.x + offset.x, y: candidate.scanRegion.y + offset.y } })),
  };
}
