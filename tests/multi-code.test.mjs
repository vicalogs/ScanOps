import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import bwip from 'bwip-js';
import { MultiCodeOverlay } from '../dist/scanops.js';
import { Canvas, Video, installBrowser, until, scanOps } from './browser-mocks.mjs';
import { barcodeImage } from './barcode-fixtures.mjs';

function scene(items, image = new Canvas()) {
  image.width = 960; image.height = 640;
  image.pixels ??= new Uint8ClampedArray(image.width * image.height * 4).fill(255);
  for (const { text, x, y, scale = 5 } of items) {
    const qr = bwip.raw({ bcid: 'qrcode', text })[0];
    for (let row = 0; row < qr.pixy; row++) for (let col = 0; col < qr.pixx; col++) if (qr.pixs[row * qr.pixx + col]) {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const p = ((y + row * scale + dy) * image.width + x + col * scale + dx) * 4;
        image.pixels[p] = image.pixels[p + 1] = image.pixels[p + 2] = 0;
      }
    }
  }
  return image;
}
const items = [{ text: 'SCANOPS-A', x: 100, y: 100 }, { text: 'SCANOPS-B', x: 480, y: 110 }, { text: 'SCANOPS-C', x: 700, y: 380 }];
function setup(t, options = {}) {
  const browser = installBrowser();
  const scanner = scanOps({ formats: ['QRCode'], maxCodes: 10, retryBudgetMs: 0, ...options });
  t.after(() => { scanner.destroy(); browser.restore(); });
  return { ...browser, scanner };
}
const values = result => result.codes.map(code => code.data).sort();

