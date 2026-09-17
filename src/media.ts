import type { ScanSource } from './types.js';
export function abortError() { return new DOMException('Scanner stopped', 'AbortError'); }
export function acquireCamera(constraints: MediaStreamConstraints, signal: AbortSignal): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      resolve(stream);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
export function waitVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const type of ['loadeddata', 'canplay']) video.removeEventListener(type, check);
      video.removeEventListener('error', fail); signal.removeEventListener('abort', abort);
    };
    const check = () => { if (video.readyState >= 2 && video.videoWidth > 0) { cleanup(); resolve(); } };
    const fail = () => { cleanup(); reject(new Error('Video could not be loaded')); };
    const abort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for camera frames')); }, 15000);
    for (const type of ['loadeddata', 'canplay']) video.addEventListener(type, check);
    video.addEventListener('error', fail); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else check();
  });
}
export function captureFrame(source: ScanSource, maximum: number, canvas = document.createElement('canvas')): HTMLCanvasElement {
  const width = 'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!width || !height) throw new Error('Image or video is not ready');
  const scale = Math.min(1, maximum / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale)), targetHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
