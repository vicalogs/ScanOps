import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, qrImage, fixture, Video, until, cameraStream, scanOps } from './browser-mocks.mjs';

function setup(t, options) {
  const browser = installBrowser();
  const scanner = scanOps({ formats: ['QRCode'], ...options });
  t.after(() => { scanner.destroy(); browser.restore(); });
  return { ...browser, scanner };
}
test('baseline uses the shipped decoder, reports real QR coordinates and does not load the model', async t => {
  const { scanner, state } = setup(t);
  const result = await scanner.scanImage(qrImage());
  assert.equal(result.code.data, fixture.payload);
  assert.equal(result.code.cornerPoints.length, 4);
  assert.ok(Math.abs(Math.min(...result.code.cornerPoints.map(p => p.x)) - 40) < 3);
  assert.equal(result.width, 320); assert.equal(result.height, 240);
  assert.equal(result.fallback, false); assert.ok(result.durationMs >= 0);
  assert.equal(state.workers.length, 1); assert.ok(state.workers.every(w => w.terminated));
  assert.equal(state.cameraCalls, 0);
});
test('blank frames return null instead of fabricating a result', async t => {
  const { scanner } = setup(t);
  assert.equal((await scanner.scanImage(qrImage(true))).code, null);
});
test('viewfinder cropping excludes outside codes and restores full-frame coordinates', async t => {
  let region = { x: .7, y: 0, width: .3, height: 1 };
  const { scanner } = setup(t, { scanRegion: () => region });
  assert.equal((await scanner.scanImage(qrImage())).code, null);
  region = { x: .05, y: .05, width: .7, height: .8 };
  const cropped = await scanner.scanImage(qrImage());
  assert.equal(cropped.code.data, fixture.payload);
  assert.equal(cropped.width, 320);
  assert.equal(cropped.height, 240);
  assert.ok(Math.abs(Math.min(...cropped.code.cornerPoints.map(point => point.x)) - 40) < 3);
  assert.ok(Math.abs(Math.min(...cropped.code.cornerPoints.map(point => point.y)) - 40) < 3);
  region = null;
  assert.equal((await scanner.scanImage(qrImage())).code.data, fixture.payload);
});
test('denoise toggle retries unreadable images without changing successful decodes', async t => {
  let denoise = false;
  const { scanner, state } = setup(t, { denoise: () => denoise });
  await scanner.scanImage(qrImage(true));
  const baseline = state.decodeCount;
  denoise = true;
  await scanner.scanImage(qrImage(true));
  assert.equal(state.decodeCount - baseline, baseline + 1);
  const result = await scanner.scanImage(qrImage());
  assert.equal(result.code.data, fixture.payload);
});
const LICENSED_ASSETS = 'https://sdk.test/api/license/assets/';
// licensedAssetsUrl now defaults to the built-in licence service, so opting out of the
// model means passing an empty one rather than leaving it off.
test('assisted mode with licensed assets disabled scans full-frame and never loads a model', async t => {
  const { scanner, state } = setup(t, { mode: 'assisted', licensedAssetsUrl: '' });
  state.candidates = [{ score: .99, scanRegion: { x: 20, y: 20, width: 200, height: 200 } }];
  const result = await scanner.scanImage(qrImage());
  assert.equal(result.code.data, fixture.payload); assert.equal(result.path, 'full-frame');
  assert.equal(result.fallback, false); assert.deepEqual(result.candidates, []);
  assert.equal(state.workers.length, 1);
});
test('assisted mode falls back after failed candidate decoding', async t => {
  const { scanner, state } = setup(t, { mode: 'assisted', licensedAssetsUrl: LICENSED_ASSETS });
  state.candidates = [{ score: .95, scanRegion: { x: 240, y: 0, width: 60, height: 60 } }];
  const result = await scanner.scanImage(qrImage());
  assert.equal(result.code.data, fixture.payload); assert.equal(result.fallback, true);
  assert.equal(state.workers.length, 2); assert.equal(state.decodeCount, 3);
});
test('successful ROI decoding maps corners to original frame and skips fallback', async t => {
  const { scanner, state } = setup(t, { mode: 'assisted', licensedAssetsUrl: LICENSED_ASSETS });
  state.candidates = [{ score: .99, scanRegion: { x: 20, y: 20, width: 200, height: 200 } }];
  const result = await scanner.scanImage(qrImage());
  assert.equal(result.code.data, fixture.payload); assert.equal(result.fallback, false);
  assert.ok(Math.abs(Math.min(...result.code.cornerPoints.map(p => p.x)) - 40) < 3);
  assert.equal(state.decodeCount, 2);
});
test('overlapping image tasks reject and stop settles pending worker requests', async t => {
  const { scanner, state } = setup(t); state.holdDecode = true;
  const first = scanner.scanImage(qrImage());
  await assert.rejects(scanner.scanImage(qrImage()), /busy/);
  scanner.stop();
  // Stop can win the race against the license check that now precedes engine
  // creation, in which case the engine never exists to reject with "closed".
  await assert.rejects(first, /closed|stopped/i);
  assert.ok(state.workers.every(w => w.terminated));
});
test('stop during permission request rejects immediately and releases a late stream', async t => {
  const { scanner, state, mediaDevices } = setup(t);
  let grant; mediaDevices.getUserMedia = () => { state.cameraCalls++; return new Promise(resolve => { grant = resolve; }); };
  const startup = scanner.start(new Video());
  await until(() => grant);
  scanner.stop(); await assert.rejects(startup, { name: 'AbortError' });
  grant(state.stream); await until(() => state.stream.track.stopped);
  assert.equal(scanner.state, 'idle'); assert.ok(state.workers.every(w => w.terminated));
});
test('startup stages follow real preparation, permission and video readiness', async t => {
  const { scanner, state, mediaDevices } = setup(t);
  const stages = [];
  let grant;
  mediaDevices.getUserMedia = () => { state.cameraCalls++; return new Promise(resolve => { grant = resolve; }); };
  scanner.on('startup', stage => {
    stages.push(stage);
    if (stage === 'preparing') assert.equal(state.cameraCalls, 0);
    if (stage === 'requesting-camera') {
      assert.ok(state.decodeCount > 0, 'decoder readiness is checked before permission');
      assert.equal(state.cameraCalls, 0);
    }
  });
  const startup = scanner.start(new Video());
  await until(() => grant);
  assert.deepEqual(stages, ['preparing', 'requesting-camera']);
  grant(state.stream);
  await startup;
  assert.deepEqual(stages, ['preparing', 'requesting-camera', 'opening-camera']);
  assert.equal(scanner.state, 'running');
});
test('cancelling at the permission milestone does not open a camera', async t => {
  const { scanner, state } = setup(t);
  scanner.on('startup', stage => { if (stage === 'requesting-camera') scanner.stop(); });
  await assert.rejects(scanner.start(new Video()), { name: 'AbortError' });
  assert.equal(state.cameraCalls, 0);
  assert.ok(state.workers.every(worker => worker.terminated));
});
test('camera emits a decoded track; stop releases stream and prevents stale results', async t => {
  const { scanner, state } = setup(t);
  const frames = [], tracks = []; scanner.on('result', value => frames.push(value)); scanner.on('track', value => tracks.push(value));
  const video = new Video(); await scanner.start(video);
  await until(() => frames.length && tracks.length);
  assert.equal(tracks[0].code.data, fixture.payload);
  assert.equal(scanner.cameraId, 'camera-1');
  scanner.stop(); const count = frames.length;
  assert.equal(video.srcObject, null); assert.equal(state.stream.track.stopped, true);
  assert.equal(tracks.at(-1), null);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(frames.length, count);
});
test('live scanning re-detects in the previous QR region and falls back if the QR leaves it', async t => {
  const { scanner } = setup(t, { maxScansPerSecond: 30 });
  const frames = []; scanner.on('result', frame => frames.push(frame));
  const video = new Video(); await scanner.start(video);
  await until(() => frames.length >= 2);
  assert.equal(frames[0].path, 'full-frame'); assert.equal(frames[1].path, 'tracked-region');
  assert.equal(frames[1].code.data, fixture.payload);
  video.pixels = qrImage(true).pixels;
  await until(() => frames.at(-1).code === null);
  assert.equal(frames.at(-1).path, 'full-frame');
});
test('hidden page stops capture, and switching restarts with the requested device', async t => {
  const { scanner, state, document } = setup(t);
  const video = new Video(); await scanner.start(video);
  const old = state.stream; state.stream = cameraStream();
  await scanner.switchCamera('camera-2');
  assert.equal(old.track.stopped, true); assert.equal(state.constraints.video.deviceId.exact, 'camera-2');
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(scanner.state, 'idle'); assert.equal(state.stream.track.stopped, true);
});
test('destroy is permanent, idempotent and prevents restart from its event callback', async t => {
  const { scanner } = setup(t); let callbackError;
  scanner.on('state', state => { if (state === 'destroyed') { try { scanner.on('result', () => {}); } catch (e) { callbackError = e; } } });
  scanner.destroy(); scanner.destroy();
  await assert.rejects(scanner.start(new Video()), /destroyed/);
  assert.match(callbackError.message, /destroyed/);
});
test('invalid configuration and cross-origin worker URLs fail without camera prompts', async t => {
  const { scanner, state } = setup(t, { assetBaseUrl: 'https://other.test/sdk/' });
  assert.throws(() => scanOps({ maxScansPerSecond: NaN }), /maxScansPerSecond/);
  await assert.rejects(scanner.scanImage(qrImage()), /same origin/);
  assert.equal(state.cameraCalls, 0);
});