test('multi-code uses the shipped WASM to decode three QR codes from one frame', async t => {
  const { scanner, state } = setup(t);
  const result = await scanner.scanImage(scene(items));
  assert.deepEqual(values(result), ['SCANOPS-A', 'SCANOPS-B', 'SCANOPS-C']);
  assert.equal(result.code, result.codes[0]);
  assert.ok(state.workers.every(worker => worker.url.endsWith('scanops-barcode.worker.js')));
  assert.equal(state.cameraCalls, 0);
  assert.ok(result.codes.every(code => code.cornerPoints.length === 4));
  assert.deepEqual((await scanner.scanImage(scene([]))).codes, []);
});
test('single-code remains lightweight, and the configured multi-code limit is respected', async t => {
  const { scanner, state } = setup(t, { maxCodes: 1 });
  assert.equal((await scanner.scanImage(scene([items[0]]))).codes.length, 1);
  assert.ok(state.workers[0].url.endsWith('scanops-qr.worker.js'));
  const limited = scanOps({ formats: ['QRCode'], maxCodes: 2, retryBudgetMs: 0 });
  try { assert.equal((await limited.scanImage(scene(items))).codes.length, 2); } finally { limited.destroy(); }
  const single = scanOps({ maxCodes: 1, retryBudgetMs: 0 });
  try { assert.equal((await single.scanImage(scene(items))).codes.length, 1); } finally { single.destroy(); }
});
test('multi-code preserves two printed QR codes with identical text', async t => {
  const { scanner } = setup(t);
  const result = await scanner.scanImage(scene([items[0], { ...items[1], text: items[0].text }]));
  assert.deepEqual(values(result), ['SCANOPS-A', 'SCANOPS-A']);
  assert.ok(Math.abs(result.codes[0].cornerPoints[0].x - result.codes[1].cornerPoints[0].x) > 300);
});
test('multi-code honors format filtering and supports mixed QR and linear barcodes', async t => {
  const { scanner } = setup(t);
  const image = scene([{ text: 'SCANOPS-QR', x: 620, y: 340 }], barcodeImage());
  assert.deepEqual(values(await scanner.scanImage(image)), ['SCANOPS-QR']);
  const mixed = scanOps({ formats: ['QRCode', 'Code128'], maxCodes: 10, retryBudgetMs: 0 });
  try {
    const result = await mixed.scanImage(image);
    assert.deepEqual(result.codes.map(code => code.format).sort(), ['Code128', 'QRCode']);
  } finally { mixed.destroy(); }
});
test('multi-code scans only the viewfinder and restores all corners to the full frame', async t => {
  const { scanner } = setup(t, { scanRegion: { x: .4, y: .1, width: .6, height: .8 }, maxDecodeSize: 384 });
  const result = await scanner.scanImage(scene(items));
  assert.deepEqual(values(result), ['SCANOPS-B', 'SCANOPS-C']);
  assert.equal(result.width, 960); assert.equal(result.height, 640);
  for (const code of result.codes) {
    const original = items.find(item => item.text === code.data);
    assert.ok(Math.abs(Math.min(...code.cornerPoints.map(p => p.x)) - original.x) < 5);
    assert.ok(Math.abs(Math.min(...code.cornerPoints.map(p => p.y)) - original.y) < 5);
  }
});
test('recovery merges repeated detections without merging separate identical labels', async t => {
  const { scanner } = setup(t, { maxDecodeSize: 384, maxRetryDecodeSize: 1920, retryBudgetMs: 1000, denoise: true });
  const result = await scanner.scanImage(scene([items[0], { ...items[1], text: items[0].text }]));
  assert.equal(result.codes.length, 2);
  assert.equal(result.recovery.highResolution, true);
  assert.equal(result.recovery.denoise, true);
});
test('live multi-code discovers later arrivals instead of locking onto the first code', async t => {
  const { scanner, state } = setup(t, { mode: 'assisted', maxScansPerSecond: 60 });
  const video = new Video(); video.videoWidth = 960; video.videoHeight = 640; video.currentTime = 1;
  video.pixels = scene([items[0]]).pixels;
  const frames = [], confirmed = [];
  scanner.on('result', result => frames.push(result));
  scanner.on('confirmed', result => confirmed.push(result.code.data));
  await scanner.start(video);
  await until(() => frames.length >= 1, 1000);
  assert.equal(frames[0].codes.length, 1);
  video.pixels = scene(items).pixels; video.currentTime = 2;
  await until(() => frames.length >= 2, 1000);
  assert.equal(frames[1].codes.length, 3);
  video.currentTime = 3;
  await until(() => frames.length >= 3, 1000);
  assert.equal(frames[2].confirmedCodes.length, 3);
  assert.deepEqual(confirmed.sort(), ['SCANOPS-A', 'SCANOPS-B', 'SCANOPS-C']);
  assert.ok(frames.every(frame => frame.path === 'full-frame'));
  assert.equal(state.workers.length, 1); // No single-target locator in multi-code mode.
  video.pixels = scene([]).pixels; video.currentTime = 4;
  await until(() => frames.length >= 4, 1000);
  assert.equal(frames[3].confirmedCodes.length, 0);
  scanner.stop(); assert.ok(state.stream.track.stopped);
});
test('multi-code configuration rejects invalid limits before loading or opening the camera', t => {
  const { state } = setup(t);
  for (const maxCodes of [0, -1, 11, 1.5, NaN, Infinity]) assert.throws(() => scanOps({ maxCodes }), /maxCodes/);
  assert.equal(state.workers.length, 0); assert.equal(state.cameraCalls, 0);
});
test('independent confirmation is order-independent and duplicate prints count once per frame', async () => {
  const source = await readFile(new URL('../src/confirmation.ts', import.meta.url), 'utf8');
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  const { MultiConfirmationGate } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const gate = new MultiConfirmationGate(2, 100, 500);
  const a = { format: 'QRCode', data: 'A', cornerPoints: [] }, b = { ...a, data: 'B' };
  assert.equal(gate.update([a, a, b], 0).confirmed.length, 0);
  assert.equal(gate.update([b, a, a], 30).confirmed.length, 3);
  assert.equal(gate.update([a, b], 60).emitted.length, 0);
  gate.update([a], 180);
  assert.deepEqual(gate.update([b, a], 200).confirmed, [a]);
  assert.equal(gate.update([b, a], 230).emitted.length, 0);
  gate.update([], 600);
  gate.update([b], 650);
  assert.deepEqual(gate.update([b], 680).emitted, [b]);
  gate.reset(); assert.equal(gate.update([a], 700).confirmed.length, 0);
});
test('multi-overlay matches repeated payloads by position and removes missing targets and stopped animations', t => {
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia'];
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const polygons = [], queue = new Map(); let next = 0;
  const svg = { attributes: { preserveAspectRatio: 'xMidYMid slice' }, appendChild(polygon) { polygons.push(polygon); }, setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name]; } };
  const createPolygon = () => ({ attributes: {}, style: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, remove() { this.removed = true; } });
  for (const [key, value] of Object.entries({ document: { createElementNS: createPolygon }, requestAnimationFrame: callback => { queue.set(++next, callback); return next; }, cancelAnimationFrame: id => queue.delete(id), matchMedia: () => ({ matches: false }) })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const overlay = new MultiCodeOverlay(svg);
  t.after(() => { overlay.destroy(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const code = x => ({ format: 'QRCode', data: 'same', cornerPoints: [{ x, y: 10 }, { x: x + 80, y: 10 }, { x: x + 80, y: 90 }, { x, y: 90 }] });
  overlay.update({ width: 640, height: 480, codes: [code(10), code(400)] });
  assert.equal(polygons.length, 2); assert.equal(svg.attributes.preserveAspectRatio, 'xMidYMid slice');
  overlay.update({ width: 640, height: 480, codes: [code(410), code(20)] });
  assert.equal(polygons.length, 2); assert.equal(queue.size, 2);
  overlay.update({ width: 640, height: 480, codes: [code(410)] });
  assert.equal(polygons[0].removed, true); assert.equal(polygons[1].removed, undefined);
  overlay.update({ width: 640, height: 480, codes: [] });
  assert.equal(polygons[1].removed, true); assert.equal(queue.size, 0);
  overlay.update({ width: 640, height: 480, codes: [code(20)] });
  overlay.destroy(); overlay.update({ width: 640, height: 480, codes: [code(400)] });
  assert.equal(polygons.length, 3); assert.ok(polygons.every(polygon => polygon.removed));
});
