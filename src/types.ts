import type { BarcodeFormat } from './formats.js';
import type { LicenseConfig } from './license.js';
export type Point = { x: number; y: number };
export type Region = { x: number; y: number; width: number; height: number };
/** A possible code, never a decoded result. Scores are heuristic/model scores, not probabilities. */
export type Candidate = { score: number; scanRegion: Region; kind?: 'qr' | 'linear'; source?: 'structure' | 'model'; sharpness?: number; decodeAttempted?: boolean };
export type DetectedCode = { data: string; format: BarcodeFormat; cornerPoints: Point[] };
/** Compatibility alias; prefer DetectedCode for QR and linear barcode results. */
export type QrCode = DetectedCode;
export type ScanSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap;
export type ScanMode = 'baseline' | 'assisted';
export type ScannerState = 'idle' | 'starting' | 'running' | 'destroyed';
export type ScanResult = {
  /** First decoded code, retained for single-code integrations. */
  code: QrCode | null;
  /** All codes in this frame, bounded by maxCodes. */
  codes: DetectedCode[];
  candidates: Candidate[];
  /** True only when candidates were measured on this frame, including an empty measurement. */
  candidateSampled?: boolean;
  /** Optional structural locator failed; regular decoding continues. */
  candidateError?: boolean;
  fallback: boolean;
  /** The successful path, or full-frame if no code was decoded. */
  path: 'tracked-region' | 'model-region' | 'candidate-region' | 'full-frame';
  /** Full processing cost, including model inference and fallback decoding. */
  durationMs: number;
  /** All returned coordinates refer to these captured frame dimensions. */
  width: number;
  height: number;
  timestamp: number;
  /** Live video only: whether this code passed temporal confirmation. Raw code remains available. */
  confirmed?: boolean;
  /** Video only: codes whose content passed independent temporal confirmation. */
  confirmedCodes?: DetectedCode[];
  /** Additional recovery attempts, excluding initialization. */
  recovery?: { highResolution: boolean; denoise: boolean; recovered: boolean; attempts: number };
};
export type TrackResult = { id: number; code: QrCode; lastSeen: number };
export type Camera = { id: string; label: string };
export type CameraInfo = {
  width?: number; height?: number; frameRate?: number;
  continuousFocus: boolean;
  torch: { supported: boolean; enabled: boolean };
  zoom: { min: number; max: number; step: number; value: number } | null;
};
export type AutoZoomStatus = 'off' | 'unsupported' | 'multi-code' | 'searching' | 'stabilizing' | 'centering' | 'zooming' | 'holding' | 'limit' | 'recovering' | 'manual' | 'error';
export type AutoZoomInfo = { enabled: boolean; status: AutoZoomStatus };
export type ScanDiagnostics = {
  startupMs: number | null;
  /** Measured after the camera becomes ready, not from page load. */
  firstDecodeMs: number | null;
  firstConfirmedMs: number | null;
  frames: number; decodedFrames: number; confirmedResults: number;
  highResolutionAttempts: number; recoverySuccesses: number;
  /** Rolling P95 of the latest 120 capture + scan iterations; excludes camera initialization. */
  processingP95Ms: number | null;
};
export type ScannerOptions = {
  /** Required. Ties this instance to a domain-restricted license; see the license module. */
  license: LicenseConfig;
  /** Same-origin public directory populated by scanops-assets. Default: /scanops/. */
  assetBaseUrl?: string;
  /** Override where the licence-gated decoder/model binaries are fetched from. Defaults to the built-in licence service. */
  licensedAssetsUrl?: string;
  /** `assisted` uses the customer's licensed locator model, which only `licensedAssetsUrl` serves; without it, scanning stays full-frame. */
  mode?: ScanMode;
  /** Defaults to QRCode plus the supported common linear barcode formats. */
  formats?: readonly BarcodeFormat[];
  /** Maximum codes per frame (integer 1–10). Default 1. Multi-code scans the entire configured region. */
  maxCodes?: number;
  /** Normalized source coordinates (0–1). A callback may follow a responsive viewfinder; null scans the full source. */
  scanRegion?: Region | (() => Region | null) | null;
  /** Retry undecodable frames with a small median filter. A callback can toggle this without restarting the camera. */
  denoise?: boolean | (() => boolean);
  maxScansPerSecond?: number;
  maxFrameSize?: number;
  maxDecodeSize?: number;
  /** Failure-only retry size; never upscales. Set to maxDecodeSize to disable. Default 1920. */
  maxRetryDecodeSize?: number;
  /** Live recovery attempts are separated by at least this interval. Default 300 ms. */
  retryIntervalMs?: number;
  /** Do not start another recovery attempt after this frame budget. Cannot interrupt an in-flight decode. Default 120 ms. */
  retryBudgetMs?: number;
  /** Prefer up to 1080p and continuous focus when supported. Default true. */
  adaptiveCamera?: boolean;
  /** Single-code candidate recovery and conservative camera auto zoom. Default false; no model required. */
  autoZoom?: boolean;
  /** Consistent distinct video frames needed for confirmation. Default 2; raw results remain immediate. */
  confirmationFrames?: number;
  confirmationWindowMs?: number;
  /** Minimum delay for a repeated confirmed code after it leaves and re-enters. Default 1500 ms. */
  repeatDelayMs?: number;
  lostAfterMs?: number;
  stopOnHidden?: boolean;
};
export type ScannerEvents = {
  state: ScannerState;
  /** Startup milestones, emitted before camera permission and before the first video frame. */
  startup: 'preparing' | 'requesting-camera' | 'opening-camera';
  result: ScanResult;
  /** Once per confirmed presentation, with repeated results suppressed. Video only. */
  confirmed: ScanResult & { code: DetectedCode };
  camera: CameraInfo;
  /** Auto zoom status changes; optional control failures never stop decoding. */
  autoZoom: AutoZoomInfo;
  /** Decoded code refreshed on each successful sample; null when expired or stopped. */
  track: TrackResult | null;
  error: Error;
};
