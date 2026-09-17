import { Worker as NodeWorker } from 'node:worker_threads';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ScanOps } from '../dist/scanops.js';
const decoderSource = readFileSync(new URL('../dist/assets/scanops-qr.worker.js', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./qr.json', import.meta.url), 'utf8'));
export { fixture };
export class Canvas {
  width = 0; height = 0;
  getContext() {
    return {
      drawImage: (source, ...args) => {
        const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
        const [sx, sy, cropWidth, cropHeight] = args.length === 8 ? args : [0, 0, sw, sh];
        this.pixels = new Uint8ClampedArray(this.width * this.height * 4).fill(255);
        if (!source.pixels) return;
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
          const p = (Math.min(sh - 1, Math.floor(sy + y * cropHeight / this.height)) * sw + Math.min(sw - 1, Math.floor(sx + x * cropWidth / this.width))) * 4;
          this.pixels.set(source.pixels.subarray(p, p + 4), (y * this.width + x) * 4);
        }
      },
      getImageData: () => ({ data: this.pixels ?? new Uint8ClampedArray(this.width * this.height * 4).fill(255), width: this.width, height: this.height }),
    };
  }
}
export function qrImage(blank = false) {
  const image = new Canvas(); image.width = 320; image.height = 240;
  image.pixels = new Uint8ClampedArray(image.width * image.height * 4).fill(255);
  if (!blank) for (let y = 0; y < fixture.size; y++) for (let x = 0; x < fixture.size; x++) if (fixture.data[y * fixture.size + x]) {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const p = ((40 + y * 4 + dy) * image.width + 40 + x * 4 + dx) * 4;
      image.pixels[p] = image.pixels[p + 1] = image.pixels[p + 2] = 0;
    }
  }
  return image;
}
export class Video extends EventTarget {
  videoWidth = 320; videoHeight = 240; readyState = 2; srcObject = null;
  muted = false; playsInline = false; pixels = qrImage().pixels;
  async play() {}
  pause() { this.paused = true; }
}
export function cameraStream() {
  const track = new EventTarget(); track.stopped = false;
  track.stop = () => { track.stopped = true; };
  track.getSettings = () => ({ deviceId: 'camera-1' });
  return { active: true, getTracks: () => [track], getVideoTracks: () => [track], track };
}
export const TEST_LICENSE = { key: 'test-key', endpoint: 'https://sdk.test/api/license/authorize' };
/** `new ScanOps` with a license that the mocked `fetch` below always authorizes. */
export function scanOps(options) { return new ScanOps({ license: TEST_LICENSE, ...options }); }

export function installBrowser() {
  const previous = Object.fromEntries(['document', 'location', 'navigator', 'Worker', 'isSecureContext', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const fetch = async url => {
    if (String(url) === TEST_LICENSE.endpoint) return { ok: true, json: async () => ({ token: 'test-token', customerId: 'test-customer', expiresAt: Date.now() + 600000 }) };
    throw new Error(`Unexpected fetch in tests: ${url}`);
  };
  const document = new EventTarget(); document.baseURI = 'https://sdk.test/app/'; document.hidden = false;
  document.createElement = type => { if (type !== 'canvas') throw new Error(type); return new Canvas(); };
  const state = { workers: [], cameraCalls: 0, stream: cameraStream(), candidates: [], holdDecode: false, decodeCount: 0 };
  class Worker {
    constructor(url) {
      this.url = String(url); this.terminated = false; state.workers.push(this);
      if (this.url.endsWith('scanops-barcode.worker.js')) {
        this.nodeWorker = new NodeWorker(new URL('./barcode-node-worker.mjs', import.meta.url));
        this.nodeWorker.on('message', data => { if (!this.terminated) this.onmessage?.({ data }); });
        this.nodeWorker.on('error', error => this.onerror?.(error));
      } else if (this.url.endsWith('scanops-qr.worker.js') || this.url.endsWith('scanops-candidate.worker.js')) {
        const self = { postMessage: data => queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data }); }), close() {} };
        const source = this.url.endsWith('scanops-candidate.worker.js') ? readFileSync(new URL('../dist/assets/scanops-candidate.worker.js', import.meta.url), 'utf8') : decoderSource;
        vm.runInNewContext(source, { self, Uint8ClampedArray, Uint8Array, Int32Array, Uint32Array, Float64Array });
        this.self = self;
      }
    }
    postMessage(data) {
      if (this.terminated) throw new Error('Worker terminated');
      if (this.nodeWorker) {
        if (data.type === 'decode') { state.decodeCount++; if (state.holdDecode) return; }
        this.nodeWorker.postMessage(data);
      } else if (this.self) {
        if (data.type === 'decode') { state.decodeCount++; if (state.holdDecode) return; }
        this.self.onmessage({ data });
      } else queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { id: data.id, result: data.type === 'init' ? true : state.candidates } }); });
    }
    terminate() { this.terminated = true; this.nodeWorker?.terminate(); }
  }
  const mediaDevices = {
    getUserMedia: async constraints => { state.cameraCalls++; state.constraints = constraints; return state.stream; },
    enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'camera-1', label: 'Camera' }],
  };
  for (const [key, value] of Object.entries({ document, location: new URL(document.baseURI), navigator: { mediaDevices }, Worker, isSecureContext: true, fetch })) Object.defineProperty(globalThis, key, { configurable: true, value });
  return { state, document, mediaDevices, restore() {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  } };
}
export async function until(predicate, attempts = 100) {
  for (let i = 0; i < attempts; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('Timed out waiting for test condition');
}
