import { acquireCamera, abortError } from './media.js';
import type { CameraInfo } from './types.js';

type CameraCapabilities = MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean; zoom?: { min: number; max: number; step?: number } };
type CameraSettings = MediaTrackSettings & { focusMode?: string; torch?: boolean; zoom?: number };

function capabilities(track: MediaStreamTrack): CameraCapabilities {
  try { return track.getCapabilities?.() as CameraCapabilities ?? {}; } catch { return {}; }
}

export function cameraInfo(track: MediaStreamTrack): CameraInfo {
  const supported = capabilities(track), settings = track.getSettings() as CameraSettings;
  const range = supported.zoom;
  const validZoom = range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max > range.min;
  return {
    width: settings.width, height: settings.height, frameRate: settings.frameRate,
    continuousFocus: settings.focusMode === 'continuous',
    torch: { supported: supported.torch === true && typeof track.applyConstraints === 'function', enabled: settings.torch === true },
    zoom: validZoom && typeof track.applyConstraints === 'function' ? {
      min: range.min, max: range.max, step: range.step && Number.isFinite(range.step) && range.step > 0 ? range.step : .1,
      value: Math.max(range.min, Math.min(range.max, Number.isFinite(settings.zoom) ? settings.zoom! : range.min)),
    } : null,
  };
}

export async function acquireAdaptiveCamera(camera: string, maximum: number, adaptive: boolean, signal: AbortSignal) {
  const preference = camera === 'user' || camera === 'environment' ? { facingMode: { ideal: camera } } : { deviceId: { exact: camera } };
  const width = adaptive ? Math.min(1920, maximum) : 1280;
  const constraints = (size: number): MediaStreamConstraints => ({ audio: false, video: {
    ...preference, width: { ideal: size }, height: { ideal: Math.round(size * 9 / 16) }, frameRate: { ideal: 30, max: 30 },
  } });
  try { return await acquireCamera(constraints(width), signal); }
  catch (error) {
    const constraint = (error as { constraint?: string })?.constraint;
    if (!adaptive || width <= 1280 || !(error instanceof Error) || error.name !== 'OverconstrainedError' || constraint === 'deviceId' || constraint === 'facingMode') throw error;
    if (signal.aborted) throw abortError();
    return acquireCamera(constraints(1280), signal);
  }
}

/** Optional focus tuning must never prevent a working camera from starting. */
export async function configureFocus(track: MediaStreamTrack, signal: AbortSignal) {
  if (!capabilities(track).focusMode?.includes('continuous') || !track.applyConstraints) return;
  await applyCameraConstraints(track, { advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }, signal).catch(error => {
    if (signal.aborted) throw error;
  });
}

export function applyCameraConstraints(track: MediaStreamTrack, constraints: MediaTrackConstraints, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Camera settings timed out')); }, 2000);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw abortError();
      return track.applyConstraints(constraints);
    }).then(() => { cleanup(); if (signal.aborted) reject(abortError()); else resolve(); }, error => { cleanup(); reject(error); });
  });
}
