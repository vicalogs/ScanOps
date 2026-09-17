import ScanOpsEngine, { type ScanOpsEngineModule } from 'scanops-engine';
import { RUNTIME_FILES } from './runtime-files.mjs';
import type { Candidate } from './types.js';

type Metadata = { version: string; licensed?: boolean; inputSize: number; confidenceThreshold: number; maskThreshold: number; minArea: number; sha256: string };

const SIZE = 192;
let engine: ScanOpsEngineModule | undefined;
let metadata: Metadata | undefined;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
/** The origin the token is bound to; the engine checks the sealed domain against it. */
const workerDomain = () => self.location?.hostname ?? '';

/** The sealed locator constants ride in the token body; only the engine can open them. */
function sealedLocator(token: string): string {
  const body = token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/');
  const { sealedLocator: sealed } = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')));
  if (typeof sealed !== 'string') throw new Error('License token carries no locator key; update the license service');
  return sealed;
}

/** Opens (or re-opens, on token refresh) the sealed key; throws a readable message on refusal. */
function openWith(token: string): void {
  const reason = engine!.openLicensedLocator(sealedLocator(token), Math.floor(Date.now() / 1000), workerDomain());
  if (reason === 'seal_unverified' || reason === 'seal_key_unknown') throw new Error('License token was not issued for this SDK build; update SDK assets or the license service');
  if (reason === 'seal_expired') throw new Error('License token has expired');
  if (reason === 'seal_domain') throw new Error('License token is not valid for this origin');
  if (reason) throw new Error(`Locator model was refused (${reason}); re-export it for this SDK release`);
}

/**
 * The engine runs the whole locator: it opens the sealed key, derives the transform,
 * mixes the pixels, runs the network and un-transforms its output. Nothing between the
 * RGBA frame and the candidate regions — key, constants, tensors — reaches JavaScript.
 */
async function initLocator(weights: ArrayBuffer, meta: Metadata, assetBaseUrl: string, token: string): Promise<void> {
  const response = await fetch(new URL(RUNTIME_FILES.engineWasm, assetBaseUrl));
  if (!response.ok) throw new Error(`Engine WASM request failed: ${response.status}`);
  const wasm = await response.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', wasm)) !== SCANOPS_ENGINE_WASM_SHA256) throw new Error('Engine WASM fingerprint mismatch; copy assets from this SDK version');
  engine = await ScanOpsEngine({ wasmBinary: new Uint8Array(wasm) });
  metadata = meta;
  engine.licensedLocatorWeights(weights.byteLength).set(new Uint8Array(weights));
  const loadError = engine.loadLocatorWeights();
  if (loadError) throw new Error(`Locator weights were refused (${loadError}); re-export the model for this SDK release`);
  openWith(token);
}

function locate(rgba: Uint8ClampedArray, width: number, height: number): Candidate[] {
  engine!.licensedLocatorFrame().set(rgba);
  const candidates = engine!.locateLicensed(width, height, metadata!.confidenceThreshold, metadata!.maskThreshold, metadata!.minArea);
  try { return Array.from({ length: candidates.size() }, (_, i) => candidates.get(i)); } finally { candidates.delete(); }
}

self.onmessage = async ({ data }: MessageEvent) => {
  const { id, type, input, width, height, assetBaseUrl, modelBaseUrl = assetBaseUrl, token } = data;
  try {
    if (type === 'init') {
      const authHeaders: HeadersInit | undefined = token ? { authorization: `Bearer ${token}` } : undefined;
      const response = await fetch(new URL(RUNTIME_FILES.modelMetadata, modelBaseUrl), authHeaders && { headers: authHeaders });
      if (!response.ok) throw new Error(`Model metadata request failed: ${response.status}`);
      const meta: Metadata = await response.json();
      if (meta.inputSize !== SIZE || !Number.isFinite(meta.confidenceThreshold)) throw new Error('Unsupported model metadata');
      // Plain models are no longer distributed; refusing them keeps a leaked copy from being a drop-in.
      if (!meta.licensed) throw new Error('Only licensed locator models are supported; serve the customer build from licensedAssetsUrl');
      if (!token) throw new Error('A licensed model requires a license token');
      const model = await fetch(new URL(RUNTIME_FILES.model, modelBaseUrl), authHeaders && { headers: authHeaders });
      if (!model.ok) throw new Error(`Model request failed: ${model.status}`);
      const bytes = await model.arrayBuffer();
      if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== meta.sha256) throw new Error('Model fingerprint mismatch; copy assets from the same SDK version');
      await initLocator(bytes, meta, assetBaseUrl, token);
      locate(new Uint8ClampedArray(SIZE * SIZE * 4), 1, 1);
      self.postMessage({ id, result: true });
    } else if (type === 'refresh') {
      // The license token was renewed; re-open the key so expiry is enforced without refetching.
      if (!engine) throw new Error('Model is not initialized');
      openWith(token);
      self.postMessage({ id, result: true });
    } else if (type === 'locate') {
      if (!engine) throw new Error('Model is not initialized');
      if (!(input instanceof Uint8ClampedArray) || input.length !== SIZE * SIZE * 4) throw new Error('Expected RGBA input at 192×192');
      self.postMessage({ id, result: locate(input, width, height) });
    } else throw new Error('Unknown model request');
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
