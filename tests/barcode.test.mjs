import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_FORMATS } from '../dist/scanops.js';
import { installBrowser, qrImage, fixture, Video, until, scanOps } from './browser-mocks.mjs';
import { barcodeImage, examples } from './barcode-fixtures.mjs';
function setup(t, options) {
  const browser = installBrowser(), scanner = scanOps(options);
  t.after(() => { scanner.destroy(); browser.restore(); });
  return { ...browser, scanner };
}
for (const example of examples) test(`shipped barcode worker decodes ${example[0]} with four original-frame corners`, async t => {
  const { scanner, state } = setup(t);
  const result = await scanner.scanImage(barcodeImage(example));
  assert.ok(result.code, 'Expected decoded barcode');
  assert.equal(result.code.format, example[0]);
  const expected = example[2];
  assert.equal(result.code.data, expected);
  assert.equal(result.code.cornerPoints.length, 4);
  const xs = result.code.cornerPoints.map(p => p.x), ys = result.code.cornerPoints.map(p => p.y);
  assert.ok(Math.abs(Math.min(...xs) - 70) <= 3);
  assert.ok(Math.min(...ys) >= 79 && Math.max(...ys) <= 181);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 50, 'Box should cover barcode height');
  assert.equal(state.cameraCalls, 0); assert.ok(state.workers.every(w => w.terminated));
});
test('default format selection recognizes QR and barcodes; restricted formats reject other codes', async t => {
  const { scanner } = setup(t);
  assert.equal((await scanner.scanImage(qrImage())).code.data, fixture.payload);
  assert.equal((await scanner.scanImage(qrImage())).code.format, 'QRCode');
  assert.equal((await scanner.scanImage(barcodeImage())).code.format, 'Code128');
  assert.equal((await scanner.scanImage(barcodeImage(examples[0], { blank: true }))).code, null);
  const restricted = scanOps({ formats: ['EAN13'] });
  assert.equal((await restricted.scanImage(barcodeImage())).code, null);
  assert.throws(() => scanOps({ formats: [] }), /formats/);
  assert.throws(() => scanOps({ formats: ['unknown'] }), /formats/);
  const eanEquivalent = await restricted.scanImage(barcodeImage(examples[5]));
  assert.equal(eanEquivalent.code.format, 'EAN13');
  assert.equal(eanEquivalent.code.data, '0036000291452');
  restricted.destroy();
  assert.equal(SUPPORTED_FORMATS.length, 10);
});
test('rotated barcode is located after decode downscaling and barcode-only assisted mode skips QR model', async t => {
  const { scanner, state } = setup(t, { formats: ['Code128'], maxDecodeSize: 720, mode: 'assisted' });
  const result = await scanner.scanImage(barcodeImage(examples[0], { x: 300, y: 100, rotate: true }));
  assert.equal(result.code.data, examples[0][2]);
  assert.ok(Math.abs(Math.min(...result.code.cornerPoints.map(p => p.y)) - 100) < 4);
  assert.equal(state.workers.length, 1); assert.equal(result.path, 'full-frame');
});
test('moving barcode retains identity, maps ROI coordinates, loses target and reacquires', async t => {
  const { scanner } = setup(t, { formats: ['Code128'], lostAfterMs: 80 });
  const video = new Video(); video.videoWidth = 960; video.videoHeight = 640; video.pixels = barcodeImage().pixels;
  const frames = [], tracks = []; scanner.on('result', r => frames.push(r)); scanner.on('track', r => tracks.push(r));
  await scanner.start(video); await until(() => frames.length >= 2, 2000);
  const id = tracks.find(Boolean).id;
  assert.equal(frames[1].path, 'tracked-region');
  video.pixels = barcodeImage(examples[0], { x: 88, y: 90 }).pixels;
  await until(() => frames.at(-1)?.code && Math.min(...frames.at(-1).code.cornerPoints.map(p => p.x)) >= 86, 2000);
  assert.equal(frames.at(-1).path, 'tracked-region'); assert.equal(tracks.at(-1).id, id);
  video.pixels = barcodeImage(examples[0], { x: 500, y: 400 }).pixels;
  await until(() => frames.at(-1)?.code && Math.min(...frames.at(-1).code.cornerPoints.map(p => p.x)) >= 498, 2000);
  assert.equal(frames.at(-1).path, 'full-frame');
  video.pixels = barcodeImage(examples[0], { blank: true }).pixels;
  await until(() => tracks.at(-1) === null, 2000);
  video.pixels = barcodeImage().pixels;
  await until(() => tracks.at(-1) !== null, 2000);
  assert.notEqual(tracks.at(-1).id, id);
});
