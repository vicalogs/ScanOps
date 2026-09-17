import { QrEngine } from './engine.js';
import { captureFrame, waitVideo, abortError } from './media.js';
import { acquireAdaptiveCamera, applyCameraConstraints, cameraInfo, configureFocus } from './camera.js';
import { AutoZoomController } from './auto-zoom.js';
import { ConfirmationGate, MultiConfirmationGate } from './confirmation.js';
import { Tracker } from './tracker.js';
import { DEFAULT_FORMATS, validateFormats } from './formats.js';
import { cropScanFrame, restoreScanCoordinates } from './scan-region.js';
import { verifyLicense } from './license.js';
import { DEFAULT_LICENSED_ASSETS_URL } from './service.js';
import type { LicenseAuthorization } from './license.js';
import type { Camera, CameraInfo, ScanDiagnostics, ScanResult, ScanSource, ScannerEvents, ScannerOptions, ScannerState } from './types.js';

/** Re-authorize this far ahead of expiry so a slow network doesn't lapse mid-check. */
const LICENSE_REFRESH_SKEW_MS = 30000;

export class ScanOps {
  private options: Required<ScannerOptions>;
  private license?: LicenseAuthorization;
  private licenseInFlight?: Promise<void>;
  private engine?: QrEngine;
  private job?: AbortController;
  private stream?: MediaStream;
  private video?: HTMLVideoElement;
  private timer?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setInterval>;
  private tracker: Tracker;
  private confirmation: ConfirmationGate;
  private multiConfirmation: MultiConfirmationGate;
  private capture?: HTMLCanvasElement;
  private regionFrame?: HTMLCanvasElement;
  private readyAt = 0;
  private processingTimes: number[] = [];
  private averageProcessingMs = 0;
  private lastMediaTime = -Infinity;
  private lastFreshFrameAt = 0;
  private metrics: ScanDiagnostics = emptyDiagnostics();
  private zoomController = new AutoZoomController();
  private zoomStatus = '';
  private controls: Promise<void> = Promise.resolve();
  private controlsTimedOut = false;
  private controlEpoch = 0;
  private autoZoomBusy = false;
  private listeners = new Map<keyof ScannerEvents, Set<(value: never) => void>>();
  private currentState: ScannerState = 'idle';
  private onVisibility = () => { if (document.hidden && this.options.stopOnHidden) this.stop(); };
  constructor(options: ScannerOptions) {
    if (typeof document === 'undefined') throw new Error('Construct ScanOps in the browser, after mounting');
    if (!options?.license?.key) throw new TypeError('ScanOps requires options.license: { key }');
    this.options = { assetBaseUrl: '/scanops/', licensedAssetsUrl: DEFAULT_LICENSED_ASSETS_URL, mode: 'baseline', formats: DEFAULT_FORMATS, maxCodes: 1, scanRegion: null, denoise: false, maxScansPerSecond: 30, maxFrameSize: 1920, maxDecodeSize: 960, maxRetryDecodeSize: 1920, retryIntervalMs: 300, retryBudgetMs: 120, adaptiveCamera: true, autoZoom: false, confirmationFrames: 2, confirmationWindowMs: 650, repeatDelayMs: 1500, lostAfterMs: 450, stopOnHidden: true, ...options };
    if (typeof this.options.autoZoom !== 'boolean') throw new TypeError('autoZoom must be a boolean');
    this.options.formats = validateFormats(this.options.formats);
    if (!Number.isInteger(this.options.maxCodes) || this.options.maxCodes < 1 || this.options.maxCodes > 10) throw new RangeError('maxCodes must be an integer between 1 and 10');
    for (const [name, low, high] of [['maxScansPerSecond', 1, 60], ['maxFrameSize', 192, 4096], ['maxDecodeSize', 192, 4096], ['lostAfterMs', 50, 10000]] as const) {
      const value = this.options[name];
      if (!Number.isFinite(value) || value < low || value > high) throw new RangeError(`${name} must be between ${low} and ${high}`);
    }
    for (const [name, low, high] of [['maxRetryDecodeSize', 192, 4096], ['retryIntervalMs', 0, 10000], ['retryBudgetMs', 0, 1000], ['confirmationFrames', 1, 10], ['confirmationWindowMs', 50, 10000], ['repeatDelayMs', 0, 60000]] as const) {
      const value = this.options[name];
      if (!Number.isFinite(value) || value < low || value > high) throw new RangeError(`${name} must be between ${low} and ${high}`);
    }
    if (!Number.isInteger(this.options.confirmationFrames)) throw new RangeError('confirmationFrames must be an integer');
    if (!['baseline', 'assisted'].includes(this.options.mode)) throw new TypeError('Unsupported scan mode');
    this.tracker = new Tracker(this.options.lostAfterMs);
    this.confirmation = new ConfirmationGate(this.options.confirmationFrames, this.options.confirmationWindowMs, this.options.repeatDelayMs);
    this.multiConfirmation = new MultiConfirmationGate(this.options.confirmationFrames, this.options.confirmationWindowMs, this.options.repeatDelayMs);
    document.addEventListener('visibilitychange', this.onVisibility);
  }
  get state(): ScannerState { return this.currentState; }
  get cameraId(): string | undefined { return this.stream?.getVideoTracks()[0]?.getSettings().deviceId; }
  get track() { return this.tracker.current; }
  get cameraInfo(): CameraInfo | null { const track = this.stream?.getVideoTracks()[0]; return track ? cameraInfo(track) : null; }
  get autoZoomInfo() { return { ...this.zoomController.info }; }
  setAutoZoom(enabled: boolean) {
    this.assertAlive();
    if (typeof enabled !== 'boolean') throw new TypeError('autoZoom must be a boolean');
    this.options.autoZoom = enabled; this.controlEpoch++;
    this.zoomController.reset(enabled, this.cameraInfo?.zoom ?? null, this.options.maxCodes > 1, performance.now());
    this.emitAutoZoom();
  }
  private emitAutoZoom() {
    const key = JSON.stringify(this.zoomController.info);
    if (key !== this.zoomStatus) { this.zoomStatus = key; this.emit('autoZoom', this.autoZoomInfo); }
  }
  get diagnostics(): ScanDiagnostics {
    const times = [...this.processingTimes].sort((a, b) => a - b);
    return { ...this.metrics, processingP95Ms: times.length ? times[Math.ceil(times.length * .95) - 1] : null };
  }
  async setTorch(enabled: boolean): Promise<void> {
    if (!this.cameraInfo?.torch.supported) throw new Error('This camera does not support torch control');
    await this.setCameraControls({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
  }
  async setZoom(value: number): Promise<void> {
    const range = this.cameraInfo?.zoom;
    if (!range || !Number.isFinite(value) || value < range.min || value > range.max) throw new RangeError('Zoom must be inside the supported camera range');
    this.controlEpoch++; this.zoomController.manual(); this.emitAutoZoom();
    await this.setCameraControls({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }, value);
  }
  private async setCameraControls(constraints: MediaTrackConstraints, expectedZoom?: number, isCurrent = () => true) {
    this.assertAlive();
    const job = this.job, track = this.stream?.getVideoTracks()[0];
    if (!job || !track || this.currentState !== 'running') throw new Error('Start the camera before changing its controls');
    const operation = this.controls.then(async () => {
      this.check(job);
      if (!isCurrent()) throw abortError();
      if (this.controlsTimedOut) throw new Error('Camera settings timed out; restart the camera before changing controls');
      try { await applyCameraConstraints(track, constraints, job.signal); }
      catch (error) {
        // A timed-out native request may still be in flight. Do not stack another
        // constraint request on this track; a new camera session resets the gate.
        if (this.job === job && error instanceof Error && /timed out/.test(error.message)) this.controlsTimedOut = true;
        throw error;
      }
      this.check(job);
      const info = cameraInfo(track);
      this.emit('camera', info);
      this.check(job);
      if (expectedZoom !== undefined && (!info.zoom || Math.abs(info.zoom.value - expectedZoom) > Math.max(.001, info.zoom.step * .51))) throw new Error('Camera did not apply the requested zoom');
      if (expectedZoom !== undefined) { this.engine?.resetTracking(); this.confirmation.reset(); }
    });
    this.controls = operation.catch(() => {});
    return operation;
  }
  private updateAutoZoom(result: ScanResult, job: AbortController) {
    const range = this.cameraInfo?.zoom;
    if (!range || this.autoZoomBusy) return;
    const value = this.zoomController.update(result, range, performance.now());
    this.emitAutoZoom();
    if (value === null || this.job !== job || job.signal.aborted) return;
    const epoch = this.controlEpoch;
    const current = () => this.job === job && !job.signal.aborted && epoch === this.controlEpoch;
    this.autoZoomBusy = true;
    void this.setCameraControls({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }, value, current).then(() => {
      if (current()) this.zoomController.applied(range.value, this.cameraInfo!.zoom!.value, performance.now());
    }).catch(error => {
      if (current() && (error as Error).name !== 'AbortError') { this.zoomController.failed(); this.emitAutoZoom(); }
    }).finally(() => { if (this.job === job) this.autoZoomBusy = false; });
  }
  on<K extends keyof ScannerEvents>(event: K, listener: (value: ScannerEvents[K]) => void): () => void {
    this.assertAlive();
    let group = this.listeners.get(event);
    if (!group) this.listeners.set(event, group = new Set());
    group.add(listener as (value: never) => void);
    return () => { group.delete(listener as (value: never) => void); };
  }
  private emit<K extends keyof ScannerEvents>(event: K, value: ScannerEvents[K]) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot listeners so subscription mutations cannot extend this dispatch.
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try { listener(value as never); }
      catch (error) { console.error('ScanOps event listener failed:', error); }
    }
  }
  private setState(state: ScannerState) { if (this.currentState !== state) { this.currentState = state; this.emit('state', state); } }
  private assertAlive() { if (this.currentState === 'destroyed') throw new Error('ScanOps has been destroyed'); }
  private createEngine() { return new QrEngine(this.options.assetBaseUrl, this.options.mode, this.options.maxDecodeSize, this.options.formats, this.options.denoise, this.options.maxRetryDecodeSize, this.options.retryIntervalMs, this.options.retryBudgetMs, this.options.maxCodes, this.licensedAssetsUrl(), this.license?.token, () => this.options.autoZoom); }
  /** Assets live under a per-customer prefix; the id comes from the license service, not from configuration. */
  private licensedAssetsUrl(): string | undefined {
    const base = this.options.licensedAssetsUrl;
    if (!base || !this.license) return undefined;
    return `${base.endsWith('/') ? base : base + '/'}${this.license.customerId}/`;
  }
  /** Throws if this origin is not authorized for the configured license key. Never skipped by callers. */
  private async ensureLicense(signal: AbortSignal): Promise<void> {
    if (this.license && this.license.expiresAt - LICENSE_REFRESH_SKEW_MS > Date.now()) return;
    this.licenseInFlight ??= verifyLicense(this.options.license, signal)
      .then(authorization => { this.license = authorization; })
      .finally(() => { this.licenseInFlight = undefined; });
    await this.licenseInFlight;
  }
  private async scanFrame(source: ScanSource, engine: QrEngine, track = false): Promise<ScanResult> {
    const full = captureFrame(source, this.options.maxFrameSize, this.capture ??= document.createElement('canvas'));
    const region = typeof this.options.scanRegion === 'function' ? this.options.scanRegion() : this.options.scanRegion;
    const { frame, offset } = cropScanFrame(full, region, this.regionFrame ??= document.createElement('canvas'));
    const result = await engine.scan(frame, track);
    return restoreScanCoordinates(result, offset, full.width, full.height);
  }
  private check(job: AbortController) { if (job.signal.aborted || this.job !== job) throw abortError(); }
  async listCameras(): Promise<Camera[]> {
    this.assertAlive();
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Camera enumeration is unavailable');
    return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput').map(device => ({ id: device.deviceId, label: device.label }));
  }
  async start(video: HTMLVideoElement, camera = 'environment'): Promise<void> {
    this.assertAlive();
    this.stop();
    this.assertAlive();
    const job = new AbortController(); this.job = job;
    const startingAt = performance.now();
    this.metrics = emptyDiagnostics(); this.processingTimes = [];
    this.setState('starting');
    try {
      this.check(job);
      if (this.options.stopOnHidden && document.hidden) throw new Error('Cannot start camera while the page is hidden');
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser');
      this.emit('startup', 'preparing'); this.check(job);
      await this.ensureLicense(job.signal); this.check(job);
      const engine = this.createEngine(); this.engine = engine;
      await engine.prepare(); this.check(job);
      this.emit('startup', 'requesting-camera'); this.check(job);
      const stream = await acquireAdaptiveCamera(camera, this.options.maxFrameSize, this.options.adaptiveCamera, job.signal);
      // A cancellation can occur after getUserMedia resolved but before this continuation.
      if (job.signal.aborted || this.job !== job) { stream.getTracks().forEach(track => track.stop()); throw abortError(); }
      this.stream = stream; this.video = video;
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (this.job === job) { this.stop(); this.emit('error', new Error('Camera disconnected')); }
      }, { once: true, signal: job.signal });
      this.emit('startup', 'opening-camera'); this.check(job);
      if (this.options.adaptiveCamera) await configureFocus(stream.getVideoTracks()[0], job.signal);
      this.check(job);
      this.emit('camera', cameraInfo(stream.getVideoTracks()[0])); this.check(job);
      const ready = waitVideo(video, job.signal);
      // A pending play() does not prevent stop() from cancelling the readiness wait.
      void video.play().catch(error => { if (this.job === job) { this.stop(); this.emit('error', asError(error)); } });
      await ready; this.check(job);
      this.readyAt = performance.now(); this.lastFreshFrameAt = this.readyAt;
      this.metrics.startupMs = this.readyAt - startingAt;
      this.setState('running'); this.check(job);
      this.zoomController.reset(this.options.autoZoom, this.cameraInfo?.zoom ?? null, this.options.maxCodes > 1, this.readyAt);
      this.emitAutoZoom(); this.check(job);
      this.expiry = setInterval(() => { if (this.tracker.expire(performance.now())) this.emit('track', null); }, Math.min(100, this.options.lostAfterMs));
      void this.loop(job, engine, video);
    } catch (error) {
      if (this.job === job) { this.stop(); this.emit('error', asError(error)); }
      throw error;
    }
  }
  async switchCamera(camera: string): Promise<void> {
    this.assertAlive();
    if (!this.video) throw new Error('Start the camera before switching');
    return this.start(this.video, camera);
  }
  private async loop(job: AbortController, engine: QrEngine, video: HTMLVideoElement) {
    const start = performance.now();
    try {
      this.check(job);
      // Renew before the token expires so the model engine keeps a live key; a lapsed
      // license makes ensureLicense throw here, which stops the loop.
      if (this.license && this.license.expiresAt - LICENSE_REFRESH_SKEW_MS <= Date.now()) {
        await this.ensureLicense(job.signal); this.check(job);
        await engine.refreshLicense(this.license.token); this.check(job);
      }
      if (Number.isFinite(video.currentTime) && video.currentTime === this.lastMediaTime) {
        if (performance.now() - this.lastFreshFrameAt > 5000) throw new Error('Camera frames stalled');
        this.timer = setTimeout(() => { void this.loop(job, engine, video); }, 1000 / this.options.maxScansPerSecond);
        return;
      }
      this.lastMediaTime = video.currentTime; this.lastFreshFrameAt = performance.now();
      const result = await this.scanFrame(video, engine, true);
      this.check(job);
      const now = performance.now();
      let emitted;
      if (this.options.maxCodes > 1) {
        const confirmation = this.multiConfirmation.update(result.codes, now);
        result.confirmedCodes = confirmation.confirmed;
        emitted = confirmation.emitted;
        result.confirmed = result.code !== null && result.confirmedCodes.includes(result.code);
      } else {
        const confirmation = this.confirmation.update(result.code, now);
        result.confirmed = confirmation.confirmed;
        result.confirmedCodes = confirmation.confirmed && result.code ? [result.code] : [];
        emitted = confirmation.emit && result.code ? [result.code] : [];
      }
      const elapsed = now - start;
      this.processingTimes.push(elapsed); if (this.processingTimes.length > 120) this.processingTimes.shift();
      this.averageProcessingMs = this.averageProcessingMs ? this.averageProcessingMs * .8 + elapsed * .2 : elapsed;
      this.metrics.frames++;
      if (result.code) { this.metrics.decodedFrames++; this.metrics.firstDecodeMs ??= now - this.readyAt; }
      if (result.confirmedCodes.length) this.metrics.firstConfirmedMs ??= now - this.readyAt;
      this.metrics.confirmedResults += emitted.length;
      if (result.recovery?.highResolution) this.metrics.highResolutionAttempts++;
      if (result.recovery?.recovered) this.metrics.recoverySuccesses++;
      this.emit('result', result); this.check(job);
      for (const code of emitted) { this.emit('confirmed', { ...result, code, confirmed: true }); this.check(job); }
      this.updateAutoZoom(result, job); this.check(job);
      if (result.code) this.emit('track', this.tracker.update(result.code, now));
      else if (this.tracker.expire(now)) this.emit('track', null);
      this.check(job);
      const period = Math.max(1000 / this.options.maxScansPerSecond, this.averageProcessingMs * 1.35);
      this.timer = setTimeout(() => { void this.loop(job, engine, video); }, Math.max(0, period - (performance.now() - start)));
    } catch (error) {
      if (this.job === job) { this.stop(); this.emit('error', asError(error)); }
    }
  }
  /** Call only while idle. Concurrent image scans are rejected rather than queued. */
  async scanImage(source: ScanSource): Promise<ScanResult> {
    this.assertAlive();
    if (this.job) throw new Error('Scanner is busy; stop the camera or await the previous image scan');
    const job = new AbortController(); this.job = job;
    let engine: QrEngine | undefined;
    try {
      await this.ensureLicense(job.signal); this.check(job);
      engine = this.createEngine(); this.engine = engine;
      const result = await this.scanFrame(source, engine);
      this.check(job); this.emit('result', result); return result;
    } catch (error) { if (this.job === job) this.emit('error', asError(error)); throw error; }
    finally { engine?.dispose(); if (this.job === job) { this.engine = undefined; this.job = undefined; } }
  }
  stop(): void {
    this.job?.abort(); this.job = undefined;
    this.controlEpoch++; this.autoZoomBusy = false; this.controls = Promise.resolve(); this.controlsTimedOut = false;
    this.zoomController.reset(false, null, false, performance.now()); this.zoomStatus = '';
    clearTimeout(this.timer); clearInterval(this.expiry); this.timer = undefined; this.expiry = undefined;
    this.engine?.dispose(); this.engine = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.video && this.stream && this.video.srcObject === this.stream) { this.video.pause(); this.video.srcObject = null; }
    this.stream = undefined; this.video = undefined;
    this.confirmation.reset(); this.multiConfirmation.reset(); this.capture = undefined; this.regionFrame = undefined;
    this.averageProcessingMs = 0; this.lastMediaTime = -Infinity;
    const hadTrack = this.tracker.reset(), changed = this.currentState !== 'idle' && this.currentState !== 'destroyed';
    if (this.currentState !== 'destroyed') this.currentState = 'idle';
    if (hadTrack) this.emit('track', null);
    if (changed && !this.job && this.currentState === 'idle') this.emit('state', 'idle');
  }
  destroy(): void {
    if (this.currentState === 'destroyed') return;
    this.currentState = 'destroyed';
    this.stop(); document.removeEventListener('visibilitychange', this.onVisibility);
    this.emit('state', 'destroyed'); this.listeners.clear();
  }
}
function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
function emptyDiagnostics(): ScanDiagnostics {
  return { startupMs: null, firstDecodeMs: null, firstConfirmedMs: null, frames: 0, decodedFrames: 0, confirmedResults: 0, highResolutionAttempts: 0, recoverySuccesses: 0, processingP95Ms: null };
}
