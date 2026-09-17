export { ScanOps } from './scanner.js';
/** @deprecated Use ScanOps. Kept for integrations created before the rename. */
export { ScanOps as SmartScanner } from './scanner.js';
export { QrOverlay } from './overlay.js';
export { MultiCodeOverlay } from './multi-overlay.js';
export { SUPPORTED_FORMATS, DEFAULT_FORMATS } from './formats.js';
export type { BarcodeFormat } from './formats.js';
export { LicenseError } from './license.js';
export type { LicenseConfig } from './license.js';
export type { DetectedCode } from './types.js';
export type { CameraInfo, ScanDiagnostics, AutoZoomInfo, AutoZoomStatus } from './types.js';
export type { OverlayOptions } from './overlay.js';
export type { Point, Region, Candidate, QrCode, ScanSource, ScanMode, ScannerState, ScanResult, TrackResult, Camera, ScannerOptions, ScannerEvents } from './types.js';
export const SDK_VERSION = '0.1.0-beta.3';
