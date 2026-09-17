import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { installBrowser, Canvas, fixture, Video, until, cameraStream, qrImage, scanOps } from './browser-mocks.mjs';

function setup(t, options = {}) {
  const browser = installBrowser();
  const scanner = scanOps({ formats: ['QRCode'], ...options });
  t.after(() => { scanner.destroy(); browser.restore(); });
  return { ...browser, scanner };
}

test('camera prefers 1080p, enables supported continuous focus, and exposes working controls', async t => {
  const { scanner, state } = setup(t);
  const settings = { deviceId: 'rear', width: 1920, height: 1080, frameRate: 30, zoom: 1, torch: false };
  const track = state.stream.track;
  track.getCapabilities = () => ({ focusMode: ['manual', 'continuous'], torch: true, zoom: { min: 1, max: 3, step: .1 } });
  track.getSettings = () => ({ ...settings });
  track.applyConstraints = async constraints => Object.assign(settings, ...constraints.advanced);
  await scanner.start(new Video());
  assert.equal(state.constraints.video.width.ideal, 1920);
  assert.equal(settings.focusMode, 'continuous');
  assert.equal(scanner.cameraInfo.continuousFocus, true);
  await scanner.setTorch(true); await scanner.setZoom(2);
  assert.equal(scanner.cameraInfo.torch.enabled, true);
  assert.equal(scanner.cameraInfo.zoom.value, 2);
  await assert.rejects(scanner.setZoom(4), /range/);
  scanner.stop();
  assert.equal(scanner.cameraInfo, null);
  assert.equal(track.stopped, true);
});

test('unsupported or rejected optional camera settings do not prevent scanning', async t => {
  const { scanner, state } = setup(t);
  state.stream.track.getCapabilities = () => ({ focusMode: ['continuous'] });
  state.stream.track.applyConstraints = async () => { throw new DOMException('Unsupported focus', 'OverconstrainedError'); };
  await scanner.start(new Video());
  assert.equal(scanner.state, 'running');
  assert.equal(scanner.cameraInfo.continuousFocus, false);
  await assert.rejects(scanner.setTorch(true), /support/);
});

test('resolution fallback retries once without changing the requested camera', async t => {
  const { scanner, state, mediaDevices } = setup(t);
  const calls = [];
  mediaDevices.getUserMedia = async constraints => {
    calls.push(constraints);
    if (calls.length === 1) throw new DOMException('Resolution unavailable', 'OverconstrainedError');
    return state.stream;
  };
  await scanner.start(new Video(), 'rear-id');
  assert.deepEqual(calls.map(call => call.video.width.ideal), [1920, 1280]);
  assert.ok(calls.every(call => call.video.deviceId.exact === 'rear-id'));
});

test('denied permissions do not trigger a resolution retry', async t => {
  const { scanner, state, mediaDevices } = setup(t);
  mediaDevices.getUserMedia = async () => { state.cameraCalls++; throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(scanner.start(new Video()), { name: 'NotAllowedError' });
  assert.equal(state.cameraCalls, 1);
});

test('stopping while focus settings are pending cancels startup and releases the camera', async t => {
  const { scanner, state } = setup(t);
  let finish;
  state.stream.track.getCapabilities = () => ({ focusMode: ['continuous'] });
  state.stream.track.applyConstraints = () => new Promise(resolve => { finish = resolve; });
  const start = scanner.start(new Video());
  await until(() => finish);
  scanner.stop();
  await assert.rejects(start, { name: 'AbortError' });
  assert.equal(state.stream.track.stopped, true);
  finish();
  assert.equal(scanner.state, 'idle');
});

test('camera controls cannot complete into a newer camera session', async t => {
  const { scanner, state } = setup(t);
  const old = state.stream;
  let finish;
  old.track.getCapabilities = () => ({ torch: true });
  old.track.applyConstraints = () => new Promise(resolve => { finish = resolve; });
  await scanner.start(new Video());
  const change = scanner.setTorch(true);
  await until(() => finish);
  scanner.stop();
  await assert.rejects(change, { name: 'AbortError' });
  state.stream = cameraStream();
  await scanner.start(new Video());
  finish();
  assert.equal(scanner.cameraInfo.torch.supported, false);
});

function smallCode() {
  const image = new Canvas(); image.width = 960; image.height = 640;
  image.pixels = new Uint8ClampedArray(960 * 640 * 4).fill(255);
  for (let y = 0; y < fixture.size; y++) for (let x = 0; x < fixture.size; x++) if (fixture.data[y * fixture.size + x]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((280 + y * 2 + dy) * 960 + 420 + x * 2 + dx) * 4;
      image.pixels[i] = image.pixels[i + 1] = image.pixels[i + 2] = 0;
    }
  }
  return image;
}

