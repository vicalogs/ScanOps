'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ScanOps } from './scanner.js';
import { MultiCodeOverlay } from './multi-overlay.js';
import type { DetectedCode, ScanResult, ScannerOptions, ScannerState } from './types.js';

export type ScanOpsHandle = {
  start(camera?: string): Promise<void>;
  stop(): void;
  switchCamera(camera: string): Promise<void>;
};
export type ScanOpsViewProps = {
  options: ScannerOptions;
  onResult?: (result: ScanResult) => void;
  onConfirmed?: (result: ScanResult & { code: DetectedCode }) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: ScannerState) => void;
  className?: string;
  style?: CSSProperties;
  controls?: boolean;
  labels?: { start?: string; stop?: string; starting?: string; video?: string };
};
/** Starts only from a user gesture; importing this entry is safe during SSR. */
export const ScanOpsView = forwardRef<ScanOpsHandle, ScanOpsViewProps>(function ScanOpsView(props, ref) {
  const video = useRef<HTMLVideoElement>(null), scanner = useRef<ScanOps | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; }, [props]);
  const [state, setState] = useState<ScannerState>('idle');
  const [error, setError] = useState('');
  const { license, assetBaseUrl, mode, maxCodes, maxScansPerSecond, maxFrameSize, maxDecodeSize, maxRetryDecodeSize, retryIntervalMs, retryBudgetMs, adaptiveCamera, autoZoom, confirmationFrames, confirmationWindowMs, repeatDelayMs, lostAfterMs, stopOnHidden, scanRegion, denoise } = props.options;
  const licenseKey = license.key, licenseEndpoint = license.endpoint;
  const formatsKey = JSON.stringify(props.options.formats);
  /* oxlint-disable react/react-compiler -- Replacing the external scanner resource resets its displayed state and initialization error. */
  useEffect(() => {
    const formats: unknown = formatsKey === undefined ? undefined : JSON.parse(formatsKey);
    const options = { license: { key: licenseKey, endpoint: licenseEndpoint }, ...Object.fromEntries(Object.entries({ assetBaseUrl, mode, formats, maxCodes, maxScansPerSecond, maxFrameSize, maxDecodeSize, maxRetryDecodeSize, retryIntervalMs, retryBudgetMs, adaptiveCamera, autoZoom, confirmationFrames, confirmationWindowMs, repeatDelayMs, lostAfterMs, stopOnHidden, scanRegion, denoise }).filter(([, value]) => value !== undefined)) };
    let instance: ScanOps;
    try { instance = new ScanOps(options); }
    catch (cause) { const e = cause instanceof Error ? cause : new Error(String(cause)); setError(e.message); callbacks.current.onError?.(e); return; }
    const overlay = new MultiCodeOverlay(svg.current!);
    scanner.current = instance; setState('idle'); setError('');
    const unsubscribe = [
      instance.on('state', value => { setState(value); callbacks.current.onStateChange?.(value); }),
      instance.on('result', value => { if (value.code || (maxCodes ?? 1) > 1) overlay.update(value); callbacks.current.onResult?.(value); }),
      instance.on('confirmed', value => callbacks.current.onConfirmed?.(value)),
      instance.on('track', value => { if (!value) overlay.clear(); }),
      instance.on('error', e => { setError(e.message); callbacks.current.onError?.(e); }),
    ];
    return () => { unsubscribe.forEach(off => off()); instance.destroy(); overlay.destroy(); if (scanner.current === instance) scanner.current = null; };
  }, [licenseKey, licenseEndpoint, assetBaseUrl, mode, maxCodes, formatsKey, maxScansPerSecond, maxFrameSize, maxDecodeSize, maxRetryDecodeSize, retryIntervalMs, retryBudgetMs, adaptiveCamera, autoZoom, confirmationFrames, confirmationWindowMs, repeatDelayMs, lostAfterMs, stopOnHidden, scanRegion, denoise]);
  /* oxlint-enable react/react-compiler */
  useImperativeHandle(ref, () => ({
    async start(camera) { if (!scanner.current || !video.current) throw new Error('Scanner is not mounted'); setError(''); await scanner.current.start(video.current, camera); },
    stop() { scanner.current?.stop(); },
    async switchCamera(camera) { if (!scanner.current) throw new Error('Scanner is not mounted'); await scanner.current.switchCamera(camera); },
  }), []);
  const starting = state === 'starting', running = state === 'running';
  return <div className={props.className} style={props.style}>
    <div style={{ position: 'relative', background: '#0b1020', lineHeight: 0 }}>
      <video ref={video} muted playsInline aria-label={props.labels?.video ?? 'Camera preview'} style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} />
      <svg ref={svg} preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
    </div>
    {props.controls !== false && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button type="button" disabled={starting || running} onClick={() => {
        if (!scanner.current || !video.current) return;
        setError(''); void scanner.current.start(video.current).catch(() => {});
      }}>{starting ? props.labels?.starting ?? 'Starting…' : props.labels?.start ?? 'Start camera'}</button>
      <button type="button" disabled={!starting && !running} onClick={() => scanner.current?.stop()}>{props.labels?.stop ?? 'Stop'}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
});

/** @deprecated Use ScanOpsView. */
export const SmartScannerView = ScanOpsView;
/** @deprecated Use ScanOpsHandle. */
export type SmartScannerHandle = ScanOpsHandle;
/** @deprecated Use ScanOpsViewProps. */
export type SmartScannerViewProps = ScanOpsViewProps;
