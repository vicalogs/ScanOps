import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir, writeFile, mkdir, symlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('core is SSR-importable without React, document, camera or Worker globals', async () => {
  const sdk = await import('@scanops/browser-sdk');
  assert.equal(typeof sdk.ScanOps, 'function');
  assert.equal(sdk.SmartScanner, sdk.ScanOps);
  assert.equal(sdk.SDK_VERSION, '0.1.0-beta.3');
  assert.throws(() => new sdk.ScanOps(), /browser/);
});
test('public entries and runtime manifest use a complete ScanOps file contract', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.main, './dist/scanops.js');
  assert.equal(pkg.module, pkg.main);
  assert.equal(pkg.types, './dist/types/scanops.d.ts');
  assert.deepEqual(pkg.exports['.'], { types: pkg.types, import: pkg.main });
  assert.deepEqual(pkg.exports['./react'], { types: './dist/types/scanops-react.d.ts', import: './dist/scanops-react.js' });
  assert.equal(pkg.bin['scanops-assets'], './bin/scanops-assets.mjs');
  for (const path of [pkg.main, pkg.types, ...Object.values(pkg.exports['./react']), pkg.bin['scanops-assets']]) await readFile(new URL(path, root));
  const base = new URL('dist/assets/', root);
  const manifest = JSON.parse(await readFile(new URL('scanops-manifest.json', base), 'utf8'));
  const names = ['scanops-qr.worker.js', 'scanops-barcode.worker.js', 'scanops-vision.worker.js', 'scanops-candidate.worker.js', 'scanops-barcode.wasm', 'scanops-engine.wasm'];
  // Named in the runtime contract, fetched from licensedAssetsUrl, never shipped.
  const licensedOnly = ['scanops-locator.weights', 'scanops-locator.json'];
  assert.equal(manifest.assetLayout, 'scanops-v1');
  assert.equal(manifest.sdk, pkg.version);
  assert.equal(manifest.engineWasmSha256, manifest.sha256['scanops-engine.wasm']);
  assert.equal(manifest.modelSha256, undefined);
  assert.deepEqual(Object.values(manifest.files).sort(), [...names, ...licensedOnly, 'scanops-manifest.json'].sort());
  assert.deepEqual(Object.keys(manifest.sha256).sort(), names.sort());
  assert.deepEqual((await readdir(base)).sort(), [...names, 'scanops-manifest.json', 'licenses', 'THIRD_PARTY_NOTICES.md'].sort());
  for (const name of names) assert.equal(createHash('sha256').update(await readFile(new URL(name, base))).digest('hex'), manifest.sha256[name], name);
});
test('branded upstream files retain their original bytes', async () => {
  const require = createRequire(import.meta.url);
  for (const [name, source] of [
    ['scanops-barcode.wasm', require.resolve('zxing-wasm/reader/zxing_reader.wasm')],
  ]) {
    assert.deepEqual(await readFile(new URL('../dist/assets/' + name, import.meta.url)), await readFile(source), name);
  }
});
test('runtime assets include matching WASM and notices', async () => {
  const base = new URL('../dist/assets/', import.meta.url);
  const version = JSON.parse(await readFile(new URL('scanops-manifest.json', base), 'utf8'));
  const barcodeWasm = await readFile(new URL('scanops-barcode.wasm', base));
  assert.equal(createHash('sha256').update(barcodeWasm).digest('hex'), version.barcodeWasmSha256);
  assert.match(await readFile(new URL('licenses/scanops-barcode-worker-license.txt', base), 'utf8'), /MIT License/);
  assert.match(await readFile(new URL('licenses/scanops-engine-core-license.txt', base), 'utf8'), /Apache License/);
  const wasm = await readFile(new URL('scanops-engine.wasm', base));
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109]);
  // Inference runs inside the engine; onnxruntime-web is neither shipped nor credited.
  assert.deepEqual((await readdir(new URL('licenses/', base))).filter(name => name.startsWith('onnxruntime')), []);
  assert.match(await readFile(new URL('../dist/scanops-react.js', import.meta.url), 'utf8'), /^'use client';/);
});
test('asset CLI installs in a clean consumer directory and safely updates only its own destination', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'scanops-cli-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/scanops-assets.mjs', import.meta.url));
  const target = join(temp, 'public/sdk');
  execFileSync(process.execPath, [cli, target]);
  assert.ok((await readdir(target)).includes('scanops-qr.worker.js'));
  assert.equal(spawnSync(process.execPath, [cli, target]).status, 1);
  assert.equal(spawnSync(process.execPath, [cli, target, '--force']).status, 0);
  await writeFile(join(temp, 'keep.txt'), 'user-owned');
  assert.equal(spawnSync(process.execPath, [cli, temp, '--force']).status, 1);
  assert.equal(await readFile(join(temp, 'keep.txt'), 'utf8'), 'user-owned');
});
test('asset upgrades prune only known old outputs and preserve custom files, notices and symlink targets', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'scanops-upgrade-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/scanops-assets.mjs', import.meta.url));
  const target = join(temp, 'sdk');
  await mkdir(join(target, 'zxing'), { recursive: true });
  await writeFile(join(target, '.smartscaner-assets'), 'smartscaner-browser-sdk\n');
  for (const name of ['decoder.worker.js', 'barcode.worker.js', 'locator.worker.js', 'version.json', 'zxing/zxing_reader.wasm', 'scanops-locator.onnx', 'scanops-locator.json', 'scanops-inference.mjs', 'scanops-inference.wasm']) await writeFile(join(target, name), 'old-sdk');
  await writeFile(join(target, 'zxing/keep.txt'), 'custom');
  await mkdir(join(temp, 'outside'));
  await writeFile(join(temp, 'outside/ort-wasm-simd-threaded.wasm'), 'do-not-touch');
  await symlink(join(temp, 'outside'), join(target, 'ort'), 'dir');
  execFileSync(process.execPath, [cli, target, '--force']);
  for (const name of ['decoder.worker.js', 'barcode.worker.js', 'locator.worker.js', 'version.json', 'zxing/zxing_reader.wasm', 'scanops-locator.onnx', 'scanops-locator.json', 'scanops-inference.mjs', 'scanops-inference.wasm']) await assert.rejects(readFile(join(target, name)), { code: 'ENOENT' });
  assert.equal(await readFile(join(target, 'zxing/keep.txt'), 'utf8'), 'custom');
  assert.equal(await readFile(join(temp, 'outside/ort-wasm-simd-threaded.wasm'), 'utf8'), 'do-not-touch');
  assert.ok((await lstat(join(target, 'ort'))).isSymbolicLink());
  assert.match(await readFile(join(target, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /Branded distribution filenames/);
  assert.ok((await readdir(target)).includes('scanops-qr.worker.js'));
  assert.equal(await readFile(join(target, '.scanops-assets'), 'utf8'), 'scanops-browser-sdk\n');
});
test('tracking preserves identity during visible motion, expires and reacquires with a new identity', async () => {
  const source = await readFile(new URL('../src/tracker.ts', import.meta.url), 'utf8');
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  const { Tracker } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const tracker = new Tracker(450);
  const code = { data: 'a', format: 'Code128', cornerPoints: [{ x: 1, y: 2 }] };
  const first = tracker.update(code, 10), next = tracker.update({ ...code, cornerPoints: [{ x: 20, y: 2 }] }, 100);
  assert.equal(first.id, next.id); assert.equal(next.code.cornerPoints[0].x, 20);
  assert.equal(tracker.expire(550), false); assert.equal(tracker.expire(551), true);
  assert.notEqual(tracker.update(code, 552).id, first.id);
  const sameText = tracker.update({ ...code, format: 'Code39' }, 553);
  assert.notEqual(sameText.id, tracker.update(code, 554).id);
  assert.equal(tracker.reset(), true); assert.equal(tracker.current, null);
});