test('higher-resolution retry recovers a real small QR lost by fast downscaling', async t => {
  const { scanner } = setup(t, { maxDecodeSize: 192, maxRetryDecodeSize: 960, retryBudgetMs: 1000 });
  const baseline = scanOps({ formats: ['QRCode'], maxDecodeSize: 192, maxRetryDecodeSize: 192 });
  try {
    assert.equal((await baseline.scanImage(smallCode())).code, null);
  } finally {
    baseline.destroy();
  }
  const result = await scanner.scanImage(smallCode());
  assert.equal(result.code.data, fixture.payload);
  assert.equal(result.recovery.highResolution, true);
  assert.equal(result.recovery.recovered, true);
  assert.ok(Math.abs(Math.min(...result.code.cornerPoints.map(p => p.x)) - 420) <= 2);
});

test('successful fast decodes skip recovery, and zero budget disables extra work', async t => {
  const { scanner } = setup(t, { maxDecodeSize: 192, maxRetryDecodeSize: 960, retryBudgetMs: 0 });
  const result = await scanner.scanImage(smallCode());
  assert.equal(result.code, null);
  assert.equal(result.recovery.highResolution, false);
  const success = await scanner.scanImage(qrImage());
  assert.equal(success.code.data, fixture.payload);
  assert.equal(success.recovery.attempts, 1);
});

test('live expensive retries are throttled while fast decoding continues', async t => {
  const { scanner } = setup(t, { maxDecodeSize: 192, maxRetryDecodeSize: 960, retryIntervalMs: 10000, retryBudgetMs: 1000 });
  const video = new Video(); video.videoWidth = 960; video.videoHeight = 640;
  video.pixels = new Uint8ClampedArray(960 * 640 * 4).fill(255);
  const results = []; scanner.on('result', result => results.push(result));
  await scanner.start(video);
  await until(() => results.length >= 3, 1000);
  assert.equal(results.filter(result => result.recovery.highResolution).length, 1);
});

test('only distinct video frames confirm a result; raw feedback stays immediate', async t => {
  const { scanner } = setup(t);
  const video = new Video(); video.currentTime = 0;
  const frames = [], confirmed = [];
  scanner.on('result', result => frames.push(result));
  scanner.on('confirmed', result => confirmed.push(result));
  await scanner.start(video);
  await until(() => frames.length);
  assert.equal(frames[0].code.data, fixture.payload);
  assert.equal(frames[0].confirmed, false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(frames.length, 1);
  assert.equal(confirmed.length, 0);
  video.currentTime = 1 / 30;
  await until(() => confirmed.length);
  assert.equal(frames.at(-1).confirmed, true);
  video.currentTime = 2 / 30;
  await until(() => frames.length === 3);
  assert.equal(confirmed.length, 1);
  assert.equal(scanner.diagnostics.confirmedResults, 1);
  assert.ok(scanner.diagnostics.firstConfirmedMs >= scanner.diagnostics.firstDecodeMs);
  assert.ok(scanner.diagnostics.startupMs >= 0);
  scanner.stop();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(confirmed.length, 1);
});

test('confirmation rejects alternating or interrupted observations and rearms after absence', async () => {
  const source = await readFile(new URL('../src/confirmation.ts', import.meta.url), 'utf8');
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  const { ConfirmationGate } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const gate = new ConfirmationGate(2, 650, 1500);
  const a = { format: 'QRCode', data: 'A', cornerPoints: [] }, b = { ...a, data: 'B' };
  assert.equal(gate.update(a, 0).confirmed, false);
  assert.equal(gate.update(b, 50).confirmed, false);
  assert.equal(gate.update(a, 100).confirmed, false);
  gate.update(null, 110);
  assert.equal(gate.update(a, 150).confirmed, false);
  assert.deepEqual(gate.update(a, 200), { confirmed: true, emit: true });
  assert.deepEqual(gate.update(a, 250), { confirmed: true, emit: false });
  gate.update(null, 1000);
  gate.update(a, 1100);
  assert.deepEqual(gate.update(a, 1150), { confirmed: true, emit: false });
  gate.update(null, 2000);
  gate.update(a, 2100);
  assert.deepEqual(gate.update(a, 2150), { confirmed: true, emit: true });
  gate.reset();
  assert.equal(gate.update(a, 2200).confirmed, false);
  assert.equal(gate.update({ ...a, format: 'Code128' }, 2250).confirmed, false);
});
