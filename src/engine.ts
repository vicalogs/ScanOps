import { WorkerRpc } from './rpc.js';
import { trackingRegion } from './region.js';
import { DEFAULT_FORMATS, validateFormats } from './formats.js';
import { denoisePixels } from './denoise.js';
import { RUNTIME_FILES } from './runtime-files.mjs';
import type { BarcodeFormat } from './formats.js';
import type { Candidate, Point, QrCode, Region, ScanMode, ScanResult } from './types.js';

export class QrEngine {
  private decoder: WorkerRpc;
  private model?: WorkerRpc;
  private candidateWorker?: WorkerRpc;
  private candidateFrame = document.createElement('canvas');
  private lastCandidateAt = -Infinity;
  private candidateFailed = false;
  private modelTile = 0;
  private crop = document.createElement('canvas');
  private small = document.createElement('canvas');
  private ready?: Promise<void>;
  private busy = false;
  private disposed = false;
  private base: URL;
  /** Where the (potentially large, license-gated) decoder/model binaries are fetched from. Same as `base` unless `licensedAssetsUrl` is set. */
  private remoteBase: URL;
  private qrOnly: boolean;
  private formats: BarcodeFormat[];
  private useModel: boolean;
  private lastRecoveryAt = -Infinity;
  private decodeAttempts = 0;
  private previous?: { code: QrCode; width: number; height: number; at: number };
  constructor(assetBaseUrl = '/scanops/', mode: ScanMode = 'baseline', private maxDecodeSize = 960, formats: readonly BarcodeFormat[] = DEFAULT_FORMATS, private denoise: boolean | (() => boolean) = false, private maxRetryDecodeSize = 1920, private retryIntervalMs = 300, private retryBudgetMs = 120, private maxCodes = 1, licensedAssetsUrl?: string, private licenseToken?: string, private smallCodeRecovery: boolean | (() => boolean) = false) {
    this.formats = validateFormats(formats);
    this.qrOnly = this.maxCodes === 1 && this.formats.length === 1 && this.formats[0] === 'QRCode';
    // The locator model is only ever a per-customer licensed build served from
    // licensedAssetsUrl; without that URL assisted mode scans the full frame.
    this.useModel = this.maxCodes === 1 && mode === 'assisted' && this.formats.includes('QRCode') && Boolean(licensedAssetsUrl);
    // Worker *scripts* must stay same-origin; browsers refuse to construct a
    // Worker from a cross-origin URL. Only the (optionally license-gated)
    // binary assets a worker fetches internally may live elsewhere.
    this.base = new URL(assetBaseUrl.endsWith('/') ? assetBaseUrl : assetBaseUrl + '/', document.baseURI);
    if (this.base.origin !== location.origin) throw new Error('SDK worker scripts must be hosted on the same origin as this page');
    this.remoteBase = licensedAssetsUrl ? new URL(licensedAssetsUrl.endsWith('/') ? licensedAssetsUrl : licensedAssetsUrl + '/', document.baseURI) : this.base;
    if (licensedAssetsUrl && !this.licenseToken) throw new Error('licensedAssetsUrl requires a valid license token');
    const decoder = new Worker(new URL(this.qrOnly ? RUNTIME_FILES.qrWorker : RUNTIME_FILES.barcodeWorker, this.base), { type: 'module' });
    if (this.qrOnly) decoder.postMessage({ type: 'inversionMode', data: 'both' });
    this.decoder = new WorkerRpc(decoder);
    this.small.width = 192; this.small.height = 192;
  }
  prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Scanner engine is closed'));
    return this.ready ??= this.initialize();
  }
  private async initialize() {
    try {
      if (!this.qrOnly) await this.decoder.request({ type: 'init', assetBaseUrl: this.remoteBase.href, token: this.licenseToken, formats: this.formats, maxCodes: this.maxCodes }, [], 90000);
      // Check the decoder worker before requesting camera access.
      const blank = document.createElement('canvas'); blank.width = blank.height = 32;
      await this.decode(blank);
      if (this.disposed) throw new Error('Scanner engine is closed');
      if (this.useModel) {
        this.model = new WorkerRpc(new Worker(new URL(RUNTIME_FILES.locatorWorker, this.base), { type: 'module' }));
        // The engine WASM is the same for every customer and stays self-hosted beside the
        // worker; only the customer's model (and its metadata) is license-gated.
        await this.model.request({ type: 'init', assetBaseUrl: this.base.href, modelBaseUrl: this.remoteBase.href, token: this.licenseToken }, [], 90000);
      }
    } catch (error) { this.dispose(); throw error; }
  }
  /** Push a renewed license token so the model engine re-opens its key before the old one expires. */
  async refreshLicense(token: string | undefined): Promise<void> {
    if (!this.model || this.disposed || !token || token === this.licenseToken) return;
    this.licenseToken = token;
    await this.model.request({ type: 'refresh', token }, [], 90000);
  }
  private async decode(frame: HTMLCanvasElement, region?: Region, clean = false, maximum = this.maxDecodeSize): Promise<QrCode | null> {
    return (await this.decodeCodes(frame, region, clean, maximum))[0] ?? null;
  }
  private async decodeCodes(frame: HTMLCanvasElement, region?: Region, clean = false, maximum = this.maxDecodeSize): Promise<QrCode[]> {
    this.decodeAttempts++;
    const r = region ?? { x: 0, y: 0, width: frame.width, height: frame.height };
    const scale = Math.min(1, maximum / Math.max(r.width, r.height));
    this.crop.width = Math.max(1, Math.round(r.width * scale)); this.crop.height = Math.max(1, Math.round(r.height * scale));
    const ctx = this.crop.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    ctx.drawImage(frame, r.x, r.y, r.width, r.height, 0, 0, this.crop.width, this.crop.height);
    const raw = ctx.getImageData(0, 0, this.crop.width, this.crop.height);
    const pixels = clean ? denoisePixels(raw) : raw;
    const result = await this.decoder.request<{ data: string | null; cornerPoints: Point[]; codes?: QrCode[] }>({ type: 'decode', data: { data: pixels.data, width: pixels.width, height: pixels.height } }, [pixels.data.buffer]);
    const codes = this.qrOnly ? result.data === null ? [] : [{ ...result, format: 'QRCode' as const }] : result.codes;
    if (!Array.isArray(codes) || codes.length > this.maxCodes) throw new Error('Invalid decoder results; update SDK assets together');
    return codes.map(code => {
      if (typeof code.data !== 'string' || !this.formats.includes(code.format) || !Array.isArray(code.cornerPoints) || code.cornerPoints.length !== 4 || code.cornerPoints.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid decoder result');
      return { data: code.data, format: code.format, cornerPoints: code.cornerPoints.map(p => ({ x: r.x + p.x * r.width / this.crop.width, y: r.y + p.y * r.height / this.crop.height })) };
    });
  }
  private async locate(frame: HTMLCanvasElement, region?: Region): Promise<Candidate[]> {
    const ctx = this.small.getContext('2d', { willReadFrequently: true });
    if (!ctx || !this.model) throw new Error('Model is not ready');
    const r = region ?? { x: 0, y: 0, width: frame.width, height: frame.height };
    ctx.drawImage(frame, r.x, r.y, r.width, r.height, 0, 0, 192, 192);
    // Raw RGBA: a licensed model's input transform happens inside the engine WASM.
    const input = ctx.getImageData(0, 0, 192, 192).data;
    const response = await this.model.request<{ result: Candidate[] }>({ type: 'locate', input, width: r.width, height: r.height }, [input.buffer]);
    return response.result.map(c => ({ ...c, source: 'model', kind: 'qr', decodeAttempted: false, scanRegion: { ...c.scanRegion, x: c.scanRegion.x + r.x, y: c.scanRegion.y + r.y } }));
  }
  private async locateStructure(frame: HTMLCanvasElement): Promise<Candidate[]> {
    this.candidateWorker ??= new WorkerRpc(new Worker(new URL(RUNTIME_FILES.candidateWorker, this.base), { type: 'module' }));
    const scale = Math.min(1, 960 / Math.max(frame.width, frame.height));
    const sample = this.candidateFrame;
    sample.width = Math.max(1, Math.round(frame.width * scale)); sample.height = Math.max(1, Math.round(frame.height * scale));
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    ctx.drawImage(frame, 0, 0, sample.width, sample.height);
    const pixels = ctx.getImageData(0, 0, sample.width, sample.height);
    const response = await this.candidateWorker.request<{ result: Candidate[] }>({ type: 'locate', frame: { data: pixels.data, width: pixels.width, height: pixels.height }, qr: this.formats.includes('QRCode'), linear: this.formats.some(f => f !== 'QRCode') }, [pixels.data.buffer], 2000);
    return response.result.map(c => ({ ...c, decodeAttempted: false, scanRegion: { x: c.scanRegion.x * frame.width / sample.width, y: c.scanRegion.y * frame.height / sample.height, width: c.scanRegion.width * frame.width / sample.width, height: c.scanRegion.height * frame.height / sample.height } }));
  }
  async scan(frame: HTMLCanvasElement, track = false): Promise<ScanResult> {
    if (this.busy) throw new Error('Scanner is busy; await the previous scan');
    this.busy = true;
    try {
      await this.prepare();
      const start = performance.now();
      this.decodeAttempts = 0;
      if (this.maxCodes > 1) return await this.scanMultiple(frame, track, start);
      const recovery = { highResolution: false, denoise: false, recovered: false, attempts: 0 };
      const previous = this.previous;
      if (track && previous && previous.width === frame.width && previous.height === frame.height && start - previous.at < 450) {
        const code = await this.decode(frame, trackingRegion(previous.code, frame.width, frame.height));
        if (code) {
          this.previous = { code, width: frame.width, height: frame.height, at: performance.now() };
          return { code, codes: [code], candidates: [], fallback: false, path: 'tracked-region', durationMs: performance.now() - start, width: frame.width, height: frame.height, timestamp: start, recovery: { ...recovery, attempts: this.decodeAttempts } };
        }
      }
      this.previous = undefined;
      const candidates = this.useModel ? await this.locate(frame) : [];
      let candidateSampled = this.useModel;
      let code: QrCode | null = null;
      for (const candidate of candidates.slice(0, 3)) { code = await this.decode(frame, candidate.scanRegion); candidate.decodeAttempted = true; if (code) break; }
      const fallback = this.useModel && !code;
      let path: ScanResult['path'] = code ? 'model-region' : 'full-frame';
      if (!code) code = await this.decode(frame);
      const allowRecovery = () => !this.disposed && performance.now() - start < this.retryBudgetMs;
      const recoveryDue = !track || start - this.lastRecoveryAt >= this.retryIntervalMs;
      const smallCodeRecovery = typeof this.smallCodeRecovery === 'function' ? this.smallCodeRecovery() : this.smallCodeRecovery;
      if (!code && smallCodeRecovery && !this.candidateFailed && (!track || start - this.lastCandidateAt >= Math.max(300, this.retryIntervalMs)) && allowRecovery()) {
        this.lastCandidateAt = start;
        try {
          const structural = await this.locateStructure(frame);
          candidateSampled = true;
          candidates.push(...structural);
        } catch (error) {
          if (this.disposed) throw error;
          this.candidateFailed = true; this.candidateWorker?.dispose(); this.candidateWorker = undefined;
        }
        // Preserve the model's native 192px input; rotate one overlapping tile per
        // recovery sample rather than rescaling its architecture or running 5x/frame.
        if (!candidates.length && this.useModel && allowRecovery()) {
          const positions = [[.2, .2], [0, 0], [.4, 0], [0, .4], [.4, .4]];
          const [x, y] = positions[this.modelTile++ % positions.length];
          candidates.push(...await this.locate(frame, { x: x * frame.width, y: y * frame.height, width: frame.width * .6, height: frame.height * .6 }));
        }
        for (const candidate of [...candidates].sort((a, b) => b.score - a.score).slice(0, 3)) {
          if (!allowRecovery()) break;
          code = await this.decode(frame, candidate.scanRegion, false, this.maxRetryDecodeSize);
          candidate.decodeAttempted = true;
          if (code) { path = 'candidate-region'; recovery.recovered = true; break; }
        }
      }
      if (!code && recoveryDue && allowRecovery()) {
        if (this.maxRetryDecodeSize > this.maxDecodeSize && Math.max(frame.width, frame.height) > this.maxDecodeSize) {
          recovery.highResolution = true; this.lastRecoveryAt = performance.now();
          code = await this.decode(frame, undefined, false, this.maxRetryDecodeSize);
        }
        if (!code && allowRecovery() && (typeof this.denoise === 'function' ? this.denoise() : this.denoise)) {
          recovery.denoise = true; this.lastRecoveryAt = performance.now();
          code = await this.decode(frame, undefined, true);
        }
        recovery.recovered = Boolean(code);
      }
      if (track && code) this.previous = { code, width: frame.width, height: frame.height, at: performance.now() };
      return { code, codes: code ? [code] : [], candidates, candidateSampled, candidateError: this.candidateFailed, fallback, path, durationMs: performance.now() - start, width: frame.width, height: frame.height, timestamp: start, recovery: { ...recovery, attempts: this.decodeAttempts } };
    } finally { this.busy = false; }
  }
  private async scanMultiple(frame: HTMLCanvasElement, live: boolean, start: number): Promise<ScanResult> {
    // Never short-circuit on one tracked/model region: new codes may enter elsewhere.
    let codes = await this.decodeCodes(frame);
    const initialCount = codes.length;
    const recovery = { highResolution: false, denoise: false, recovered: false, attempts: 0 };
    const canRetry = () => codes.length < this.maxCodes && !this.disposed && performance.now() - start < this.retryBudgetMs;
    if ((!live || start - this.lastRecoveryAt >= this.retryIntervalMs) && canRetry()) {
      if (this.maxRetryDecodeSize > this.maxDecodeSize && Math.max(frame.width, frame.height) > this.maxDecodeSize) {
        recovery.highResolution = true; this.lastRecoveryAt = performance.now();
        codes = mergeCodes(codes, await this.decodeCodes(frame, undefined, false, this.maxRetryDecodeSize), this.maxCodes);
      }
      if (canRetry() && (typeof this.denoise === 'function' ? this.denoise() : this.denoise)) {
        recovery.denoise = true; this.lastRecoveryAt = performance.now();
        codes = mergeCodes(codes, await this.decodeCodes(frame, undefined, true), this.maxCodes);
      }
    }
    codes.sort((a, b) => a.cornerPoints[0].y - b.cornerPoints[0].y || a.cornerPoints[0].x - b.cornerPoints[0].x);
    recovery.recovered = codes.length > initialCount; recovery.attempts = this.decodeAttempts;
    return { code: codes[0] ?? null, codes, candidates: [], fallback: false, path: 'full-frame', durationMs: performance.now() - start, width: frame.width, height: frame.height, timestamp: start, recovery };
  }
  resetTracking() { this.previous = undefined; }
  dispose() { if (this.disposed) return; this.disposed = true; this.decoder.dispose(); this.model?.dispose(); this.candidateWorker?.dispose(); }
}

function mergeCodes(current: QrCode[], extra: QrCode[], limit: number) {
  const bounds = (code: QrCode) => {
    const xs = code.cornerPoints.map(p => p.x), ys = code.cornerPoints.map(p => p.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  const merged = [...current];
  for (const code of extra) {
    const b = bounds(code);
    const duplicate = merged.some(old => {
      if (old.format !== code.format || old.data !== code.data) return false;
      const a = bounds(old);
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return overlap > .4 * Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top));
    });
    if (!duplicate && merged.length < limit) merged.push(code);
  }
  return merged;
}
