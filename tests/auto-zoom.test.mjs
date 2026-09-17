import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoZoomController } from '../src/auto-zoom.ts';
import { locateCandidates } from '../src/candidate-locator.ts';
import { Canvas, Video, fixture, installBrowser, scanOps, until, cameraStream } from './browser-mocks.mjs';
import { barcodeImage, examples } from './barcode-fixtures.mjs';

const range = { min: 1, max: 8, step: .1, value: 1 };
const candidate = { score: .94, kind: 'qr', sharpness: 2, decodeAttempted: true, scanRegion: { x: 450, y: 450, width: 100, height: 100 } };
const frame = (candidates = [candidate], extra = {}) => ({ code: null, codes: [], candidates, candidateSampled: true, width: 1000, height: 1000, ...extra });
function controller() { const policy = new AutoZoomController(); policy.reset(true, range, false, 0); return policy; }
function trigger(policy, zoom = range, at = 0, target = frame()) {
  assert.equal(policy.update(target, zoom, at), null);
  assert.equal(policy.update(target, zoom, at + 300), null);
  return policy.update(target, zoom, at + 600);
}

test('only repeated centered undecoded targets zoom; no target, stale samples, low scores and large targets do not', () => {
  for (const observation of [frame([]), frame([candidate], { candidateSampled: false }), frame([{ ...candidate, score: .7 }]), frame([{ ...candidate, scanRegion: { x: 250, y: 250, width: 500, height: 500 } }])]) {
    assert.equal(trigger(controller(), range, 0, observation), null);
  }
  assert.equal(trigger(controller(), range, 0, frame([{ ...candidate, decodeAttempted: false }])), null);
  assert.equal(trigger(controller()), 1.1);
});

test('edge targets require centering; alternating targets never accumulate a stable lock', () => {
  const policy = controller();
  const edge = frame([{ ...candidate, scanRegion: { x: 10, y: 450, width: 100, height: 100 } }]);
  assert.equal(trigger(policy, range, 0, edge), null);
  assert.equal(policy.info.status, 'centering');
  const other = frame([{ ...candidate, scanRegion: { x: 600, y: 450, width: 100, height: 100 } }]);
  for (let i = 0; i < 8; i++) assert.equal(policy.update(i % 2 ? other : frame(), range, 1000 + i * 300), null);
});

test('zoom uses full-frame geometry, including a code in a narrow portrait scan region', () => {
  const policy = controller();
  // Full source is 1920x1080; UI crop occupies only its middle. Zoom must center
  // on the actual source, not on an independently normalized viewfinder rectangle.
  const portrait = frame([{ ...candidate, scanRegion: { x: 900, y: 480, width: 100, height: 100 } }], { width: 1920, height: 1080 });
  assert.equal(trigger(policy, range, 0, portrait), 1.1);
});

test('settling, decoded-frame hold, and target loss prevent hunting and roll back to a learned limit', () => {
  const policy = controller();
  assert.equal(trigger(policy), 1.1); policy.applied(1, 1.1, 600);
  const zoom = { ...range, value: 1.1 };
  assert.equal(policy.update(frame(), zoom, 700), null);
  assert.equal(policy.update(frame([], { code: {}, codes: [{}] }), zoom, 800), null);
  assert.equal(policy.info.status, 'holding');
  assert.equal(policy.update(frame([]), zoom, 1800), null);
  assert.equal(policy.update(frame([]), zoom, 2400), 1);
  policy.applied(1.1, 1, 2400);
  assert.equal(trigger(policy, range, 3000), null);
  assert.equal(policy.info.status, 'limit');
});

test('two materially softer observations after settling retreat, rather than increasing zoom', () => {
  const policy = controller(); trigger(policy); policy.applied(1, 1.1, 600);
  const soft = frame([{ ...candidate, sharpness: .5 }]), zoom = { ...range, value: 1.1 };
  assert.equal(policy.update(soft, zoom, 1200), null);
  assert.equal(policy.update(soft, zoom, 1500), 1);
});

test('manual control, unsupported cameras, multi-code mode and locator failures never issue zoom', () => {
  for (const [enabled, zoom, multiple] of [[false, range, false], [true, null, false], [true, range, true]]) {
    const policy = new AutoZoomController(); policy.reset(enabled, zoom, multiple, 0);
    assert.equal(trigger(policy), null);
  }
  const policy = controller(); policy.manual(); assert.equal(trigger(policy), null);
  policy.reset(true, range, false, 0);
  assert.equal(policy.update(frame([], { candidateError: true }), range, 0), null);
  assert.equal(policy.info.status, 'error');
});

test('hardware step and the per-session 3x cap are never exceeded', () => {
  const policy = controller();
  const coarse = { ...range, step: 1 };
  assert.equal(trigger(policy, coarse), null, 'do not jump 2x just to satisfy a coarse step');
  const limited = controller();
  assert.equal(trigger(limited, { ...range, value: 3 }), null);
  assert.equal(limited.info.status, 'limit');
});

function smallQr({ damaged = false, findersOnly = false } = {}) {
  const image = new Canvas(); image.width = 960; image.height = 640;
  image.pixels = new Uint8ClampedArray(image.width * image.height * 4).fill(255);
  for (let y = 0; y < fixture.size; y++) for (let x = 0; x < fixture.size; x++) {
    if (findersOnly && (x >= 7 || y >= 7)) continue;
    if (damaged && x >= 8 && y >= 8) continue;
    if (!fixture.data[y * fixture.size + x]) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const p = ((290 + y * 2 + dy) * image.width + 450 + x * 2 + dx) * 4;
      image.pixels[p] = image.pixels[p + 1] = image.pixels[p + 2] = 0;
    }
  }
  return image;
}
const locate = (image, qr = true, linear = true) => locateCandidates({ data: image.pixels, width: image.width, height: image.height }, qr, linear);

test('structural QR locator finds intact and undecodable codes, but rejects a lone finder and blank images', () => {
  for (const damaged of [false, true]) {
    const found = locate(smallQr({ damaged }), true, false);
    assert.equal(found.length, 1);
    const r = found[0].scanRegion;
    assert.ok(r.x <= 450 && r.y <= 290 && r.x + r.width >= 508 && r.y + r.height >= 348);
    assert.equal(found[0].kind, 'qr');
  }
  assert.deepEqual(locate(smallQr({ findersOnly: true }), true, false), []);
  const blank = smallQr(); blank.pixels.fill(255); assert.deepEqual(locate(blank), []);
});

test('structural barcode locator finds common horizontal and vertical barcodes without decoding content', () => {
  for (const example of examples) for (const rotate of [false, true]) {
    const found = locate(barcodeImage(example, { scale: 2, rotate }), false, true);
    assert.ok(found.some(c => c.kind === 'linear'), example[0] + (rotate ? ' vertical' : ' horizontal'));
  }
});

test('random texture and uniform picket-fence stripes are not trusted barcode candidates', () => {
  const image = smallQr();
  let seed = 123;
  for (let i = 0; i < image.pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = seed >>> 24;
    image.pixels[i] = image.pixels[i + 1] = image.pixels[i + 2] = v;
  }
  assert.deepEqual(locate(image), []);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    image.pixels[i] = image.pixels[i + 1] = image.pixels[i + 2] = x % 8 < 4 ? 0 : 255;
  }
  assert.deepEqual(locate(image), []);
});

function setup(t, options = {}) {
  const browser = installBrowser();
  const scanner = scanOps({ formats: ['QRCode'], autoZoom: true, maxDecodeSize: 192, maxRetryDecodeSize: 192, retryBudgetMs: 1000, ...options });
  t.after(() => { scanner.destroy(); browser.restore(); });
  return { ...browser, scanner };
}
function zoomCamera(state) {
  const settings = { deviceId: 'rear', zoom: 1 };
  state.stream.track.getSettings = () => ({ ...settings });
  state.stream.track.getCapabilities = () => ({ zoom: range });
  state.stream.track.applyConstraints = async ({ advanced }) => Object.assign(settings, ...advanced);
  return settings;
}
function damagedVideo() {
  const video = new Video(), image = smallQr({ damaged: true });
  video.videoWidth = image.width; video.videoHeight = image.height; video.pixels = image.pixels;
  return video;
}

test('candidate crop recovers actual QR content without full-frame HD retry or camera access', async t => {
  const { scanner, state } = setup(t);
  const baseline = scanOps({ formats: ['QRCode'], maxDecodeSize: 192, maxRetryDecodeSize: 192 });
  try { assert.equal((await baseline.scanImage(smallQr())).code, null); } finally { baseline.destroy(); }
  const result = await scanner.scanImage(smallQr());
  assert.equal(result.code?.data, fixture.payload);
  assert.equal(result.path, 'candidate-region');
  assert.equal(result.recovery.highResolution, false);
  assert.equal(result.recovery.recovered, true);
  assert.equal(state.cameraCalls, 0);
  assert.ok(Math.abs(result.code.cornerPoints[0].x - 450) < 3);
});

test('actual undecoded structural candidates automatically drive zoom on a capable camera', async t => {
  const { scanner, state } = setup(t); const settings = zoomCamera(state);
  const decoded = []; scanner.on('confirmed', result => decoded.push(result));
  await scanner.start(damagedVideo());
  await until(() => settings.zoom > 1, 2000);
  assert.equal(settings.zoom, 1.1);
  assert.equal(decoded.length, 0, 'candidate is not a decoded result');
  assert.equal(scanner.state, 'running');
});

test('silent device rejection disables only auto zoom and keeps scanning', async t => {
  const { scanner, state } = setup(t); zoomCamera(state);
  state.stream.track.applyConstraints = async () => {};
  await scanner.start(damagedVideo());
  await until(() => scanner.autoZoomInfo.status === 'error', 2000);
  assert.equal(scanner.state, 'running'); assert.equal(scanner.cameraInfo.zoom.value, 1);
});

test('manual zoom queues behind pending automatic constraints and takes over immediately', async t => {
  const { scanner, state } = setup(t); const settings = zoomCamera(state);
  let finish; const applied = [];
  state.stream.track.applyConstraints = ({ advanced: [constraint] }) => {
    applied.push(constraint.zoom);
    if (applied.length === 1) return new Promise(resolve => { finish = () => { Object.assign(settings, constraint); resolve(); }; });
    Object.assign(settings, constraint); return Promise.resolve();
  };
  await scanner.start(damagedVideo()); await until(() => finish, 2000);
  const manual = scanner.setZoom(2);
  assert.equal(scanner.autoZoomInfo.status, 'manual');
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(applied.length, 1);
  finish(); await manual;
  assert.deepEqual(applied, [1.1, 2]); assert.equal(settings.zoom, 2);
  await new Promise(resolve => setTimeout(resolve, 400)); assert.equal(applied.length, 2);
});

test('switching camera cancels pending automatic updates without touching the new session', async t => {
  const { scanner, state } = setup(t); zoomCamera(state);
  let finish;
  state.stream.track.applyConstraints = () => new Promise(resolve => { finish = resolve; });
  await scanner.start(damagedVideo()); await until(() => finish, 2000);
  const old = state.stream; scanner.stop(); state.stream = cameraStream();
  await scanner.start(new Video()); finish();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(old.track.stopped, true); assert.equal(scanner.state, 'running');
  assert.equal(scanner.autoZoomInfo.status, 'unsupported');
});
